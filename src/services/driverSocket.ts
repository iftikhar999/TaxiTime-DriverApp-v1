import { io, Socket } from "socket.io-client";
import { SOCKET_BASE_URL } from "../config/environment";
import type { LocationUpdate } from "../native/locationService";
import { offlineEventQueue, QueuedEvent } from "./offlineEventQueue";
import { NativeModules } from "react-native";

/**
 * ✅ UNIFIED INTERVAL CONTROL - DATABASE DRIVEN
 * 
 * All location-related intervals are controlled by CompanySettings database:
 * 1. GPS detection interval → Native LocationTrackingService
 * 2. Socket emission throttle → LOCATION_THROTTLE_MS (this file)
 * 3. Map UI refresh → userLocationUpdateInterval (MapView)
 * 4. Heartbeat interval → HEARTBEAT_INTERVAL_MS (socket keepalive)
 * 
 * Configuration flow:
 * - Database: CompanySettings.locationUpdateInterval (e.g., 5 seconds)
 * - Database: CompanySettings.heartbeatInterval (e.g., 5 seconds)
 * - HomeScreen fetches → calls updateSocketIntervals()
 * - Socket throttle = locationUpdateInterval (unified control)
 * - Heartbeat = heartbeatInterval (if set) or locationUpdateInterval (fallback)
 * 
 * ⚠️ CRITICAL: Socket throttle MUST match GPS interval to avoid gaps!
 */

type DriverSocketConfig = {
  driverId: string;
  companyId?: string | null;
};

type OutgoingEventType =
  | "status"
  | "location"
  | "job_progress"
  | "meter_telemetry"
  | "meter_snapshot"
  | "heartbeat";

type SmartEmitOptions = {
  ackEvent?: string;
  errorEvent?: string;
  timeoutMs?: number;
};

type OutgoingEvent = {
  type: OutgoingEventType;
  eventName: string;
  payload: any;
  ackEvent?: string;
  errorEvent?: string;
  timeoutMs?: number;
  eventId?: string;
};

const DEFAULT_ACK_TIMEOUT_MS = 7000;

let LOCATION_THROTTLE_MS = 5000; // Default 5s, updated from database via updateSocketIntervals()
let HEARTBEAT_INTERVAL_MS = 30000; // Default 30s, updated from database via updateSocketIntervals()

let socket: Socket | null = null;
let currentDriver: DriverSocketConfig | null = null;

