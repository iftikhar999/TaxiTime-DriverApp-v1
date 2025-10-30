import { io, Socket } from "socket.io-client";
import { SOCKET_BASE_URL } from "../config/environment";
import type { LocationUpdate } from "../native/locationService";
import { offlineEventQueue } from "./offlineEventQueue";

type DriverSocketConfig = {
  driverId: string;
  companyId?: string | null;
};

let LOCATION_THROTTLE_MS = 2000; // Default, will be updated dynamically
let HEARTBEAT_INTERVAL_MS = 30000; // Default 30 seconds, will be updated dynamically

let socket: Socket | null = null;
let currentDriver: DriverSocketConfig | null = null;
let authenticated = false;
let lastLocationSentAt = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let isOnline = false;
let hasActiveShift = false; // Track if driver has active shift
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let maxReconnectDelay = 60000; // Max 60 seconds between retries
let shiftRestorationCallback: (() => Promise<void>) | null = null;

// Function to update location throttle interval dynamically
export const updateLocationThrottleInterval = (intervalSeconds: number) => {
  const intervalMs = intervalSeconds * 1000;
  LOCATION_THROTTLE_MS = intervalMs;
  console.log(
    `🔄 Socket location throttle updated to ${intervalSeconds}s (${intervalMs}ms)`
  );
};

// Function to update heartbeat interval dynamically
export const updateHeartbeatInterval = (intervalSeconds: number) => {
  const intervalMs = intervalSeconds * 1000;
  HEARTBEAT_INTERVAL_MS = intervalMs;
  console.log(
    `💓 Socket heartbeat interval updated to ${intervalSeconds}s (${intervalMs}ms)`
  );

  // If heartbeat is currently active, restart it with new interval
  if (heartbeatInterval && hasActiveShift) {
    stopHeartbeat();
    startHeartbeat();
  }
};

// Function to update both intervals at once
export const updateSocketIntervals = (
  locationIntervalSeconds: number,
  heartbeatIntervalSeconds?: number
) => {
  updateLocationThrottleInterval(locationIntervalSeconds);

  // If heartbeat interval is provided, use it; otherwise use a sensible multiple of location interval
  const heartbeatSeconds =
    heartbeatIntervalSeconds ?? Math.max(locationIntervalSeconds * 6, 30);
  updateHeartbeatInterval(heartbeatSeconds);
};

/**
 * Calculate exponential backoff delay with jitter
 */
const getReconnectDelay = (attempt: number): number => {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
  const delay = Math.min(1000 * Math.pow(2, attempt), maxReconnectDelay);
  // Add random jitter (±20%) to prevent thundering herd
  const jitter = delay * 0.2 * (Math.random() - 0.5);
  return Math.round(delay + jitter);
};

/**
 * Manual reconnection with exponential backoff
 * Continues indefinitely until connection is restored
 */
const scheduleReconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  const delay = getReconnectDelay(reconnectAttempt);
  console.log(
    `🔄 Scheduling reconnect attempt ${reconnectAttempt + 1} in ${delay}ms`
  );

  reconnectTimer = setTimeout(() => {
    if (socket && !socket.connected) {
      reconnectAttempt++;
      console.log(`🔌 Attempting to reconnect (attempt ${reconnectAttempt})...`);
      socket.connect();
    }
  }, delay);
};

const authenticateIfReady = () => {
  if (socket && currentDriver && socket.connected) {
    console.log("🔐 Authenticating driver with socket:", {
      driverId: currentDriver.driverId,
      companyId: currentDriver.companyId,
      socketId: socket.id,
      connected: socket.connected
    });
    
    socket.emit("authenticate", {
      userId: currentDriver.driverId,
      companyId: currentDriver.companyId ?? undefined,
    });
    authenticated = true;
    
    console.log("✅ Authentication event emitted");
  } else {
    console.warn("⚠️ Cannot authenticate:", {
      hasSocket: !!socket,
      hasDriver: !!currentDriver,
      connected: socket?.connected
    });
  }
};

