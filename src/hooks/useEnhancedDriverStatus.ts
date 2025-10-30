import { useCallback, useEffect, useRef, useState } from "react";
import { driverStatusManager } from "../services/enhancedDriverStatusManager";
import {
  ActiveJobDetails,
  DriverLocation,
  EnhancedDriverState,
  EnhancedDriverStatus,
  JobProgressPayload,
  JobProgressStatus,
  LocationUpdatePayload,
  StatusUpdatePayload,
} from "../types/enhancedDriverStatus";

interface UseEnhancedDriverStatusOptions {
  driverId: string;
  companyId: string;
  token: string;
  locationUpdateInterval?: number;
  autoStart?: boolean;
}

interface UseEnhancedDriverStatusReturn {
  // State
  driverState: EnhancedDriverState | null;
  currentStatus: EnhancedDriverStatus | null;
  isConnected: boolean;
  isInitialized: boolean;

  // Actions
  updateStatus: (
    status: EnhancedDriverStatus,
    reason?: "manual" | "job_progress" | "system"
  ) => Promise<boolean>;
  updateLocation: (
    location: DriverLocation,
    movementState?: "stationary" | "walking" | "driving" | "unknown"
  ) => Promise<void>;
  updateJobProgress: (
    jobId: string,
    status: JobProgressStatus,
    metrics?: Partial<ActiveJobDetails["metrics"]>
  ) => Promise<boolean>;

  // Job Management
  setActiveJob: (job: ActiveJobDetails) => void;

  // Shift Management
  startShift: (shiftId: string, vehicleId: string) => Promise<boolean>;
  endShift: () => Promise<boolean>;

  // Location Tracking
  startLocationTracking: () => void;
  stopLocationTracking: () => void;

  // Real-time Data
  queuePosition: number | null;
  jobMetrics: ActiveJobDetails["metrics"] | null;
}

/**
 * Enhanced React hook for real-time driver status management
 * Provides comprehensive state management with socket-based real-time updates
 */
