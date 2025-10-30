/**
 * 🔌 Offline Queue Integration
 * 
 * Integrates the offline queue with socket events and API calls.
 * Ensures no data is lost during network interruptions.
 * 
 * @module offlineQueueIntegration
 */

import { offlineQueue } from './offlineQueue';
import { logger } from './logger';
import { emitDriverStatus, emitJobProgress, emitMeterTelemetry } from './driverSocket';
import httpClient from '../api/httpClient';

/**
 * Initialize offline queue with event handlers
 */
export async function initializeOfflineQueue(): Promise<void> {
  logger.info('system', 'Initializing offline queue integration...');

  // Initialize the queue service
  await offlineQueue.initialize();

  // Register handlers for different event types
  registerEventHandlers();

  logger.info('system', 'Offline queue integration initialized');
}

/**
 * Register handlers for queued events
 */
function registerEventHandlers(): void {
  // Driver status updates
  offlineQueue.registerHandler('driver:status', async (payload) => {
    logger.debug('socket', 'Processing queued driver:status', payload);
    await emitDriverStatus(
      payload.driverId,
      payload.status,
      payload.jobId,
      payload.location
    );
  });

  // Job progress updates
  offlineQueue.registerHandler('job:progress', async (payload) => {
    logger.debug('socket', 'Processing queued job:progress', payload);
    await emitJobProgress(
      payload.driverId,
      payload.jobId,
      payload.progress,
      payload.location,
      payload.metadata
    );
  });

  // Meter telemetry
  offlineQueue.registerHandler('meter:telemetry', async (payload) => {
    logger.debug('socket', 'Processing queued meter:telemetry', payload);
    await emitMeterTelemetry(payload);
  });

  // Job acceptance
  offlineQueue.registerHandler('job:accept', async (payload) => {
    logger.debug('api', 'Processing queued job:accept', payload);
    await httpClient.post(`/api/mobile/driver/jobs/${payload.jobId}/accept`, {
      acceptedAt: payload.acceptedAt,
      location: payload.location,
    });
  });

  // Job rejection
  offlineQueue.registerHandler('job:reject', async (payload) => {
    logger.debug('api', 'Processing queued job:reject', payload);
    await httpClient.post(`/api/mobile/driver/jobs/${payload.jobId}/reject`, {
      reason: payload.reason,
      rejectedAt: payload.rejectedAt,
    });
  });

  // Job status updates
  offlineQueue.registerHandler('job:update-status', async (payload) => {
    logger.debug('api', 'Processing queued job:update-status', payload);
    await httpClient.patch(`/api/mobile/driver/jobs/${payload.jobId}/status`, {
      status: payload.status,
      timestamp: payload.timestamp,
      location: payload.location,
      metadata: payload.metadata,
    });
  });

  // Location updates (batch)
  offlineQueue.registerHandler('location:batch', async (payload) => {
    logger.debug('api', 'Processing queued location:batch', payload);
    await httpClient.post('/api/mobile/driver/location/batch', {
      locations: payload.locations,
    });
  });

  // Payment submission
  offlineQueue.registerHandler('payment:submit', async (payload) => {
    logger.debug('api', 'Processing queued payment:submit', payload);
    await httpClient.post('/api/mobile/driver/payments', payload);
  });
}

/**
 * Queue a driver status update
 */
export async function queueDriverStatus(
  driverId: string,
  status: string,
  jobId?: string,
  location?: any
): Promise<void> {
  await offlineQueue.enqueue(
    'driver:status',
    { driverId, status, jobId, location },
    { priority: 'high' }
  );
  logger.debug('socket', 'Queued driver:status', { status });
}

/**
 * Queue a job progress update
 */
export async function queueJobProgress(
  driverId: string,
  jobId: string,
  progress: string,
  location?: any,
  metadata?: any
): Promise<void> {
  await offlineQueue.enqueue(
    'job:progress',
    { driverId, jobId, progress, location, metadata },
    { priority: 'critical' } // Job progress is critical
  );
  logger.debug('socket', 'Queued job:progress', { jobId, progress });
}

/**
 * Queue meter telemetry
 */
export async function queueMeterTelemetry(data: any): Promise<void> {
  await offlineQueue.enqueue('meter:telemetry', data, { priority: 'normal' });
  logger.debug('socket', 'Queued meter:telemetry');
}

/**
 * Queue job acceptance
 */
export async function queueJobAccept(
  jobId: string,
  acceptedAt: string,
  location?: any
): Promise<void> {
  await offlineQueue.enqueue(
    'job:accept',
    { jobId, acceptedAt, location },
    { priority: 'critical', maxRetries: 10 } // Very important
  );
  logger.info('job', 'Queued job:accept', { jobId });
}

/**
 * Queue job rejection
 */
export async function queueJobReject(
  jobId: string,
  reason: string,
  rejectedAt: string
): Promise<void> {
  await offlineQueue.enqueue(
    'job:reject',
    { jobId, reason, rejectedAt },
    { priority: 'high' }
  );
  logger.info('job', 'Queued job:reject', { jobId, reason });
}

/**
 * Queue job status update
 */
export async function queueJobStatusUpdate(
  jobId: string,
  status: string,
  timestamp: string,
  location?: any,
  metadata?: any
): Promise<void> {
  await offlineQueue.enqueue(
    'job:update-status',
    { jobId, status, timestamp, location, metadata },
    { priority: 'critical' }
  );
  logger.info('job', 'Queued job:update-status', { jobId, status });
}

/**
 * Queue location batch (for offline accumulated locations)
 */
export async function queueLocationBatch(locations: any[]): Promise<void> {
  if (locations.length === 0) return;

  await offlineQueue.enqueue(
    'location:batch',
    { locations },
    { priority: 'low' } // Can wait
  );
  logger.debug('location', 'Queued location:batch', { count: locations.length });
}

/**
 * Queue payment submission
 */
export async function queuePaymentSubmit(paymentData: any): Promise<void> {
  await offlineQueue.enqueue('payment:submit', paymentData, {
    priority: 'critical',
    maxRetries: 10,
    expiresInMs: 24 * 60 * 60 * 1000, // 24 hours
  });
  logger.info('payment', 'Queued payment:submit', { jobId: paymentData.jobId });
}

/**
 * Get queue statistics
 */
export function getQueueStats() {
  return offlineQueue.getStats();
}

/**
 * Get queue size
 */
export function getQueueSize(): number {
  return offlineQueue.getQueueSize();
}

/**
 * Check if online
 */
export function isOnline(): boolean {
  return offlineQueue.getIsOnline();
}

/**
 * Force process queue (for testing)
 */
export async function forceProcessQueue(): Promise<void> {
  await offlineQueue.forceProcessQueue();
}

/**
 * Clear queue (use with caution!)
 */
export async function clearQueue(): Promise<void> {
  await offlineQueue.clearQueue();
  logger.warn('system', 'Offline queue cleared');
}