/**
 * Register a callback to restore shift state after reconnection
 * This ensures driver stays in shift even if socket disconnects
 */
export const registerShiftRestoration = (callback: () => Promise<void>) => {
  shiftRestorationCallback = callback;
  console.log("✅ Shift restoration callback registered");
};

/**
 * ✅ NEW: Driver state restoration callback
 * Called when server sends complete driver state (shift, vehicle, tariff, job)
 */
// ✅ FIX: Support multiple callbacks (ShiftContext + JobContext)
let driverStateRestorationCallbacks: Array<(state: any) => void> = [];

/**
 * Register a callback to receive complete driver state from server
 * Server sends: shift, vehicle, tariff, and active job (if any)
 * ✅ FIXED: Supports multiple callbacks instead of overwriting
 */
export const registerDriverStateRestoration = (callback: (state: any) => void) => {
  // Add callback if not already registered
  if (!driverStateRestorationCallbacks.includes(callback)) {
    driverStateRestorationCallbacks.push(callback);
    console.log(`✅ Driver state restoration callback registered (total: ${driverStateRestorationCallbacks.length})`);
  }
};

/**
 * Unregister a driver state restoration callback
 */
export const unregisterDriverStateRestoration = (callback: (state: any) => void) => {
  driverStateRestorationCallbacks = driverStateRestorationCallbacks.filter(cb => cb !== callback);
  console.log(`🧹 Driver state restoration callback unregistered (remaining: ${driverStateRestorationCallbacks.length})`);
};

/**
 * Restore shift state after successful reconnection
 */
const restoreShiftState = async () => {
  if (shiftRestorationCallback) {
    try {
      console.log("🔄 Restoring shift state after reconnection...");
      await shiftRestorationCallback();
      console.log("✅ Shift state restored successfully");
    } catch (error) {
      console.error("❌ Failed to restore shift state:", error);
    }
  }
};

