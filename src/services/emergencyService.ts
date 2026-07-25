/**
 * emergencyService — driver SOS
 *
 * Fires an emergency alert through the live socket first (socket event
 * `emergency:alert` on the /driver namespace), waits for an `emergency:ack`
 * from the server for up to 5s, and falls back to a plain HTTP POST against
 * `/api/emergency/alert` so dispatchers still get the alert if the socket
 * is asleep/broken.
 *
 * Payload shape (shared with the backend + passenger app):
 *   { jobId?, userId, userRole, location: {lat,lng}, message? }
 *
 * Used by the driver HomeScreen + ActiveRideScreen SOS button and any other
 * screen that needs to surface the panic control.
 */
import { getSocket } from './driverSocket';
import httpClient from './httpClient';
import type { LocationUpdate } from '../native/locationService';

export type EmergencyAlertPayload = {
  jobId?: string | null;
  userId: string;
  userRole: 'DRIVER';
  location: { lat: number; lng: number };
  message?: string;
};

const ACK_TIMEOUT_MS = 5000;

/**
 * Sends an emergency alert. Resolves true on any path where we are
 * reasonably sure dispatch has received the alert (socket ack OR HTTP 2xx).
 * Never throws — callers don't want an unhandled rejection during a panic.
 */
export async function sendEmergencyAlert(
  params: {
    userId: string;
    jobId?: string | null;
    location: LocationUpdate | { latitude: number; longitude: number } | null;
    message?: string;
  },
): Promise<{ delivered: boolean; via: 'socket' | 'http' | 'none'; error?: string }> {
  const lat = params.location?.latitude;
  const lng = params.location?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { delivered: false, via: 'none', error: 'no-location' };
  }

  const payload: EmergencyAlertPayload = {
    userId: params.userId,
    userRole: 'DRIVER',
    jobId: params.jobId ?? undefined,
    location: { lat, lng },
    message: params.message,
  };

  // 1) Try socket with ack
  const socket = getSocket();
  if (socket && socket.connected) {
    const acked = await new Promise<boolean>((resolve) => {
      let settled = false;
      const ackHandler = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      const cleanup = () => {
        clearTimeout(to);
        socket.off('emergency:ack', ackHandler);
      };
      const to = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }, ACK_TIMEOUT_MS);
      socket.once('emergency:ack', ackHandler);
      try {
        socket.emit('emergency:alert', payload);
      } catch (_e) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      }
    });

    if (acked) {
      return { delivered: true, via: 'socket' };
    }
    // fall through to HTTP fallback
  }

  // 2) HTTP fallback — /api/emergency/alert (note: httpClient.baseURL already
  // has /api in it, so the relative path must be /emergency/alert)
  try {
    await httpClient.post('/emergency/alert', payload, { timeout: 10000 });
    return { delivered: true, via: 'http' };
  } catch (err: any) {
    return {
      delivered: false,
      via: 'none',
      error: err?.response?.data?.message || err?.message || 'network-error',
    };
  }
}

/**
 * Listen for dispatcher acknowledgment. The backend is expected to emit
 * `emergency:dispatcher:ack` once a human dispatcher has seen the alert.
 * We expose this as a subscription so a banner can be shown persistently
 * until acknowledgment lands.
 */
export type DispatcherAckHandler = (data: { id?: string; timestamp?: number }) => void;

export function onDispatcherAck(handler: DispatcherAckHandler): () => void {
  const socket = getSocket();
  if (!socket) return () => {};
  socket.on('emergency:dispatcher:ack', handler);
  return () => {
    socket.off('emergency:dispatcher:ack', handler);
  };
}
