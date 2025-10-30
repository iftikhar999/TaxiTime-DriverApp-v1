import AsyncStorage from "@react-native-async-storage/async-storage";
import { io, Socket } from "socket.io-client";
import {
  ActiveJobDetails,
  DriverLocation,
  EnhancedDriverState,
  EnhancedDriverStatus,
  JOB_STATUS_TO_DRIVER_STATUS,
  JobProgressPayload,
  JobProgressStatus,
  LocationUpdatePayload,
  MeterTelemetryPayload,
  SOCKET_EVENTS,
  STATUS_TRANSITIONS,
  StatusUpdatePayload,
} from "../types/enhancedDriverStatus";

/**
 * Enhanced Real-time Driver Status Manager
 * Handles all driver status updates, location tracking, and job progress
 * with real-time socket communication
 */
class EnhancedDriverStatusManager {
  private socket: Socket | null = null;
  private driverState: EnhancedDriverState | null = null;
  private locationUpdateInterval: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Map<string, Function[]> = new Map();

  constructor() {
    this.initializeListeners();
  }

  /**
   * Initialize the socket connection and restore driver state
   */
  async initialize(
    driverId: string,
    companyId: string,
    token: string
  ): Promise<void> {
    try {
      // Restore previous state
      await this.restoreDriverState();

      // Initialize socket connection with enhanced resilience
      this.socket = io("http://localhost:3000/driver", {
        auth: {
          token,
          userId: driverId,
          companyId,
        },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 10, // More attempts for reliability
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000, // Max delay between attempts
        timeout: 20000,
        forceNew: false,
      });

      this.setupSocketListeners();

      // Initialize driver state if not exists
      if (!this.driverState) {
        this.driverState = {
          driverId,
          companyId,
          status: "OFFLINE",
          location: {
            latitude: 0,
            longitude: 0,
            timestamp: new Date().toISOString(),
          },
          zone: null,
          activeJob: null,
          shiftInfo: {
            shiftId: "",
            startTime: new Date().toISOString(),
            earnings: 0,
            completedTrips: 0,
          },
          lastUpdate: new Date().toISOString(),
        };
      }

      console.log("✅ EnhancedDriverStatusManager initialized");
    } catch (error) {
      console.error(
        "❌ Failed to initialize EnhancedDriverStatusManager:",
        error
      );
      throw error;
    }
  }

  /**
   * Set up socket event listeners
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    this.socket.on("connect", () => {
      console.log("🔌 Driver socket connected");

      // Send authenticate event to register backend handlers
      if (this.driverState) {
        this.socket?.emit("authenticate", {
          userId: this.driverState.driverId,
          companyId: this.driverState.companyId,
        });
        console.log("✅ Driver authenticated with backend");
      }

      this.emit("socketConnected", true);
      this.startHeartbeat();

      // On reconnect, replay current state to ensure dispatch sync
      this.replayCurrentState();
    });

    this.socket.on("disconnect", () => {
      console.log("🔌 Driver socket disconnected");
      this.emit("socketConnected", false);
      this.stopHeartbeat();
    });

    this.socket.on("connect_error", (error) => {
      console.error("🔌 Socket connection error:", error);
      this.emit("socketError", error);
    });

    // Listen for server responses
    this.socket.on(
      SOCKET_EVENTS.DRIVER_STATUS_CHANGED,
      this.handleStatusChanged.bind(this)
    );
    this.socket.on(
      SOCKET_EVENTS.ZONE_QUEUE_UPDATED,
      this.handleZoneQueueUpdated.bind(this)
    );
    this.socket.on(
      SOCKET_EVENTS.DISPATCH_JOB_ASSIGNED,
      this.handleJobAssigned.bind(this)
    );
  }

  /**
   * Replay current driver state on socket reconnection
   * Ensures dispatch portal has up-to-date information after reconnect
   */
  private replayCurrentState(): void {
    if (!this.driverState || !this.socket?.connected) {
      return;
    }

    console.log("🔄 Replaying current driver state after reconnect");

    // Replay current status
    const statusPayload: StatusUpdatePayload = {
      driverId: this.driverState.driverId,
      oldStatus: this.driverState.status,
      newStatus: this.driverState.status,
      location: this.driverState.location,
      timestamp: new Date().toISOString(),
      reason: "system",
    };

    this.socket.emit(SOCKET_EVENTS.DRIVER_STATUS_UPDATE, statusPayload);

    // Replay current location
    const locationPayload: LocationUpdatePayload = {
      driverId: this.driverState.driverId,
      location: this.driverState.location,
      zone: this.driverState.zone,
      movementState: "unknown", // Unknown on reconnect
      timestamp: new Date().toISOString(),
    };

    this.socket.emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, locationPayload);