export const ensureDriverSocket = (config: DriverSocketConfig): Socket => {
  currentDriver = config;

  // Initialize offline queue
  offlineEventQueue.initialize().catch(console.error);

  if (socket) {
    if (!socket.connected) {
      socket.connect();
    } else {
      authenticateIfReady();
    }
    return socket;
  }

  socket = io(`${SOCKET_BASE_URL}/driver`, {
    transports: ["websocket"],
    forceNew: false,
    autoConnect: true,
    reconnection: false, // We handle reconnection manually for better control
    timeout: 10000,
  });

  socket.on("connect", async () => {
    console.log("🟢 Socket connected successfully");
    isOnline = true;
    reconnectAttempt = 0; // Reset attempt counter on successful connection
    
    // Clear any pending reconnect timers
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    authenticateIfReady();

    // Restore shift state if driver was in shift before disconnect
    if (hasActiveShift) {
      await restoreShiftState();
      startHeartbeat();
    }

    // Process queued events after connection
    try {
      const result = await offlineEventQueue.processQueue(
        (eventName, payload) => {
          if (socket) {
            socket.emit(eventName, payload);
          }
        }
      );
      console.log(`📤 Replayed ${result.success} queued events`);
    } catch (error) {
      console.error("Failed to process offline queue:", error);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log(`🔴 Socket disconnected - reason: ${reason}`);
    isOnline = false;
    authenticated = false;
    stopHeartbeat();

    // Schedule automatic reconnection with exponential backoff
    // This ensures infinite retry attempts
    if (reason !== "io client disconnect") {
      // Only auto-reconnect if server disconnected us
      scheduleReconnect();
    }
  });

  socket.on("connect_error", (error) => {
    console.error("❌ Socket connection error:", error?.message || error);
    isOnline = false;
    
    // Schedule reconnection on connection error
    scheduleReconnect();
  });

  socket.on("reconnect_attempt", (attempt) => {
    console.log(`🔄 Manual reconnect attempt ${attempt}`);
  });

  // Listen for zone changes from server (server-side zone detection)
  let lastReceivedZoneId: string | null = null;
  socket.on("driver:zone:changed", (data: { zoneId: string | null; zoneName: string | null }) => {
    // ✅ FIX: Only log when zone ACTUALLY changes to reduce spam
    if (lastReceivedZoneId !== data.zoneId) {
      console.log('📍 Zone CHANGED from server:', {
        from: lastReceivedZoneId,
        to: data.zoneId,
        zoneName: data.zoneName
      });
      lastReceivedZoneId = data.zoneId;
    }
    
    if (zoneChangeCallback) {
      zoneChangeCallback(data);
    }
  });

  // ✅ NEW: Listen for complete driver state from server (on authentication)
  socket.on("driver:state:restored", (state: any) => {
    console.log('🔄 Complete driver state received from server:', {
      hasShift: !!state.shift,
      hasVehicle: !!state.vehicle,
      hasTariff: !!state.tariff,
      hasJob: !!state.job,
    });
    
    // ✅ FIX: Call ALL registered callbacks (ShiftContext + JobContext)
    if (driverStateRestorationCallbacks.length > 0) {
      console.log(`📢 Notifying ${driverStateRestorationCallbacks.length} callbacks of driver state restoration`);
      driverStateRestorationCallbacks.forEach((callback, index) => {
        try {
          callback(state);
          console.log(`✅ Callback ${index + 1}/${driverStateRestorationCallbacks.length} executed successfully`);
        } catch (error) {
          console.error(`❌ Callback ${index + 1} failed:`, error);
        }
      });
    } else {
      console.warn('⚠️ No callbacks registered for driver state restoration');
    }
  });

  // ✅ CRITICAL FIX: Listen for shift ended notification from server
  socket.on("shift:ended", (data: any) => {
    console.warn('🛑 SHIFT ENDED BY SERVER:', {
      shiftId: data.shiftId,
      endTime: data.endTime,
      duration: data.duration,
      totalEarnings: data.totalEarnings,
      totalTrips: data.totalTrips,
    });
    
    // ✅ FIX: Call ALL shift restoration callbacks with empty state to trigger cleanup
    if (driverStateRestorationCallbacks.length > 0) {
      console.log(`📢 Broadcasting shift ended to ${driverStateRestorationCallbacks.length} callbacks`);
      const nullState = {
        shift: null,
        vehicle: null,
        tariff: null,
        job: null,
      };
      driverStateRestorationCallbacks.forEach((callback) => {
        try {
          callback(nullState);
        } catch (error) {
          console.error('❌ Failed to notify shift ended:', error);
        }
      });
    }
    
    console.log('✅ Shift ended notification processed - mobile app will sync');
  });

  return socket;
};

export const disconnectDriverSocket = () => {
  stopHeartbeat();
  
  // Clear reconnection timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  reconnectAttempt = 0;
  
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  currentDriver = null;
  authenticated = false;
  lastLocationSentAt = 0;
  isOnline = false;
};

/**
 * Get current socket connection status
 */
export const getConnectionStatus = () => ({
  isConnected: socket?.connected ?? false,
  isOnline,
  authenticated,
  hasActiveShift,
  reconnectAttempt,
});

/**
 * Get the current socket instance (for event listeners)
 */
export const getSocket = (): Socket | null => {
  return socket;
};

/**
 * Smart emit - sends immediately if online, queues if offline
 */
const smartEmit = async (
  eventName: string,
  payload: any,
  eventType:
    | "status"
    | "location"
    | "job_progress"
    | "meter_telemetry"
    | "heartbeat"
) => {
  if (socket && socket.connected && authenticated) {
    // Online - emit immediately
    socket.emit(eventName, payload);
  } else {
    // Offline - queue for later
    await offlineEventQueue.enqueue({
      type: eventType,
      eventName,
      payload,
    });
    console.log(`📥 Event queued (offline): ${eventName}`);
  }
};

export const emitDriverLocation = (location: LocationUpdate, appState?: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE') => {
  // ✅ FIX: Add logging for silent failures
  if (!currentDriver) {
    console.warn('⚠️ Cannot emit location: No current driver set');
    return;
  }

  if (
    typeof location.latitude !== "number" ||
    typeof location.longitude !== "number"
  ) {
    console.warn('⚠️ Cannot emit location: Invalid coordinates', {
      lat: location.latitude,
      lng: location.longitude,
    });
    return;
  }

  const now = Date.now();
  const timeSinceLastSend = now - lastLocationSentAt;
  if (timeSinceLastSend < LOCATION_THROTTLE_MS) {
    // Only log every 10th throttled attempt to avoid spam
    if (Math.random() < 0.1) {
      console.log(`⏱️ Location throttled (${Math.round(timeSinceLastSend / 1000)}s since last, need ${LOCATION_THROTTLE_MS / 1000}s)`);
    }
    return;
  }

  lastLocationSentAt = now;

  const payload = {
    driverId: currentDriver.driverId,
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      heading: location.heading ?? null,
      speed: location.speed ?? null,
      timestamp: location.timestamp ?? Date.now(),
    },
    appState: appState || 'ACTIVE', // ✨ NEW: Include app state (foreground/background)
  };

  // Smart emit - queues if offline
  smartEmit("driver:location:update", payload, "location");
  
  console.log('📍 LOCATION EMITTED:', {
    driverId: currentDriver.driverId,
    lat: location.latitude?.toFixed(6),
    lng: location.longitude?.toFixed(6),
    appState,
  });
  
  // ✨ NEW: Log when app is in background
  if (appState === 'BACKGROUND') {
    console.log('📱 Location sent from BACKGROUND - app is minimized');
  }
};

