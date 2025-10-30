/**
 * Enhanced Driver Status Management System
 * Real-time socket-based status updates with comprehensive job tracking
 */

export type EnhancedDriverStatus =
  | "AVAILABLE" // Ready to receive jobs
  | "ROGER" // Job accepted, on the way to pickup
  | "BUSY" // Job in progress (started meter)
  | "AWAY" // Temporarily unavailable
  | "OFFLINE"; // Not on shift

export type JobProgressStatus =
  | "INCOMING" // Job offer received
  | "ASSIGNED" // Driver accepted job, awaiting departure
  | "ACCEPTED" // Legacy alias for ASSIGNED (triggers ROGER status)
  | "ON_THE_WAY" // Proceeding to pickup (ROGER status)
  | "ARRIVED" // Arrived at pickup (ROGER status)
  | "STARTED" // Meter running (BUSY status)
  | "COMPLETED" // Job finished (back to AVAILABLE)
  | "CANCELLED"; // Job cancelled

export interface DriverLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: string;
}

export interface ZoneInfo {
  id: string;
  name: string;
  queuePosition?: number;
}

export interface JobMetrics {
  totalTime: number; // Total job duration in minutes
  totalCost: number; // Total fare amount
  waitingTime: number; // Time spent waiting at pickup
  drivingTime: number; // Time spent driving
  distance: number; // Total distance covered
  averageSpeed: number; // Average speed during trip
}

export interface ActiveJobDetails {
  jobId: string;
  status: JobProgressStatus;
  startTime?: string;
  pickupTime?: string;
  arrivalTime?: string;
  completionTime?: string;
  metrics: JobMetrics;
  customer: {
    name?: string;
    phone?: string;
    rating?: number;
  };
  pickup: {
    address: string;
    coordinates: DriverLocation;
  };
  dropoff: {
    address: string;
    coordinates: DriverLocation;
  };
}

export interface EnhancedDriverState {
  driverId: string;
  companyId: string;
  status: EnhancedDriverStatus;
  location: DriverLocation;
  zone: ZoneInfo | null;
  activeJob: ActiveJobDetails | null;
  shiftInfo: {
    shiftId: string;
    startTime: string;
    earnings: number;
    completedTrips: number;
  };
  lastUpdate: string;
}

/**
 * Meter telemetry payload for enriched meter data
 */
export interface MeterTelemetryPayload {
  jobId: string;
  driverId: string;
  meterStatus: "started" | "running" | "stopped";
  timestamp: string;
  // Detailed meter metrics
  details: {
    elapsedTime: number; // Seconds since meter started
    distance: number; // Meters traveled since meter start
    currentSpeed: number; // Current speed in km/h
    averageSpeed: number; // Average speed since start
    fareAmount: number; // Current fare calculation
    waitingTime: number; // Time spent stationary (in seconds)
    // Location data
    currentLocation: DriverLocation;
    // Trip segments for detailed tracking
    segments?: Array<{
      startTime: string;
      endTime: string;
      startLocation: DriverLocation;
      endLocation: DriverLocation;
      distance: number;
      duration: number;
      averageSpeed: number;
    }>;
  };
}

/**
 * Status transition rules
 * Defines valid status changes and automatic transitions
 */
export const STATUS_TRANSITIONS: Record<
  EnhancedDriverStatus,
  EnhancedDriverStatus[]
> = {
  AVAILABLE: ["ROGER", "AWAY", "OFFLINE"],
  ROGER: ["BUSY", "AVAILABLE"], // BUSY when job starts, AVAILABLE if cancelled
  BUSY: ["AVAILABLE"], // Only AVAILABLE when job completes
  AWAY: ["AVAILABLE", "OFFLINE"],
  OFFLINE: ["AVAILABLE"],
};

/**
 * Automatic status transitions based on job progress
 */
export const JOB_STATUS_TO_DRIVER_STATUS: Record<
  JobProgressStatus,
  EnhancedDriverStatus
> = {
  INCOMING: "AVAILABLE", // Still available until accepted
  ASSIGNED: "ROGER", // Job accepted, on the way
  ACCEPTED: "ROGER", // Job accepted, on the way
  ON_THE_WAY: "ROGER", // Proceeding to pickup
  ARRIVED: "ROGER", // Arrived at pickup
  STARTED: "BUSY", // Meter running
  COMPLETED: "AVAILABLE", // Job finished
  CANCELLED: "AVAILABLE", // Job cancelled
};

export interface StatusUpdatePayload {
  driverId: string;
  oldStatus: EnhancedDriverStatus;
  newStatus: EnhancedDriverStatus;
  jobId?: string;
  jobStatus?: JobProgressStatus;
  location: DriverLocation;
  timestamp: string;
  reason: "manual" | "job_progress" | "system";
}

export interface LocationUpdatePayload {
  driverId: string;
  location: DriverLocation;
  zone: ZoneInfo | null;
  movementState: "stationary" | "walking" | "driving" | "unknown";
  timestamp: string;
}

export interface JobProgressPayload {
  driverId: string;
  jobId: string;
  oldStatus: JobProgressStatus;
  newStatus: JobProgressStatus;
  metrics: Partial<JobMetrics>;
  timestamp: string;
}

/**
 * Socket event types for real-time communication
 */
export const SOCKET_EVENTS = {
  // Driver to Server
  DRIVER_STATUS_UPDATE: "driver:status:update",
  DRIVER_LOCATION_UPDATE: "driver:location:update",
  JOB_PROGRESS_UPDATE: "job:progress:update",
  DRIVER_HEARTBEAT: "driver:heartbeat",

  // Server to Clients
  DRIVER_STATUS_CHANGED: "driver:status:changed",
  DRIVER_LOCATION_CHANGED: "driver:location:changed",
  JOB_PROGRESS_CHANGED: "job:progress:changed",
  ZONE_QUEUE_UPDATED: "zone:queue:updated",

  // Dispatch Events
  DISPATCH_DRIVER_ONLINE: "dispatch:driver:online",
  DISPATCH_DRIVER_OFFLINE: "dispatch:driver:offline",
  DISPATCH_JOB_ASSIGNED: "dispatch:job:assigned",
  DISPATCH_METRICS_UPDATE: "dispatch:metrics:update",

  // Meter Telemetry Events
  METER_STARTED: "meter:started",
  METER_STOPPED: "meter:stopped",
  METER_TELEMETRY: "meter:telemetry",
} as const;