export const useEnhancedDriverStatus = ({
  driverId,
  companyId,
  token,
  locationUpdateInterval = 5000,
  autoStart = true,
}: UseEnhancedDriverStatusOptions): UseEnhancedDriverStatusReturn => {
  // State
  const [driverState, setDriverState] = useState<EnhancedDriverState | null>(
    null
  );
  const [isConnected, setIsConnected] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);

  // Refs to prevent stale closures
  const driverIdRef = useRef(driverId);
  const companyIdRef = useRef(companyId);
  const tokenRef = useRef(token);

  // Update refs when values change
  useEffect(() => {
    driverIdRef.current = driverId;
    companyIdRef.current = companyId;
    tokenRef.current = token;
  }, [driverId, companyId, token]);

  /**
   * Initialize the status manager
   */
  const initialize = useCallback(async () => {
    try {
      await driverStatusManager.initialize(
        driverIdRef.current,
        companyIdRef.current,
        tokenRef.current
      );

      const state = driverStatusManager.getDriverState();
      setDriverState(state);
      setIsInitialized(true);

      console.log("✅ Enhanced driver status hook initialized");
    } catch (error) {
      console.error("❌ Failed to initialize enhanced driver status:", error);
      setIsInitialized(false);
    }
  }, []);

  /**
   * Setup event listeners
   */
  const setupEventListeners = useCallback(() => {
    // Socket connection events
    driverStatusManager.on("socketConnected", (connected: boolean) => {
      setIsConnected(connected);
    });

    driverStatusManager.on("socketError", (error: any) => {
      console.error("Socket error:", error);
      setIsConnected(false);
    });

    // Status change events
    driverStatusManager.on("statusChanged", (payload: StatusUpdatePayload) => {
      const state = driverStatusManager.getDriverState();
      setDriverState(state);
      console.log("📱 Status changed:", payload);
    });

    // Location updates
    driverStatusManager.on(
      "locationChanged",
      (payload: LocationUpdatePayload) => {
        const state = driverStatusManager.getDriverState();
        setDriverState(state);
      }
    );

    // Job progress updates
    driverStatusManager.on(
      "jobProgressChanged",
      (payload: JobProgressPayload) => {
        const state = driverStatusManager.getDriverState();
        setDriverState(state);
        console.log("🚗 Job progress changed:", payload);
      }
    );

    // Queue position updates
    driverStatusManager.on("queuePositionChanged", (data: any) => {
      setQueuePosition(data.queuePosition);
    });

    // Server confirmations
    driverStatusManager.on(
      "serverStatusUpdate",
      (payload: StatusUpdatePayload) => {
        console.log("📡 Server confirmed status update:", payload);
      }
    );

    // Job assignments from dispatch
    driverStatusManager.on("jobAssigned", (jobData: any) => {
      console.log("📋 New job assigned:", jobData);
      // Emit custom event or use callback
    });

    return () => {
      // Cleanup listeners
      driverStatusManager.off("socketConnected", setIsConnected);
      driverStatusManager.off("socketError", console.error);
      driverStatusManager.off("statusChanged", () => {});
      driverStatusManager.off("locationChanged", () => {});
      driverStatusManager.off("jobProgressChanged", () => {});
      driverStatusManager.off("queuePositionChanged", setQueuePosition);
      driverStatusManager.off("serverStatusUpdate", console.log);
      driverStatusManager.off("jobAssigned", console.log);
    };
  }, []);

  // Initialize on mount
  useEffect(() => {
    if (
      autoStart &&
      driverIdRef.current &&
      companyIdRef.current &&
      tokenRef.current
    ) {
      initialize();
    }

    const cleanup = setupEventListeners();

    return () => {
      cleanup();
    };
  }, [initialize, setupEventListeners, autoStart]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      driverStatusManager.dispose();
    };
  }, []);

  /**
   * Status update action
   */
  const updateStatus = useCallback(
    async (
      status: EnhancedDriverStatus,
      reason: "manual" | "job_progress" | "system" = "manual"
    ): Promise<boolean> => {
      const success = await driverStatusManager.updateStatus(status, reason);
      if (success) {
        const state = driverStatusManager.getDriverState();
        setDriverState(state);
      }
      return success;
    },
    []
  );

  /**
   * Location update action
   */
  const updateLocation = useCallback(
    async (
      location: DriverLocation,
      movementState?: "stationary" | "walking" | "driving" | "unknown"
    ): Promise<void> => {
      await driverStatusManager.updateLocation(location, movementState);
      const state = driverStatusManager.getDriverState();
      setDriverState(state);
    },
    []
  );

  /**
   * Job progress update action
   */
  const updateJobProgress = useCallback(
    async (
      jobId: string,
      status: JobProgressStatus,
      metrics?: Partial<ActiveJobDetails["metrics"]>
    ): Promise<boolean> => {
      const success = await driverStatusManager.updateJobProgress(
        jobId,
        status,
        metrics
      );
      if (success) {
        const state = driverStatusManager.getDriverState();
        setDriverState(state);
      }
      return success;
    },
    []
  );

  /**
   * Set active job
   */
  const setActiveJob = useCallback((job: ActiveJobDetails) => {
    driverStatusManager.setActiveJob(job);
    const state = driverStatusManager.getDriverState();
    setDriverState(state);
  }, []);

  /**
   * Start shift
   */
  const startShift = useCallback(
    async (shiftId: string, vehicleId: string): Promise<boolean> => {
      const success = await driverStatusManager.startShift(shiftId, vehicleId);
      if (success) {
        driverStatusManager.startLocationTracking(locationUpdateInterval);
        const state = driverStatusManager.getDriverState();
        setDriverState(state);
      }
      return success;
    },
    [locationUpdateInterval]
  );

  /**
   * End shift
   */
  const endShift = useCallback(async (): Promise<boolean> => {
    const success = await driverStatusManager.endShift();
    if (success) {
      const state = driverStatusManager.getDriverState();
      setDriverState(state);
    }
    return success;
  }, []);

  /**
   * Start location tracking
   */
  const startLocationTracking = useCallback(() => {
    driverStatusManager.startLocationTracking(locationUpdateInterval);
  }, [locationUpdateInterval]);

  /**
   * Stop location tracking
   */
  const stopLocationTracking = useCallback(() => {
    driverStatusManager.stopLocationTracking();
  }, []);

  // Derived values
  const currentStatus = driverState?.status || null;
  const jobMetrics = driverState?.activeJob?.metrics || null;

  return {
    // State
    driverState,
    currentStatus,
    isConnected,
    isInitialized,

    // Actions
    updateStatus,
    updateLocation,
    updateJobProgress,

    // Job Management
    setActiveJob,

    // Shift Management
    startShift,
    endShift,

    // Location Tracking
    startLocationTracking,
    stopLocationTracking,

    // Real-time Data
    queuePosition,
    jobMetrics,
  };
};