/**
 * Emit app state change to dispatcher
 * Notifies when driver app goes to background or comes back to foreground
 */
export const emitAppStateChange = (appState: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE') => {
  if (!currentDriver) return;
  
  const payload = {
    driverId: currentDriver.driverId,
    appState,
    timestamp: Date.now(),
  };
  
  // Emit to server
  smartEmit("driver:app:state", payload, "status");
  
  console.log(`📱 App state change sent to dispatcher: ${appState}`);
};

// Zone change listener callback
let zoneChangeCallback: ((data: { zoneId: string | null; zoneName: string | null }) => void) | null = null;

/**
 * Register callback for zone changes from server
 * Server detects zone and sends updates via this event
 */
export const registerZoneChangeListener = (
  callback: (data: { zoneId: string | null; zoneName: string | null }) => void
) => {
  zoneChangeCallback = callback;
  console.log('📍 Zone change listener registered');
};

/**
 * DEPRECATED: Use server-side zone detection instead
 * This is kept for backward compatibility but server now handles zone detection
 */
export const emitDriverZoneStatus = (
  zoneId: string | null,
  zoneName?: string | null
) => {
  console.warn('⚠️ emitDriverZoneStatus is deprecated - server now detects zones automatically');
  
  if (!socket || !currentDriver || !authenticated) {
    return;
  }

  socket.emit("driver:zone:update", {
    driverId: currentDriver.driverId,
    companyId: currentDriver.companyId ?? undefined,
    zoneId,
    zoneName: zoneName ?? undefined,
    timestamp: Date.now(),
  });
};

export const emitDriverStatus = (status: string, location?: LocationUpdate) => {
  if (!currentDriver) {
    return;
  }

  const payload = {
    driverId: currentDriver.driverId,
    companyId: currentDriver.companyId ?? undefined,
    status,
    newStatus: status,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          heading: location.heading ?? null,
          speed: location.speed ?? null,
          timestamp: location.timestamp ?? Date.now(),
        }
      : undefined,
    timestamp: Date.now(),
    reason: "manual",
  };

  smartEmit("driver:status:update", payload, "status");
};