// 🆕 Module-level active job tracker — set by JobContext whenever the driver's
// active job changes. Used by emitDriverLocation so location pings include
// a jobId and can be routed to the passenger's /customer socket room.
let activeJobIdForLocation: string | null = null;
export const setActiveJobIdForLocation = (jobId: string | null) => {
  activeJobIdForLocation = jobId;
};
let authenticated = false;
// Fallback so we still authenticate against an older server that doesn't send
// the `authenticated` ack — set optimistically after this delay if no ack.
let authFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let lastLocationSentAt = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastHeartbeatSentAt = 0;
let isOnline = false;
let hasActiveShift = false; // Track if driver has active shift
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let maxReconnectDelay = 60000; // Max 60 seconds between retries
let shiftRestorationCallback: (() => Promise<void>) | null = null;
let lastConnectionAttempt = 0;
let connectionInProgress = false;
const MIN_CONNECTION_INTERVAL = 3000; // Minimum 3 seconds between connection attempts
const generateEventId = () =>
  `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

// Function to update location throttle interval dynamically
export const updateLocationThrottleInterval = (intervalSeconds: number) => {
  const intervalMs = intervalSeconds * 1000;
  const oldThrottle = LOCATION_THROTTLE_MS;
  LOCATION_THROTTLE_MS = intervalMs;
  console.log(
    `🔄 Socket location throttle CHANGED: ${oldThrottle / 1000}s → ${intervalSeconds}s (${intervalMs}ms)`
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
  console.log(`🔧 updateSocketIntervals CALLED:`, {
    locationIntervalSeconds,
    heartbeatIntervalSeconds,
    currentThrottle: `${LOCATION_THROTTLE_MS / 1000}s`,
  });
  
  updateLocationThrottleInterval(locationIntervalSeconds);

  // If heartbeat interval is provided, use it; otherwise use a sensible multiple of location interval
  const heartbeatSeconds =
    heartbeatIntervalSeconds ?? Math.max(locationIntervalSeconds * 6, 30);
  updateHeartbeatInterval(heartbeatSeconds);
};

// ✅ NEW: Get current throttle value for debugging
export const getCurrentThrottleMs = () => LOCATION_THROTTLE_MS;

/**
 * ✅ SMART RECONNECT: Ensure socket is connected, authenticated, and in rooms.
 * Called on app foreground, before critical operations, and periodically.
 * This is the single source of truth for "is the driver reachable?"
 */
export const ensureConnected = (): boolean => {
  if (!socket || !currentDriver) return false;

  if (!socket.connected) {
    console.log('🔌 ensureConnected: Socket disconnected — reconnecting...');
    reconnectAttempt = 0;
    socket.connect();
    return false;
  }

  // Socket is connected but may not be authenticated (room not joined)
  if (!authenticated) {
    console.log('🔐 ensureConnected: Connected but not authenticated — re-authenticating...');
    authenticateIfReady();
    return false;
  }

  // Fully healthy
  return true;
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
    // Do NOT assume success. Wait for the server `authenticated` ack (handled
    // where the socket is created) before treating ourselves as in-room; that
    // ack flips `authenticated`. Fallback: if no ack arrives shortly (older
    // server), set it optimistically so we don't stay stuck unauthenticated.
    if (authFallbackTimer) clearTimeout(authFallbackTimer);
    authFallbackTimer = setTimeout(() => {
      if (!authenticated) {
        console.warn("⚠️ No auth ack received — assuming authenticated (fallback)");
        authenticated = true;
      }
    }, 3000);

    console.log("✅ Authentication event emitted (awaiting ack)");
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

// ✅ NEW: Job assignment callback for real-time job notifications
let jobAssignedCallbacks: Array<(job: any) => void> = [];

// ✅ NEW: Job unassignment/recall callback for when job is taken back
let jobUnassignedCallbacks = new Set<(data: any) => void>();

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
 * ✅ NEW: Register a callback for new job assignments
 * Called when server emits 'job_assigned' event
 */
export const registerJobAssignedCallback = (callback: (job: any) => void) => {
  if (!jobAssignedCallbacks.includes(callback)) {
    jobAssignedCallbacks.push(callback);
    console.log(`✅ Job assigned callback registered (total: ${jobAssignedCallbacks.length})`);
  }
};

/**
 * ✅ NEW: Unregister a job assigned callback
 */
export const unregisterJobAssignedCallback = (callback: (job: any) => void) => {
  jobAssignedCallbacks = jobAssignedCallbacks.filter(cb => cb !== callback);
  console.log(`🧹 Job assigned callback unregistered (remaining: ${jobAssignedCallbacks.length})`);
};

/**
 * ✅ NEW: Register a callback for job unassignment/recall
 * Called when dispatch takes back job or job is cancelled
 */
export const registerJobUnassignedCallback = (callback: (data: any) => void) => {
  jobUnassignedCallbacks.add(callback);
  console.log(`✅ Job unassigned callback registered (total: ${jobUnassignedCallbacks.size})`);
};

/**
 * ✅ NEW: Unregister a job unassigned callback
 */
export const unregisterJobUnassignedCallback = (callback: (data: any) => void) => {
  jobUnassignedCallbacks.delete(callback);
  console.log(`🧹 Job unassigned callback unregistered (remaining: ${jobUnassignedCallbacks.size})`);
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

  // 🛡️ CRASH PROTECTION: Prevent rapid reconnection attempts
  const now = Date.now();
  if (connectionInProgress) {
    console.log("⚠️ Connection already in progress, returning existing socket");
    return socket!;
  }
  
  // The rapid-reconnect cooldown only applies when a socket already exists.
  // Previously, when it fired with NO socket yet, it created a bare
  // `autoConnect:false` socket with NO event handlers and returned it — a
  // socket that could connect but never authenticate or receive `job_assigned`
  // (silently missed offers). If there's no socket, fall through and build the
  // real one (handlers attached) instead of a handler-less placeholder.
  if (now - lastConnectionAttempt < MIN_CONNECTION_INTERVAL && socket) {
    console.log("⏳ Connection attempted too soon; returning existing socket");
    return socket;
  }

  lastConnectionAttempt = now;

  if (socket) {
    if (!socket.connected) {
      connectionInProgress = true;
      socket.connect();
      setTimeout(() => { connectionInProgress = false; }, 2000);
    } else if (!authenticated) {
      // ✅ FIX: Only authenticate if not already authenticated
      // This prevents double authentication when useEffect re-runs
      console.log("⚠️ Socket already connected but not authenticated - authenticating now");
      authenticateIfReady();
    } else {
      console.log("✅ Socket already connected and authenticated - skipping re-authentication");
    }
    return socket;
  }

  connectionInProgress = true;
  socket = io(`${SOCKET_BASE_URL}/driver`, {
    transports: ["websocket"],
    forceNew: false,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity, // ✅ Never stop trying to reconnect
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });

  // Server ack for `authenticate` — the ONLY thing that should flip us to
  // authenticated. Registered once on the fresh socket (survives reconnects
  // since the same socket instance is reused).
  socket.on("authenticated", () => {
    authenticated = true;
    if (authFallbackTimer) { clearTimeout(authFallbackTimer); authFallbackTimer = null; }
    console.log("✅ Server confirmed authentication");
  });

  // Debug tap for job-ish events. Registered ONCE here (not inside `connect`,
  // which re-added a new listener on every reconnect → listener/log leak).
  socket.onAny((eventName: string, ...args: any[]) => {
    if (eventName.includes('job') || eventName.includes('recall') || eventName.includes('unassign')) {
      console.log(`🔔 SOCKET EVENT: ${eventName}`, JSON.stringify(args));
    }
  });

  socket.on("connect", async () => {
    console.log("🟢 Socket connected successfully");
    isOnline = true;
    reconnectAttempt = 0; // Reset attempt counter on successful connection
    connectionInProgress = false; // Clear connection flag

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
      const result = await offlineEventQueue.processQueue(async (event: QueuedEvent) => {
        if (!socket || !socket.connected) {
          throw new Error("Socket not ready");
        }
        await emitSocketEvent(event);
      });
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

  // ✅ Listen for driver kicked event (from dispatch)
  socket.on(`driver:kicked:${currentDriver?.driverId}`, (data: any) => {
    console.error('🚨 DRIVER KICKED BY DISPATCH:', {
      reason: data.reason,
      kickedBy: data.kickedBy,
      timestamp: data.timestamp,
      message: data.message,
    });
    
    // ✅ Notify all callbacks to clear state
    if (driverStateRestorationCallbacks.length > 0) {
      console.log(`📢 Broadcasting kicked event to ${driverStateRestorationCallbacks.length} callbacks`);
      const nullState = {
        shift: null,
        vehicle: null,
        tariff: null,
        job: null,
        kicked: true,
        kickReason: data.reason || 'Kicked by dispatcher',
        kickMessage: data.message || 'Your session has been terminated by dispatch',
      };
      driverStateRestorationCallbacks.forEach((callback) => {
        try {
          callback(nullState);
        } catch (error) {
          console.error('❌ Failed to notify kicked:', error);
        }
      });
    }
    
    // ✅ Call specific kicked callback if registered
    if (kickedCallback) {
      kickedCallback(data);
    }
    
    console.log('⚠️ Driver kicked - forcing logout');
  });

  // ✅ NEW: Listen for job assignment notifications
  socket.on("job_assigned", async (jobData: any) => {
    console.log('🎯 NEW JOB ASSIGNED:', {
      jobId: jobData.id,
      pickup: jobData.pickupAddress,
      dropoff: jobData.dropoffAddress,
      estimatedFare: jobData.estimatedPrice,
      distance: jobData.estimatedDistance,
    });
    
    // ✅ CRITICAL: Show full-screen notification for locked device (like incoming call)
    try {
      const { JobNotification } = NativeModules;
      if (JobNotification) {
        await JobNotification.showJobNotification(
          jobData.id || jobData.jobId,
          jobData.pickupAddress || 'Unknown pickup',
          jobData.dropoffAddress || 'Unknown dropoff',
          jobData.estimatedPrice ? `$${jobData.estimatedPrice.toFixed(2)}` : 'N/A'
        );
        console.log('🔔 Full-screen notification shown (works even on locked device)');
      }
    } catch (error) {
      console.error('❌ Failed to show notification:', error);
    }
    
    // ✅ CRITICAL: Bring app to foreground when job is assigned
    try {
      const { AppBringToFront } = NativeModules;
      if (AppBringToFront) {
        const result = await AppBringToFront.bringToFront();
        console.log('📱 App brought to foreground:', result);
      }
    } catch (error) {
      console.error('❌ Failed to bring app to foreground:', error);
    }
    
    // Notify all registered callbacks
    if (jobAssignedCallbacks.length > 0) {
      console.log(`📢 Broadcasting job to ${jobAssignedCallbacks.length} callbacks`);
      jobAssignedCallbacks.forEach((callback, index) => {
        try {
          callback(jobData);
        } catch (error) {
          console.error(`❌ Job callback ${index + 1} failed:`, error);
        }
      });
    } else {
      console.warn('⚠️ Job assigned but no callbacks registered to handle it');
    }
  });

  // ✅ Listen for FCFS broadcast-offer closure. When one driver claims a
  // broadcast job via POST /api/mobile/driver/jobs/:jobId/claim, the backend
  // fan-outs this event to every OTHER driver so their offer modal dismisses.
  // We reuse the same jobUnassignedCallbacks path because "offer closed" and
  // "job cancelled" have identical UI effect for the losing drivers — hide
  // the modal, bail on ringtones.
  socket.on("job:offer:closed", (data: { jobId: string; internalJobId?: string; claimedBy?: string; reason?: string }) => {
    console.log('🔒 JOB OFFER CLOSED (another driver claimed):', {
      jobId: data.jobId,
      claimedBy: data.claimedBy,
    });
    try {
      const { JobNotification } = NativeModules;
      if (JobNotification) {
        JobNotification.cancelJobNotification();
      }
    } catch (_e) { /* non-fatal */ }
    if (jobUnassignedCallbacks.size > 0) {
      jobUnassignedCallbacks.forEach((callback, index) => {
        try {
          callback({ ...data, reason: data.reason || 'another_driver_claimed' });
        } catch (error) {
          console.error(`❌ Offer-closed callback ${index + 1} failed:`, error);
        }
      });
    }
  });

  // ✅ Listen for job cancelled/removed notifications
  socket.on("job:cancelled", (data: { jobId: string; internalJobId?: string; reason?: string }) => {
    console.log('❌ JOB CANCELLED:', {
      jobId: data.jobId,
      internalJobId: data.internalJobId,
      reason: data.reason || 'No reason provided',
    });
    
    // Cancel the notification when job is cancelled
    try {
      const { JobNotification } = NativeModules;
      if (JobNotification) {
        JobNotification.cancelJobNotification();
        console.log('🔕 Job notification cancelled');
      }
    } catch (error) {
      console.error('❌ Failed to cancel notification:', error);
    }
    
    // Trigger job unassignment callbacks
    if (jobUnassignedCallbacks.size > 0) {
      jobUnassignedCallbacks.forEach((callback, index) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Job unassign callback ${index + 1} failed:`, error);
        }
      });
    }
  });

  // ✅ Listen for job unassigned notifications (dispatch takes back job)
  socket.on("job_unassigned", (data: { jobId: string; internalJobId?: string; reason?: string; message?: string }) => {
    console.log('🔄 JOB UNASSIGNED (taken back by dispatch):', {
      jobId: data.jobId,
      internalJobId: data.internalJobId,
      reason: data.reason || 'No reason provided',
      message: data.message,
    });
    
    // Cancel the notification when job is unassigned
    try {
      const { JobNotification } = NativeModules;
      if (JobNotification) {
        JobNotification.cancelJobNotification();
        console.log('🔕 Job notification cancelled');
      }
    } catch (error) {
      console.error('❌ Failed to cancel notification:', error);
    }
    
    // Trigger job unassignment callbacks
    if (jobUnassignedCallbacks.size > 0) {
      jobUnassignedCallbacks.forEach((callback, index) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Job unassign callback ${index + 1} failed:`, error);
        }
      });
    }
  });

  // ✅ Listen for job recalled notifications (alternate event name)
  socket.on("job:recalled", (data: { jobId: string; internalJobId?: string; reason?: string; message?: string }) => {
    console.log('🔄 JOB RECALLED (taken back by dispatch):', {
      jobId: data.jobId,
      internalJobId: data.internalJobId,
      reason: data.reason || 'No reason provided',
      message: data.message,
    });
    
    // Cancel the notification when job is recalled
    try {
      const { JobNotification } = NativeModules;
      if (JobNotification) {
        JobNotification.cancelJobNotification();
        console.log('🔕 Job notification cancelled');
      }
    } catch (error) {
      console.error('❌ Failed to cancel notification:', error);
    }
    
    // Trigger job unassignment callbacks
    if (jobUnassignedCallbacks.size > 0) {
      jobUnassignedCallbacks.forEach((callback, index) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`❌ Job unassign callback ${index + 1} failed:`, error);
        }
      });
    }
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

const isSocketReady = () => Boolean(socket && socket.connected && authenticated);

const emitSocketEvent = async (event: OutgoingEvent): Promise<void> => {
  if (!socket) {
    throw new Error("Socket is not initialized");
  }

  const eventId = event.eventId ?? generateEventId();
  const payload =
    typeof event.payload === "object" && event.payload !== null
      ? event.payload.eventId
        ? event.payload
        : { ...event.payload, eventId }
      : { value: event.payload, eventId };

  if (!event.ackEvent) {
    socket.emit(event.eventName, payload);
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutMs = event.timeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    const ackEventName = event.ackEvent!;

    let settled = false;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      socket.off(ackEventName, ackHandler);
      if (event.errorEvent) {
        socket.off(event.errorEvent, errorHandler);
      }
      clearTimeout(timeoutId);
      resolve();
    };

    const ackHandler = (ackPayload: any) => {
      if (ackPayload?.eventId && ackPayload.eventId !== eventId) {
        return;
      }
      cleanup();
    };

    const errorHandler = (errorPayload: any) => {
      if (errorPayload?.eventId && errorPayload.eventId !== eventId) {
        return;
      }
      console.warn(
        `[socket] Event error received for ${event.eventName}:`,
        errorPayload
      );
      cleanup();
    };

    const timeoutId = setTimeout(() => {
      console.warn(
        `[socket] Ack timeout for ${event.eventName} (eventId=${eventId})`
      );
      cleanup();
    }, timeoutMs);

    socket.once(ackEventName, ackHandler);
    if (event.errorEvent) {
      socket.once(event.errorEvent, errorHandler);
    }

    socket.emit(event.eventName, payload);
  });
};

/**
 * Smart emit - sends immediately if online, queues if offline
 */
const smartEmit = async (
  eventName: string,
  payload: any,
  eventType: OutgoingEventType,
  options: SmartEmitOptions = {}
) => {
  const event: OutgoingEvent = {
    type: eventType,
    eventName,
    payload,
    ...options,
  };

  if (isSocketReady()) {
    try {
      await emitSocketEvent(event);
      return;
    } catch (error) {
      console.warn(
        `[socket] Failed to emit ${eventName} immediately, queuing`,
        error
      );
    }
  }

  await offlineEventQueue.enqueue({
    ...event,
    eventId: event.eventId ?? generateEventId(),
  });
  console.log(`📥 Event queued (offline): ${eventName}`);
};

export const emitDriverLocation = (
  location: LocationUpdate,
  appState?: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE',
  activeJobId?: string | null,
) => {
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
  
  // ✅ DIAGNOSTIC: Always log throttle check to debug gaps
  console.log(`🔍 LOCATION THROTTLE CHECK:`, {
    timeSinceLastSend: `${Math.round(timeSinceLastSend / 1000)}s`,
    throttleLimit: `${LOCATION_THROTTLE_MS / 1000}s`,
    willEmit: timeSinceLastSend >= LOCATION_THROTTLE_MS,
    lastSentAt: new Date(lastLocationSentAt).toLocaleTimeString(),
    currentTime: new Date(now).toLocaleTimeString(),
  });
  
  if (timeSinceLastSend < LOCATION_THROTTLE_MS) {
    console.log(`⏱️ Location THROTTLED - need ${Math.round((LOCATION_THROTTLE_MS - timeSinceLastSend) / 1000)}s more`);
    return;
  }

  lastLocationSentAt = now;

  const payload: any = {
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

  // 🆕 Include the active jobId so the backend can route this location update
  // to the passenger's /customer socket room (`job_<jobId>`). Without this
  // field the passenger never sees the driver move on the map even though
  // the driver app is emitting regularly.
  const jobIdToInclude = activeJobId ?? activeJobIdForLocation;
  if (jobIdToInclude) {
    payload.jobId = jobIdToInclude;
  }

  // Smart emit - queues if offline
  smartEmit("driver:location:update", payload, "location");
  
  console.log('📍 LOCATION EMITTED:', {
    driverId: currentDriver.driverId,
    lat: location.latitude?.toFixed(6),
    lng: location.longitude?.toFixed(6),
    appState,
    throttleMs: LOCATION_THROTTLE_MS,
  });
  
  // ✨ NEW: Log when app is in background
  if (appState === 'BACKGROUND') {
    console.log('📱 Location sent from BACKGROUND - app is minimized');
  }
};

/**
 * Emit app state change to dispatcher
 * Notifies when driver app goes to background or comes back to foreground
 * ✅ CRITICAL: Forces socket health check + reconnect on foreground return
 */
export const emitAppStateChange = (appState: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE') => {
  if (!currentDriver) return;

  // ✅ SMART RECONNECT: When app comes to foreground, verify socket is alive
  if (appState === 'ACTIVE') {
    ensureConnected();
  }

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

// Kicked callback - called when driver is kicked by dispatch
let kickedCallback: ((data: { reason: string; kickedBy?: string; timestamp: string; message: string }) => void) | null = null;

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
 * Register callback for when driver is kicked by dispatch
 * This will force logout the driver
 */
export const registerKickedListener = (
  callback: (data: { reason: string; kickedBy?: string; timestamp: string; message: string }) => void
) => {
  kickedCallback = callback;
  console.log('🚨 Kicked listener registered');
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

export const emitDriverStatus = async (
  status: string,
  location?: LocationUpdate
) => {
  if (!currentDriver) {
    return;
  }

  console.log('🚦 [DriverSocket] Emitting driver status update', {
    driverId: currentDriver.driverId,
    companyId: currentDriver.companyId,
    status,
    hasLocation: !!location,
    timestamp: new Date().toISOString(),
  });

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

  return smartEmit("driver:status:update", payload, "status", {
    ackEvent: "server:status:confirmed",
    errorEvent: "server:status:error",
  });
};

/**
 * Emit job progress update to backend
 * @param jobId - The job/ride ID
 * @param status - Job status (ASSIGNED, ON_THE_WAY, ARRIVED, ACTIVE/STARTED, REACHED, COMPLETED, REJECTED, CANCELLED)
 * @param location - Optional current location
 * @param extraData - Optional extra data (e.g., finalAmount, paymentMethod, completedAt)
 */
export const emitJobProgress = async (
  jobId: string,
  status: string,
  location?: LocationUpdate,
  extraData?: Record<string, any>
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
    ...extraData, // ✅ NEW: Include extra data like finalAmount, paymentMethod
  };

  console.log("📊 Emitting job:progress:update", payload);
  return smartEmit("job:progress:update", payload, "job_progress", {
    ackEvent: "server:job:progress:confirmed",
    errorEvent: "server:job:progress:error",
  });
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
 * Emit persistent meter snapshot (stored on backend)
 */
export const emitMeterSnapshot = (
  jobId: string,
  telemetry: {
    elapsedSeconds: number;
    distanceMeters: number;
    waitingSeconds?: number;
    currentFare?: number;
    speedKmh?: number;
  },
  location?: LocationUpdate,
  extras?: {
    status?: string | null;
    isPaused?: boolean;
    recordedAt?: number;
    reason?: string;
    routeSegment?: Array<{
      latitude: number;
      longitude: number;
      timestamp?: number;
    }>;
  }
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
          accuracy: location.accuracy ?? null,
          timestamp: location.timestamp ?? Date.now(),
        }
      : undefined,
    status: extras?.status ?? null,
    isPaused: extras?.isPaused ?? false,
    recordedAt: extras?.recordedAt ?? Date.now(),
    reason: extras?.reason ?? "interval",
    routeSegment:
      extras?.routeSegment && extras.routeSegment.length > 0
        ? extras.routeSegment
        : undefined,
  };

  console.log("📡 Emitting meter:snapshot", {
    jobId,
    status: payload.status,
    points: payload.routeSegment?.length ?? 0,
    reason: payload.reason,
  });

  smartEmit("meter:snapshot", payload, "meter_snapshot");
};

/**
 * Start sending heartbeat to backend every 30s
 * Only sends heartbeats when driver has an active shift
 */
const startHeartbeat = () => {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  const intervalMs = Math.max(HEARTBEAT_INTERVAL_MS || 0, 5000);

  const sendHeartbeat = () => {
    if (
      socket &&
      currentDriver &&
      authenticated &&
      socket.connected &&
      hasActiveShift
    ) {
      lastHeartbeatSentAt = Date.now();
      socket.emit("driver:heartbeat", {
        driverId: currentDriver.driverId,
        companyId: currentDriver.companyId ?? undefined,
        timestamp: lastHeartbeatSentAt,
      });
      console.log("💓 Heartbeat sent");
    }
  };

  heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, intervalMs);

  const now = Date.now();
  if (now - lastHeartbeatSentAt >= intervalMs) {
    sendHeartbeat();
  } else {
    console.log(
      "⏱️ Skipping immediate heartbeat (recently sent within interval)"
    );
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