    // If there's an active job, replay job progress
    if (this.driverState.activeJob) {
      const jobPayload: JobProgressPayload = {
        jobId: this.driverState.activeJob.jobId,
        driverId: this.driverState.driverId,
        oldStatus: this.driverState.activeJob.status,
        newStatus: this.driverState.activeJob.status,
        metrics: this.driverState.activeJob.metrics,
        timestamp: new Date().toISOString(),
      };

      this.socket.emit(SOCKET_EVENTS.JOB_PROGRESS_UPDATE, jobPayload);
    }

    console.log("✅ State replay completed - dispatch should now be in sync");
  }

  /**
   * Update driver status with automatic transitions and validation
   */
  async updateStatus(
    newStatus: EnhancedDriverStatus,
    reason: "manual" | "job_progress" | "system" = "manual",
    jobId?: string,
    jobStatus?: JobProgressStatus
  ): Promise<boolean> {
    if (!this.driverState) {
      await this.restoreDriverState();
    }

    if (!this.driverState) {
      console.warn("⚠️ Driver state not initialized - shift not started yet");
      return false;
    }

    const oldStatus = this.driverState.status;

    // Validate status transition
    if (!this.isValidStatusTransition(oldStatus, newStatus)) {
      console.warn(
        `⚠️ Invalid status transition: ${oldStatus} -> ${newStatus}`
      );
      return false;
    }

    // Update local state
    this.driverState.status = newStatus;
    this.driverState.lastUpdate = new Date().toISOString();

    // Prepare payload
    const payload: StatusUpdatePayload = {
      driverId: this.driverState.driverId,
      oldStatus,
      newStatus,
      jobId,
      jobStatus,
      location: this.driverState.location,
      timestamp: this.driverState.lastUpdate,
      reason,
    };

    // Emit to server via socket (real-time)
    if (this.socket?.connected) {
      this.socket.emit(SOCKET_EVENTS.DRIVER_STATUS_UPDATE, payload);
    }

    // Also send via REST API to ensure backend sync (dual approach)
    try {
      // Dynamic import to avoid circular dependency
      const { default: httpClient } = await import("./httpClient");
      await httpClient.put("/mobile/driver/shift/status", {
        status: newStatus,
        jobId,
        location: this.driverState.location,
        reason,
      });
      console.log(`📡 Status updated via REST API: ${newStatus}`);
    } catch (restError) {
      console.warn(
        "⚠️ REST status update failed, socket update sent:",
        restError
      );
    }

    // Save state
    await this.saveDriverState();

    // Emit to local listeners
    this.emit("statusChanged", payload);

    console.log(`📱 Status updated: ${oldStatus} -> ${newStatus} (${reason})`);
    return true;
  }

  /**
   * Update job progress and automatically adjust driver status
   */
  async updateJobProgress(
    jobId: string,
    newJobStatus: JobProgressStatus,
    metrics?: Partial<ActiveJobDetails["metrics"]>
  ): Promise<boolean> {
    if (
      !this.driverState?.activeJob ||
      this.driverState.activeJob.jobId !== jobId
    ) {
      console.error("❌ No active job or job ID mismatch");
      return false;
    }

    const oldJobStatus = this.driverState.activeJob.status;
    const newDriverStatus = JOB_STATUS_TO_DRIVER_STATUS[newJobStatus];

    // Update job details
    this.driverState.activeJob.status = newJobStatus;

    // Update timestamps
    const now = new Date().toISOString();
    switch (newJobStatus) {
      case "ASSIGNED":
      case "ACCEPTED":
        this.driverState.activeJob.startTime = now;
        break;
      case "ARRIVED":
        this.driverState.activeJob.arrivalTime = now;
        break;
      case "STARTED":
        this.driverState.activeJob.pickupTime = now;
        break;
      case "COMPLETED":
        this.driverState.activeJob.completionTime = now;
        this.driverState.shiftInfo.completedTrips++;
        if (this.driverState.activeJob.metrics.totalCost) {
          this.driverState.shiftInfo.earnings +=
            this.driverState.activeJob.metrics.totalCost;
        }
        break;
    }

    // Update metrics if provided
    if (metrics) {
      this.driverState.activeJob.metrics = {
        ...this.driverState.activeJob.metrics,
        ...metrics,
      };
    }

    // Emit job progress update
    const jobPayload: JobProgressPayload = {
      driverId: this.driverState.driverId,
      jobId,
      oldStatus: oldJobStatus,
      newStatus: newJobStatus,
      metrics: this.driverState.activeJob.metrics,
      timestamp: now,
    };

    if (this.socket?.connected) {
      this.socket.emit(SOCKET_EVENTS.JOB_PROGRESS_UPDATE, jobPayload);
    }

    this.emit("jobProgressChanged", jobPayload);

    // Update driver status if needed
    if (this.driverState.status !== newDriverStatus) {
      await this.updateStatus(
        newDriverStatus,
        "job_progress",
        jobId,
        newJobStatus
      );
    }

    // Clear active job on completion/cancellation
    if (["COMPLETED", "CANCELLED"].includes(newJobStatus)) {
      this.driverState.activeJob = null;
    }

    await this.saveDriverState();

    console.log(`🚗 Job progress: ${oldJobStatus} -> ${newJobStatus}`);
    return true;
  }

  /**
   * Emit enriched meter telemetry data for real-time dispatch tracking
   */
  emitMeterTelemetry(
    jobId: string,
    meterStatus: "started" | "running" | "stopped",
    meterData: {
      elapsedTime: number;
      distance: number;
      currentSpeed: number;
      averageSpeed: number;
      fareAmount: number;
      waitingTime: number;
      segments?: Array<{
        startTime: string;
        endTime: string;
        startLocation: DriverLocation;
        endLocation: DriverLocation;
        distance: number;
        duration: number;
        averageSpeed: number;
      }>;
    }
  ): void {
    if (!this.driverState || !this.socket?.connected) {
      return;
    }

    const payload: MeterTelemetryPayload = {
      jobId,
      driverId: this.driverState.driverId,
      meterStatus,
      timestamp: new Date().toISOString(),
      details: {
        ...meterData,
        currentLocation: this.driverState.location,
      },
    };

    // Emit to dispatch for real-time tracking
    this.socket.emit(SOCKET_EVENTS.METER_TELEMETRY, payload);

    // Emit meter-specific events
    if (meterStatus === "started") {
      this.socket.emit(SOCKET_EVENTS.METER_STARTED, {
        jobId,
        driverId: this.driverState.driverId,
        startTime: payload.timestamp,
        startLocation: this.driverState.location,
      });
    } else if (meterStatus === "stopped") {
      this.socket.emit(SOCKET_EVENTS.METER_STOPPED, {
        jobId,
        driverId: this.driverState.driverId,
        stopTime: payload.timestamp,
        finalMetrics: meterData,
      });
    }

    console.log(`📊 Meter telemetry emitted: ${meterStatus} for job ${jobId}`);
  }

  /**
   * Update location with zone detection and real-time tracking
   */
  async updateLocation(
    location: DriverLocation,
    movementState?: "stationary" | "walking" | "driving" | "unknown"
  ): Promise<void> {
    if (!this.driverState) {
      console.warn("⚠️ Driver state not initialized - shift not started yet");
      return;
    }

    // Update location
    this.driverState.location = {
      ...location,
      timestamp: new Date().toISOString(),
    };
    this.driverState.lastUpdate = this.driverState.location.timestamp;

    // Prepare location payload
    const payload: LocationUpdatePayload = {
      driverId: this.driverState.driverId,
      location: this.driverState.location,
      zone: this.driverState.zone,
      movementState: movementState || "unknown",
      timestamp: this.driverState.lastUpdate,
    };

    // Emit to server for zone detection
    if (this.socket?.connected) {
      this.socket.emit(SOCKET_EVENTS.DRIVER_LOCATION_UPDATE, payload);
    }

    // Update job metrics if active
    if (this.driverState.activeJob && location.speed !== undefined) {
      this.updateJobMetricsFromLocation(location);
    }

    // Save state
    await this.saveDriverState();

    // Emit to local listeners
    this.emit("locationChanged", payload);
  }

  /**
   * Start real-time location tracking
   */
  startLocationTracking(interval: number = 5000): void {
    if (this.locationUpdateInterval) {
      clearInterval(this.locationUpdateInterval);
    }

    this.locationUpdateInterval = setInterval(() => {
      // Location updates would be triggered by GPS in real implementation
      this.emit("locationUpdateRequired");
    }, interval);

    console.log(`📍 Location tracking started (${interval}ms interval)`);
  }

  /**
   * Stop location tracking
   */
  stopLocationTracking(): void {
    if (this.locationUpdateInterval) {
      clearInterval(this.locationUpdateInterval);
      this.locationUpdateInterval = null;
    }
    console.log("📍 Location tracking stopped");
  }

  /**
   * Start shift and go online
   */
  async startShift(shiftId: string, vehicleId: string): Promise<boolean> {
    if (!this.driverState) {
      console.warn("⚠️ Driver state not initialized - shift not started yet");
      return false;
    }

    this.driverState.shiftInfo = {
      shiftId,
      startTime: new Date().toISOString(),
      earnings: 0,
      completedTrips: 0,
    };

    return await this.updateStatus("AVAILABLE", "manual");
  }

  /**
   * End shift and go offline
   */
  async endShift(): Promise<boolean> {
    this.stopLocationTracking();

    if (this.driverState?.status === "OFFLINE") {
      return true; // Already offline
    }

    const success = await this.updateStatus("OFFLINE", "manual");

    if (success && this.driverState) {
      // Clear active job
      this.driverState.activeJob = null;

      // Explicitly notify dispatch system about driver going offline
      if (this.socket?.connected) {
        this.socket.emit(SOCKET_EVENTS.DISPATCH_DRIVER_OFFLINE, {
          driverId: this.driverState.driverId,
          companyId: this.driverState.companyId,
          timestamp: new Date().toISOString(),
          reason: "shift_ended",
        });
        console.log("📡 Dispatch notified: Driver going offline");
      }

      await this.saveDriverState();
    }

    return success;
  }

  /**
   * Set active job
   */
  setActiveJob(job: ActiveJobDetails): void {
    if (this.driverState) {
      this.driverState.activeJob = job;
      this.saveDriverState();
    }
  }

  /**
   * Get current driver state
   */
  getDriverState(): EnhancedDriverState | null {
    return this.driverState;
  }

  /**
   * Get current status
   */
  getCurrentStatus(): EnhancedDriverStatus | null {
    return this.driverState?.status || null;
  }

  /**
   * Check if status transition is valid
   */
  private isValidStatusTransition(
    from: EnhancedDriverStatus,
    to: EnhancedDriverStatus
  ): boolean {
    return STATUS_TRANSITIONS[from]?.includes(to) || false;
  }

  /**
   * Update job metrics from location data
   */
  private updateJobMetricsFromLocation(location: DriverLocation): void {
    if (!this.driverState?.activeJob) return;

    const job = this.driverState.activeJob;
    const now = Date.now();

    if (job.startTime) {
      const startTime = new Date(job.startTime).getTime();
      job.metrics.totalTime = Math.round((now - startTime) / 1000 / 60); // minutes
    }

    if (location.speed !== undefined) {
      job.metrics.averageSpeed = location.speed;
    }

    // Calculate distance (simplified - would use proper GPS calculation)
    if (location.latitude && location.longitude) {
      // Distance calculation would be implemented here
    }
  }

  /**
   * Handle server-side status change confirmation
   */
  private handleStatusChanged(payload: StatusUpdatePayload): void {
    console.log("📡 Status change confirmed by server:", payload);
    this.emit("serverStatusUpdate", payload);
  }

  /**
   * Handle zone queue updates
   */
  private handleZoneQueueUpdated(data: any): void {
    if (this.driverState && data.zoneId === this.driverState.zone?.id) {
      if (this.driverState.zone) {
        this.driverState.zone.queuePosition = data.queuePosition;
      }
      this.emit("queuePositionChanged", data);
    }
  }

  /**
   * Handle job assignment from dispatch
   */
  private handleJobAssigned(jobData: any): void {
    console.log("📋 Job assigned by dispatch:", jobData);
    this.emit("jobAssigned", jobData);
  }

  /**
   * Start heartbeat to maintain connection
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected && this.driverState) {
        this.socket.emit(SOCKET_EVENTS.DRIVER_HEARTBEAT, {
          driverId: this.driverState.driverId,
          status: this.driverState.status,
          timestamp: new Date().toISOString(),
        });
      }
    }, 30000); // 30 second heartbeat
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Initialize event listeners
   */
  private initializeListeners(): void {
    this.listeners = new Map();
  }

  /**
   * Add event listener
   */
  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(callback);
  }

  /**
   * Remove event listener
   */
  off(event: string, callback: Function): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  /**
   * Emit event to listeners
   */
  private emit(event: string, data?: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach((callback) => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  /**
   * Save driver state to persistent storage
   */
  private async saveDriverState(): Promise<void> {
    if (this.driverState) {
      try {
        await AsyncStorage.setItem(
          "enhanced_driver_state",
          JSON.stringify(this.driverState)
        );
      } catch (error) {
        console.error("❌ Failed to save driver state:", error);
      }
    }
  }

  /**
   * Restore driver state from persistent storage
   */
  private async restoreDriverState(): Promise<void> {
    try {
      const stateJson = await AsyncStorage.getItem("enhanced_driver_state");
      if (stateJson) {
        this.driverState = JSON.parse(stateJson);
        console.log("✅ Driver state restored from storage");
      }
    } catch (error) {
      console.error("❌ Failed to restore driver state:", error);
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.stopLocationTracking();
    this.stopHeartbeat();

    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }

    this.listeners.clear();
    console.log("🧹 EnhancedDriverStatusManager disposed");
  }
}

// Export singleton instance
export const driverStatusManager = new EnhancedDriverStatusManager();