/**
 * Emit job progress update to backend
 * @param jobId - The job/ride ID
 * @param status - Job status (ASSIGNED, ON_THE_WAY, ARRIVED, ACTIVE/STARTED, REACHED, COMPLETED, REJECTED, CANCELLED)
 * @param location - Optional current location
 */
export const emitJobProgress = (
  jobId: string,
  status: string,
  location?: LocationUpdate
) => {
  if (!currentDriver) {
    console.warn("Cannot emit job progress: driver not configured");
    return;
  }

  const payload = {
    driverId: currentDriver.driverId,
    companyId: currentDriver.companyId ?? undefined,
    jobId,
    status,
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          heading: location.heading ?? null,
          speed: location.speed ?? null,
          timestamp: location.timestamp ?? Date.now(),
        }
      : undefined,
    timestamp: Date.now(),
  };

  console.log("📊 Emitting job:progress:update", payload);
  smartEmit("job:progress:update", payload, "job_progress");
};

/**
 * Emit meter telemetry during active ride
 * @param jobId - The job/ride ID
 * @param telemetry - Meter data (elapsed time, distance, fare)
 * @param location - Optional current location
 */
export const emitMeterTelemetry = (
  jobId: string,
  telemetry: {
    elapsedSeconds: number;
    distanceMeters: number;
    waitingSeconds?: number;
    currentFare?: number;
    speedKmh?: number;
  },
  location?: LocationUpdate
) => {
  if (!currentDriver) {
    return;
  }

  const payload = {
    driverId: currentDriver.driverId,
    companyId: currentDriver.companyId ?? undefined,
    jobId,
    telemetry: {
      elapsedSeconds: telemetry.elapsedSeconds,
      distanceMeters: telemetry.distanceMeters,
      waitingSeconds: telemetry.waitingSeconds ?? 0,
      currentFare: telemetry.currentFare ?? 0,
      speedKmh: telemetry.speedKmh ?? 0,
    },
    location: location
      ? {
          latitude: location.latitude,
          longitude: location.longitude,
          heading: location.heading ?? null,
          speed: location.speed ?? null,
          timestamp: location.timestamp ?? Date.now(),
        }
      : undefined,
    timestamp: Date.now(),
  };

  smartEmit("meter:telemetry", payload, "meter_telemetry");
};

/**
 * Start sending heartbeat to backend every 30s
 * Only sends heartbeats when driver has an active shift
 */
const startHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  heartbeatInterval = setInterval(() => {
    if (
      socket &&
      currentDriver &&
      authenticated &&
      socket.connected &&
      hasActiveShift
    ) {
      socket.emit("driver:heartbeat", {
        driverId: currentDriver.driverId,
        companyId: currentDriver.companyId ?? undefined,
        timestamp: Date.now(),
      });
      console.log("💓 Heartbeat sent");
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Send initial heartbeat immediately
  if (
    socket &&
    currentDriver &&
    authenticated &&
    socket.connected &&
    hasActiveShift
  ) {
    socket.emit("driver:heartbeat", {
      driverId: currentDriver.driverId,
      companyId: currentDriver.companyId ?? undefined,
      timestamp: Date.now(),
    });
    console.log("💓 Initial heartbeat sent");
  }
};

/**
 * Stop sending heartbeat
 */
const stopHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log("💔 Heartbeat stopped");
  }
};

/**
 * Notify socket service that shift has started
 * This will start sending heartbeats
 */
export const notifyShiftStarted = () => {
  hasActiveShift = true;
  console.log("✅ Shift started - enabling heartbeat");
  if (socket && socket.connected && authenticated) {
    startHeartbeat();
  }
};

/**
 * Notify socket service that shift has ended
 * This will stop sending heartbeats
 */
export const notifyShiftEnded = () => {
  hasActiveShift = false;
  stopHeartbeat();
  console.log("🛑 Shift ended - heartbeat disabled");
};
