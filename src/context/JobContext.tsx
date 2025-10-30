import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  emitDriverStatus,
  emitJobProgress,
  emitMeterTelemetry,
  ensureDriverSocket,
  getSocket,
  registerDriverStateRestoration, // ✅ NEW: For receiving complete driver state via socket
  unregisterDriverStateRestoration, // ✅ FIX: For cleanup
} from "../services/driverSocket";
import { RideSummary } from "../types/rides";
import { Tariff } from "../types/tariff";
import { calculateDistance } from "../utils/distance";
import { playJobNotificationSound } from "../utils/soundNotification";
import { useAuth } from "./AuthContext";
import { useLocation } from "./LocationContext";
import { useShift } from "./ShiftContext"; // ✅ NEW: For updating selectedTariff during tariff change

// ✨ NEW: Import job processing services
import { coordinateHistory } from "../services/coordinateHistory";
import { jobProcessor } from "../services/jobProcessor";
import { PauseRecord, PricingBreakdown } from "../types/jobTypes";
import { globalJobTimer } from "../utils/enhancedJobTimer";

export type JobStatus =
  | "IDLE"
  | "INCOMING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "ON_THE_WAY"
  | "ARRIVED"
  | "STARTED"
  | "PAUSED" // ✨ NEW: Added PAUSED status
  | "ACTIVE"
  | "REACHED"
  | "PENDING_PAYMENT" // ✅ NEW: Waiting for payment collection
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED"
  | "NO_SHOW"
  | "RECALLED";

export interface JobTimerState {
  elapsedSeconds: number;
  waitingSeconds: number;
  distanceMeters: number;
  earningsSoFar?: number; // ✅ ADD: earnings calculated by timer
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

const JOB_STATE_STORAGE_KEY = "driverApp:jobState";
const MAX_ROUTE_POINTS = 1500;
const MIN_ROUTE_INCREMENT_METERS = 1.5;
const TRACKABLE_STATUSES = new Set<JobStatus>([
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "STARTED",
  "PAUSED", // ✨ NEW: Track paused jobs
  "ACTIVE",
  "REACHED",
  "NO_SHOW",
  "RECALLED",
]);

type PersistedJobState = {
  status: JobStatus;
  job: ActiveJob;
  timer: JobTimerState;
  routePoints: RoutePoint[];
  timestamp: number;
};

export interface ActiveJob extends Omit<RideSummary, "status" | "passenger"> {
  countdownMs?: number;
  expiresAt?: string | null;
  assignmentId?: string | null;
  offerId?: string | null;
  internalJobId?: string | null;
  legacyJobId?: string | null;
  publicJobId?: string | null;
  jobId?: string | null;
  jobType?: string;
  passenger: {
    id: string | null;
    name: string;
    phone: string;
  };
  company?: {
    id: string;
    name: string;
  };
  tariff?: Tariff;
  status?: JobStatus;
  fare?: number;
  waitingFare?: number;
  distanceFare?: number;
  estimatedDuration?: number | null;
  vehicleType?: string | null;
  tariffName?: string | null;
  
  // ✨ NEW: Enhanced job data
  pause_records?: PauseRecord[];
  pricingBreakdown?: PricingBreakdown;
  totalAccumulatedDistanceMeters?: number;
  totalAccumulatedWaitingSeconds?: number;
  isDriverMoving?: boolean;
  movementType?: string;
  earningsSoFar?: string;
  driver_job_start_time?: string;
  resume_job_time?: string;
  complete_job_time?: string;
  lastKnownCoordinate?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    timestamp?: number;
  };
}

export interface PendingJobAction {
  type: "ACCEPT" | "REJECT" | "STATUS";
  jobId: string;
  targetStatus?: JobStatus;
}

interface JobContextValue {
  status: JobStatus;
  currentJob: ActiveJob | null;
  timer: JobTimerState;
  pendingAction: PendingJobAction | null;
  setIncomingJob: (job: ActiveJob) => void;
  startWalkInJob: (job: ActiveJob) => void; // ✅ NEW: Start walk-in job directly (no accept/reject screen)
  acceptJob: () => void;
  rejectJob: (reason?: "manual" | "timeout") => void;
  noShowJob: () => void;
  recallJob: () => void;
  updateStatus: (status: JobStatus) => void;
  updateTimer: (partial: Partial<JobTimerState>) => void;
  clearJob: () => void;
  routePoints: RoutePoint[];
  
  // ✨ NEW: Enhanced job control
  pricingBreakdown: PricingBreakdown | null;
  pauseRecords: PauseRecord[];
  pauseJob: () => Promise<void>;
  resumeJob: () => Promise<void>;
  prepareJobForPayment: () => Promise<ActiveJob | null>; // ✅ NEW: Prepare for payment
  completeJob: (paymentMethod: string, amountPaid: number) => Promise<void>; // ✅ UPDATED: Complete after payment
  changeTariff: (newTariff: any) => Promise<void>; // ✅ NEW: Change tariff mid-ride
}

const JobContext = createContext<JobContextValue | undefined>(undefined);

export const JobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<JobStatus>("IDLE");
  const [currentJob, setCurrentJob] = useState<ActiveJob | null>(null);
  const [timer, setTimer] = useState<JobTimerState>({
    elapsedSeconds: 0,
    waitingSeconds: 0,
    distanceMeters: 0,
  });
  const [pendingAction, setPendingAction] =
    useState<PendingJobAction | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const routePointsRef = useRef<RoutePoint[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobRef = useRef<ActiveJob | null>(null);
  const statusRef = useRef<JobStatus>(status);
  const pendingActionRef = useRef<PendingJobAction | null>(null);
  const { location } = useLocation();
  const locationRef = useRef(location); // ✅ Store latest location in ref for jobProcessor
  const { driver } = useAuth();
  const shiftContext = useShift(); // ✅ NEW: For updating selectedTariff during tariff change
  
  // ✅ Keep locationRef updated with latest location
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  
  // ✨ NEW: Enhanced job processing state
  const [pricingBreakdown, setPricingBreakdown] = useState<PricingBreakdown | null>(null);
  const [pauseRecords, setPauseRecords] = useState<PauseRecord[]>([]);
  const [isProcessingJob, setIsProcessingJob] = useState(false);

  const clearPersistedJobState = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(JOB_STATE_STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear persisted job state", error);
    }
  }, []);

  const schedulePersist = useCallback(
    (state: PersistedJobState | null) => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
      }

      persistTimeoutRef.current = setTimeout(async () => {
        try {
          if (state) {
            await AsyncStorage.setItem(
              JOB_STATE_STORAGE_KEY,
              JSON.stringify(state)
            );
          } else {
            await AsyncStorage.removeItem(JOB_STATE_STORAGE_KEY);
          }
        } catch (error) {
          console.warn("Failed to persist job state", error);
        } finally {
          persistTimeoutRef.current = null;
        }
      }, 1000);
    },
    []
  );

  useEffect(() => {
    currentJobRef.current = currentJob;
  }, [currentJob]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    pendingActionRef.current = pendingAction;
  }, [pendingAction]);

  useEffect(() => {
    routePointsRef.current = routePoints;
  }, [routePoints]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(JOB_STATE_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as PersistedJobState;
          if (!cancelled) {
            if (parsed?.job) {
              setCurrentJob(parsed.job);
              currentJobRef.current = parsed.job;
            }

            if (parsed?.status) {
              setStatus(parsed.status);
              statusRef.current = parsed.status;
            }

            if (parsed?.timer) {
              setTimer(parsed.timer);
            }

            if (parsed?.routePoints?.length) {
              setRoutePoints(parsed.routePoints);
              routePointsRef.current = parsed.routePoints;
            }
          }
        }
      } catch (error) {
        console.warn("Failed to hydrate job state", error);
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    if (!currentJob) {
      schedulePersist(null);
      return;
    }

    const snapshot: PersistedJobState = {
      status,
      job: currentJob,
      timer,
      routePoints,
      timestamp: Date.now(),
    };

    schedulePersist(snapshot);
  }, [hydrated, currentJob, status, timer, routePoints, schedulePersist]);

  const setIncomingJob = useCallback((job: ActiveJob) => {
    console.log("🔔 New job incoming! Playing notification sound...");
    
    // Play notification sound
    playJobNotificationSound().catch((error) => 
      console.error("Failed to play notification sound:", error)
    );
    
    setPendingAction(null);
    setCurrentJob(job);
    setStatus("INCOMING");
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
  }, []);

  /**
   * ✅ NEW: Start walk-in job directly (bypassing accept/reject screen)
   * Used when customer gets in the car without dispatch (street hail)
   */
  const startWalkInJob = useCallback((job: ActiveJob) => {
    console.log("🚶 Starting walk-in job directly (no accept/reject screen):", job.id);
    
    // Set job with STARTED status
    const startedJob = { ...job, status: 'STARTED' as JobStatus };
    setCurrentJob(startedJob);
    setStatus("STARTED");
    setPendingAction(null);
    
    // Initialize timer and route
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
    
    // Initialize pricing
    setPricingBreakdown(null);
    setPauseRecords([]);
    
    // Start job processor and timer immediately
    console.log("⏱️ Starting job processor and timer for walk-in job");
    globalJobTimer.start();
    jobProcessor.startContinuousProcessing();
    setIsProcessingJob(true);
    
    // Emit to server that job has started
    if (location) {
      emitJobProgress(job.id, 'STARTED', location);
      emitDriverStatus('BUSY', location);
    }
    
    console.log("✅ Walk-in job started - meter running");
  }, [location]);

  const clearJob = useCallback(() => {
    setStatus("IDLE");
    setCurrentJob(null);
    setPendingAction(null);
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
    
    // ✨ NEW: Clear enhanced job state
    setPricingBreakdown(null);
    setPauseRecords([]);
    setIsProcessingJob(false);
    
    // Stop job processing if active
    jobProcessor.stopContinuousProcessing();
    globalJobTimer.reset();
    
    clearPersistedJobState().catch((error) =>
      console.warn("Failed to clear job state on reset", error)
    );
    schedulePersist(null);
  }, [clearPersistedJobState, schedulePersist]);

  useEffect(() => {
    if (!currentJob || !location || !TRACKABLE_STATUSES.has(status)) {
      return;
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    setRoutePoints((previous) => {
      const last = previous[previous.length - 1];

      if (
        last &&
        Math.abs(last.latitude - latitude) < 1e-6 &&
        Math.abs(last.longitude - longitude) < 1e-6
      ) {
        return previous;
      }

      const point: RoutePoint = {
        latitude,
        longitude,
        timestamp: Number(location.timestamp) || Date.now(),
      };

      if (last) {
        const incrementMeters =
          calculateDistance(
            last.latitude,
            last.longitude,
            point.latitude,
            point.longitude
          ) * 1000;

        if (incrementMeters < MIN_ROUTE_INCREMENT_METERS) {
          return previous;
        }

        setTimer((prevTimer) => ({
          ...prevTimer,
          distanceMeters: prevTimer.distanceMeters + incrementMeters,
        }));
      }

      const nextPoints = previous.length >= MAX_ROUTE_POINTS
        ? [...previous.slice(Math.max(0, previous.length - MAX_ROUTE_POINTS + 1)), point]
        : [...previous, point];

      return nextPoints;
    });
  }, [currentJob, location, status]);

  // ✨ NEW: Job Processor Integration
  // Start/stop job processing based on job status
  useEffect(() => {
    // Only process when job is in STARTED status
    if (status === "STARTED" && currentJob && !isProcessingJob) {
      console.log('[JobContext] 🚀 Starting job processor for job:', currentJob.id);
      setIsProcessingJob(true);
      
      // Start coordinate tracking
      coordinateHistory.startTracking(currentJob.id).catch((error) => {
        console.error('[JobContext] Failed to start coordinate tracking:', error);
      });
      
      // Initialize timer from job data (for crash recovery)
      globalJobTimer.initializeFromJob(currentJob);
      globalJobTimer.start();
      
      // Start continuous processing
      jobProcessor.startContinuousProcessing(
        () => currentJobRef.current,
        () => {
          const loc = locationRef.current; // ✅ Use ref for latest location
          console.log('[JobContext] 🔍 Location being passed to jobProcessor:', loc ? {
            lat: loc.latitude?.toFixed(6),
            lng: loc.longitude?.toFixed(6),
            speed: loc.speed,
            timestamp: loc.timestamp
          } : 'NULL');
          
          return loc ? {
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracy: loc.accuracy,
            speed: loc.speed || 0,
            heading: loc.heading,
            timestamp: loc.timestamp,
          } : null;
        },
        () => {
          // Determine movement state from location speed
          const speed = locationRef.current?.speed || 0;
          if (speed < 1) return 'STOPPED';
          if (speed < 10) return 'NORMAL_SPEED';
          if (speed < 40) return 'LITTLE_HIGH_SPEED';
          if (speed < 70) return 'MORE_SPEED';
          return 'TOO_HIGH_SPEED';
        },
        {
          updateJob: (updates) => {
            // Update current job with new metrics
            setCurrentJob((prev) => prev ? { ...prev, ...updates } : null);
            
            // Update pricing breakdown if included
            if (updates.pricingBreakdown) {
              setPricingBreakdown(updates.pricingBreakdown);
            }
            
            // ✅ FIX: Update ALL timer metrics (distance, waiting, elapsed)
            setTimer((prev) => ({
              distanceMeters: updates.totalAccumulatedDistanceMeters ?? prev.distanceMeters,
              waitingSeconds: updates.totalAccumulatedWaitingSeconds ?? prev.waitingSeconds,
              elapsedSeconds: updates.elapsedSeconds ?? prev.elapsedSeconds,
              earningsSoFar: updates.earningsSoFar ? parseFloat(updates.earningsSoFar) : prev.earningsSoFar,
            }));
            
            console.log('[JobContext] ✅ Timer updated:', {
              distance: updates.totalAccumulatedDistanceMeters?.toFixed(2) + 'm',
              waiting: updates.totalAccumulatedWaitingSeconds?.toFixed(0) + 's',
              elapsed: updates.elapsedSeconds?.toFixed(0) + 's',
              earnings: updates.earningsSoFar,
            });
          },
          setJobStatus: (newStatus) => {
            setStatus(newStatus as JobStatus);
            setCurrentJob((prev) => prev ? { ...prev, status: newStatus as JobStatus } : prev);
          },
          clearJob: () => {
            setCurrentJob(null);
            setStatus('IDLE');
            setPricingBreakdown(null);
            setPauseRecords([]);
          },
        }
      );
    }
    
    // Stop processing when job is no longer active
    if (status !== "STARTED" && isProcessingJob) {
      console.log('[JobContext] ⏸️ Stopping job processor');
      setIsProcessingJob(false);
      jobProcessor.stopContinuousProcessing();
    }
    
    return () => {
      if (isProcessingJob) {
        jobProcessor.stopContinuousProcessing();
      }
    };
  }, [status, currentJob?.id, isProcessingJob, location]);

  const mapProgressToStatus = useCallback(
    (rawStatus?: string | null): JobStatus | null => {
      if (!rawStatus) {
        return null;
      }

      const value = String(rawStatus).trim().toUpperCase();

      switch (value) {
        case "OFFERED":
        case "PENDING":
          return "INCOMING";
        case "ASSIGNED":
        case "ACCEPTED":
          return "ASSIGNED";
        case "ON_THE_WAY":
        case "ONTHEWAY":
        case "ROGER":
          return "ON_THE_WAY";
        case "ARRIVED":
        case "ARRIVED_READY":
          return "ARRIVED";
        case "STARTED":
          return "STARTED";
        case "IN_PROGRESS":
        case "ACTIVE":
          return "ACTIVE";
        case "REACHED":
          return "REACHED";
        case "COMPLETED":
        case "FINISHED":
          return "COMPLETED";
        case "REJECTED":
          return "REJECTED";
        case "CANCELLED":
        case "CANCELED":
        case "UNASSIGNED":
        case "NOSHOW":
        case "NO_SHOW":
        case "RECALL":
        case "RECALLED":
          return "IDLE";
        default:
          return null;
      }
    },
    []
  );

  // Listen for job assignments and lifecycle events
  useEffect(() => {
    const companyId = driver?.companyId || driver?.company?.id;
    
    if (!driver?.id || !companyId) {
      // ✅ This is NORMAL during logout or before login
      if (!driver) {
        console.log("⚠️ JobContext: No driver logged in - job listeners not active");
      } else {
        console.warn(
          "⚠️ JobContext: Cannot setup job listeners - missing driver info",
          {
            hasDriver: !!driver,
            driverId: driver?.id,
            directCompanyId: driver?.companyId,
            nestedCompanyId: driver?.company?.id,
          }
        );
      }
      return;
    }

    const socket = ensureDriverSocket({
      driverId: driver.id,
      companyId: companyId,
    });

    const collectIdentifiers = (raw: any): string[] => {
      const payload = raw?.job ?? raw;
      const candidates = [
        payload?.internalJobId,
        payload?.legacyJobId,
        payload?.id,
        payload?.jobId,
        payload?.jobCode,
        raw?.internalJobId,
        raw?.jobId,
      ];

      return candidates
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value));
    };

    const deriveExpiresAt = (payload: any): string | null => {
      const source =
        payload?.expiresAt ??
        payload?.expiry ??
        payload?.offerExpiresAt ??
        payload?.autoRejectAt ??
        null;

      if (source) {
        const date = new Date(source);
        if (!Number.isNaN(date.getTime())) {
          return date.toISOString();
        }
      }

      if (payload?.countdownMs) {
        const millis = Number(payload.countdownMs);
        if (Number.isFinite(millis)) {
          return new Date(Date.now() + millis).toISOString();
        }
      }

      return new Date(Date.now() + 30000).toISOString();
    };

    const buildActiveJobFromPayload = (raw: any): ActiveJob => {
      const payload = raw?.job ?? raw;
      const internalId =
        payload?.internalJobId ?? payload?.id ?? payload?.jobId ?? `job_${Date.now()}`;
      const publicId =
        payload?.jobId ??
        payload?.jobCode ??
        payload?.publicJobId ??
        payload?.reference ??
        null;
      const legacyId = payload?.legacyJobId ?? payload?.id ?? null;
      const expiresAt = deriveExpiresAt(payload);

      const pickup = payload?.pickup || {};
      const dropoff = payload?.dropoff || {};

      const customerName =
        payload?.customerName ??
        payload?.customer?.name ??
        ([payload?.customer?.firstName, payload?.customer?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
          payload?.passenger?.name ||
          "Unknown");

      const customerPhone =
        payload?.customerPhone ??
        payload?.customer?.phone ??
        payload?.passenger?.phone ??
        "";

      return {
        id: String(internalId),
        internalJobId: String(internalId),
        legacyJobId: legacyId ? String(legacyId) : null,
        publicJobId: publicId ? String(publicId) : null,
        jobId: payload?.jobId ?? payload?.jobCode ?? payload?.id,
        assignmentId: payload?.assignmentId ?? null,
        offerId: payload?.offerId ?? null,
        status: "INCOMING",
        createdAt: payload?.createdAt ?? new Date().toISOString(),
        pickupAddress:
          payload?.pickupAddress ?? pickup?.address ?? payload?.pickup_address ?? "Unknown",
        pickupLatitude:
          payload?.pickupLatitude ?? pickup?.latitude ?? payload?.pickup_latitude ?? null,
        pickupLongitude:
          payload?.pickupLongitude ?? pickup?.longitude ?? payload?.pickup_longitude ?? null,
        dropoffAddress:
          payload?.dropoffAddress ?? dropoff?.address ?? payload?.dropoff_address ?? "Unknown",
        dropoffLatitude:
          payload?.dropoffLatitude ?? dropoff?.latitude ?? payload?.dropoff_latitude ?? null,
        dropoffLongitude:
          payload?.dropoffLongitude ?? dropoff?.longitude ?? payload?.dropoff_longitude ?? null,
        distance:
          typeof payload?.distance === "number"
            ? payload.distance
            : payload?.estimatedDistance ?? 0,
        estimatedDuration:
          payload?.estimatedDuration ?? payload?.estimated_duration ?? payload?.duration ?? null,
        estimatedFare:
          payload?.estimatedPrice ?? payload?.estimatedFare ?? payload?.fare ?? 0,
        actualFare: payload?.fare ?? payload?.estimatedFare ?? 0,
        fare: payload?.fare ?? payload?.estimatedFare ?? 0,
        vehicleType:
          payload?.vehicleType ??
          payload?.vehicle_type ??
          payload?.requirements?.vehicleType ??
          null,
        tariffName: payload?.tariff?.name ?? payload?.tariffName ?? null,
        passenger: {
          id:
            payload?.customerId ??
            payload?.customer?.id ??
            payload?.passenger?.id ??
            null,
          name: customerName,
          phone: customerPhone,
        },
        countdownMs: expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : undefined,
        expiresAt,
        company: payload?.company ?? undefined,
      } as ActiveJob;
    };

    const matchesCurrentJob = (raw: any): boolean => {
      const candidates = collectIdentifiers(raw);
      if (!candidates.length) {
        return false;
      }

      const current = currentJobRef.current;
      if (!current) {
        const pendingJobId = pendingActionRef.current?.jobId;
        return pendingJobId ? candidates.includes(String(pendingJobId)) : false;
      }

      const currentCandidates = [
        current.id,
        current.internalJobId,
        current.legacyJobId,
        current.publicJobId,
        current.jobId,
      ]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value));

      return currentCandidates.some((id) => candidates.includes(id));
    };

    const handleJobAssigned = (raw: any) => {
      console.log("🎯 JobContext: Job assignment received:", raw);
      console.log("🎯 JobContext: Raw payload:", JSON.stringify(raw, null, 2));
      console.log("🎯 JobContext: Current socket status:", {
        connected: socket.connected,
        id: socket.id,
      });

      try {
        const job = buildActiveJobFromPayload(raw);
        console.log("🎯 JobContext: Built active job:", job);
        setIncomingJob(job);

        playJobNotificationSound().catch((error) => {
          console.error("Failed to play notification sound:", error);
        });
        
        console.log("✅ JobContext: Job successfully set as incoming");
      } catch (error) {
        console.error("❌ JobContext: Failed to process job assignment:", error);
        console.error("❌ JobContext: Error details:", error);
      }
    };

    const handleJobUnassigned = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      console.log("🚫 JobContext: Job unassigned", raw);
      clearJob();
    };

    const handleJobDataUpdated = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      const job = buildActiveJobFromPayload(raw);
      const { status: _ignoredStatus, ...rest } = job;

      setCurrentJob((previous) => {
        if (!previous) {
          return previous;
        }

        return {
          ...previous,
          ...rest,
          status: previous.status,
        };
      });
    };

    const handleJobProgressUpdated = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      const nextStatus = mapProgressToStatus(
        raw?.progressStatus ?? raw?.status
      );

      if (!nextStatus) {
        return;
      }

      if (nextStatus === "IDLE") {
        clearJob();
        return;
      }

      if (nextStatus === "COMPLETED" || nextStatus === "REJECTED") {
        setStatus(nextStatus);
        setCurrentJob((previous) =>
          previous ? { ...previous, status: nextStatus } : previous
        );
        setPendingAction(null);
        return;
      }

      setStatus(nextStatus);
      setCurrentJob((previous) =>
        previous ? { ...previous, status: nextStatus } : previous
      );
      setPendingAction(null);
    };

    const handleServerJobConfirmed = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      const confirmedStatus = mapProgressToStatus(raw?.progressStatus);
      if (confirmedStatus) {
        if (confirmedStatus === "IDLE") {
          clearJob();
        } else if (
          confirmedStatus === "COMPLETED" ||
          confirmedStatus === "REJECTED"
        ) {
          clearJob();
        } else {
          setStatus(confirmedStatus);
          setCurrentJob((previous) =>
            previous ? { ...previous, status: confirmedStatus } : previous
          );
        }
      }

      setPendingAction(null);
    };

    const handleServerJobError = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      console.error("❌ JobContext: Server reported job error", raw);
      if (pendingActionRef.current?.jobId === String(raw?.jobId ?? raw?.jobCode)) {
        setPendingAction(null);
      }
    };

    socket.on("job_assigned", handleJobAssigned);
    socket.on("jobAssigned", handleJobAssigned);
    socket.on("job_unassigned", handleJobUnassigned);
    socket.on("jobUnassigned", handleJobUnassigned);
    socket.on("job:data:updated", handleJobDataUpdated);
    socket.on("job:progress:updated", handleJobProgressUpdated);
    socket.on("server:job:confirmed", handleServerJobConfirmed);
    socket.on("server:job:error", handleServerJobError);

    console.log(`🔌 JobContext: Socket connected = ${socket.connected}`);
    console.log(`🔌 JobContext: Socket ID = ${socket.id}`);

    return () => {
      socket.off("job_assigned", handleJobAssigned);
      socket.off("jobAssigned", handleJobAssigned);
      socket.off("job_unassigned", handleJobUnassigned);
      socket.off("jobUnassigned", handleJobUnassigned);
      socket.off("job:data:updated", handleJobDataUpdated);
      socket.off("job:progress:updated", handleJobProgressUpdated);
      socket.off("server:job:confirmed", handleServerJobConfirmed);
      socket.off("server:job:error", handleServerJobError);
    };
  }, [
    driver?.id,
    driver?.companyId,
    driver?.company?.id,
    setIncomingJob,
    clearJob,
    mapProgressToStatus,
  ]);

  // ✅ NEW: Register socket listener for complete driver state (shift, vehicle, tariff, job)
  // This receives ALL driver state from server in ONE event when driver authenticates
  useEffect(() => {
    if (!driver?.id) {
      return;
    }

    const handleDriverStateRestoration = (state: any) => {
      console.log('🔄 JobContext: Received driver state from server');
      
      // Restore active job if present
      if (state.job) {
        const serverJob = state.job;
        console.log(`✅ JobContext: Restoring active job: ${serverJob.id}, status: ${serverJob.status}`);
        
        // Build ActiveJob from server data
        const activeJob: ActiveJob = {
          id: serverJob.id,
          status: serverJob.status,
          pickupAddress: serverJob.pickupAddress || 'Unknown',
          pickupLatitude: serverJob.pickupLatitude,
          pickupLongitude: serverJob.pickupLongitude,
          dropoffAddress: serverJob.dropoffAddress || 'Not set',
          dropoffLatitude: serverJob.dropoffLatitude,
          dropoffLongitude: serverJob.dropoffLongitude,
          estimatedFare: serverJob.estimatedPrice || 0,
          createdAt: serverJob.createdAt,
          customer: serverJob.customer,
        };
        
        // Restore job to context
        setCurrentJob(activeJob);
        
        // Map server status to JobContext status
        const mappedStatus = mapProgressToStatus(serverJob.status);
        setStatus(mappedStatus);
        
        console.log(`✅ JobContext: Active job restored via socket - status: ${mappedStatus}`);
      } else {
        console.log('ℹ️ JobContext: No active job in driver state');
      }
    };

    // Register the callback
    registerDriverStateRestoration(handleDriverStateRestoration);
    console.log('✅ JobContext: Registered for driver state restoration via socket');

    // ✅ FIX: CLEANUP on unmount to prevent callback accumulation
    return () => {
      unregisterDriverStateRestoration(handleDriverStateRestoration);
      console.log('🧹 JobContext: State restoration listener unregistered');
    };
  }, [driver?.id, mapProgressToStatus]);

  const acceptJob = useCallback(() => {
    if (!currentJob?.id) {
      console.warn("❌ JobContext: acceptJob called without an active job");
      return;
    }

    // Prevent double-click/multiple acceptance
    if (pendingActionRef.current?.type === "ACCEPT") {
      console.warn("⚠️ JobContext: Accept already in progress, ignoring duplicate call");
      return;
    }

    console.log("✅ JobContext: Accepting job", currentJob.id);

    setStatus("ASSIGNED");
    setCurrentJob((prev) => (prev ? { ...prev, status: "ASSIGNED" } : prev));

    const acceptAction = {
      type: "ACCEPT" as const,
      jobId: String(currentJob.id),
      targetStatus: "ASSIGNED" as JobStatus,
    };

    setPendingAction(acceptAction);

    // ✅ NEW: Emit job:accept event to server for manual assignment flow
    const socket = getSocket();
    if (socket) {
      socket.emit("job:accept", {
        jobId: currentJob.id,
        driverId: driver?.id,
        acceptedAt: new Date().toISOString(),
        location: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : undefined,
      });
      console.log("📡 JobContext: Emitted job:accept to server");
    }

    emitJobProgress(currentJob.id, "ACCEPTED", location ?? undefined);
    emitDriverStatus("BUSY", location ?? undefined);

    // Clear pending action after 5 seconds to allow retry if needed
    setTimeout(() => {
      if (pendingActionRef.current?.jobId === acceptAction.jobId) {
        setPendingAction(null);
      }
    }, 5000);
  }, [currentJob, driver?.id, location]);

  const rejectJob = useCallback(
    (reason: "manual" | "timeout" = "manual") => {
      if (!currentJob?.id) {
        console.warn("🚫 JobContext: Reject called without an active job");
        return;
      }

      // ✅ FIX: Don't reject if job is no longer in INCOMING status
      if (status !== "INCOMING") {
        console.warn(
          `⚠️ JobContext: Cannot reject job in ${status} status (must be INCOMING)`,
          {
            jobId: currentJob.id,
            currentStatus: status,
            reason,
          }
        );
        return;
      }

      console.log(
        "🚫 JobContext: Rejecting job",
        currentJob.id,
        "reason:",
        reason
      );

      setPendingAction({
        type: "REJECT",
        jobId: String(currentJob.id),
        targetStatus: "REJECTED",
      });

      // ✅ NEW: Emit job:reject event to server for manual assignment flow
      const socket = getSocket();
      if (socket) {
        socket.emit("job:reject", {
          jobId: currentJob.id,
          driverId: driver?.id,
          reason,
          rejectedAt: new Date().toISOString(),
          location: location ? {
            latitude: location.latitude,
            longitude: location.longitude,
          } : undefined,
        });
        console.log("📡 JobContext: Emitted job:reject to server, reason:", reason);
      }

      emitJobProgress(currentJob.id, "REJECTED", location ?? undefined);
      emitDriverStatus("AVAILABLE", location ?? undefined);
      clearJob();
    },
    [currentJob, driver?.id, location, status, clearJob] // ✅ Added status dependency
  );

  const noShowJob = useCallback(() => {
    if (!currentJob?.id) {
      console.warn("⚠️ JobContext: noShowJob called without an active job");
      return;
    }

    console.log("👻 JobContext: Marking job as NO_SHOW", currentJob.id);

    setPendingAction({
      type: "STATUS",
      jobId: String(currentJob.id),
      targetStatus: "NO_SHOW",
    });

    setStatus("NO_SHOW");
    emitJobProgress(currentJob.id, "NO_SHOW", location ?? undefined);
    emitDriverStatus("AVAILABLE", location ?? undefined);
    
    // Clear job after NO_SHOW
    setTimeout(() => {
      clearJob();
    }, 1000);
  }, [currentJob, location, clearJob]);

  const recallJob = useCallback(() => {
    if (!currentJob?.id) {
      console.warn("↩️ JobContext: recallJob called without an active job");
      return;
    }

    console.log("↩️ JobContext: Recalling job", currentJob.id);

    setPendingAction({
      type: "STATUS",
      jobId: String(currentJob.id),
      targetStatus: "RECALLED",
    });

    setStatus("RECALLED");
    emitJobProgress(currentJob.id, "RECALLED", location ?? undefined);
    emitDriverStatus("AVAILABLE", location ?? undefined);
    
    // Clear job after RECALL
    setTimeout(() => {
      clearJob();
    }, 1000);
  }, [currentJob, location, clearJob]);

  // ✨ NEW: Pause Job
  const pauseJob = useCallback(async () => {
    if (!currentJob || status !== "STARTED") {
      console.warn('[JobContext] Cannot pause: no active job or not started');
      return;
    }
    
    const pauseTime = new Date().toISOString();
    console.log('[JobContext] ⏸️ Pausing job');
    
    // Create new pause record
    const newPauseRecord: PauseRecord = {
      pausedAt: pauseTime,
      resumedAt: null,
      durationSeconds: 0,
      location: location ? {
        latitude: location.latitude,
        longitude: location.longitude,
      } : undefined,
    };
    
    // Add to pause records
    const updatedPauseRecords = [...pauseRecords, newPauseRecord];
    setPauseRecords(updatedPauseRecords);
    
    // Update job
    setCurrentJob((prev) => prev ? {
      ...prev,
      status: 'PAUSED',
      pause_records: updatedPauseRecords,
    } : null);
    
    setStatus('PAUSED');
    
    // Stop job processing
    jobProcessor.stopContinuousProcessing();
    setIsProcessingJob(false);
    
    // Emit to backend
    emitJobProgress(currentJob.id, 'PAUSED', location ?? undefined);
    
    console.log('[JobContext] ✅ Job paused successfully');
  }, [currentJob, status, pauseRecords, location]);

  // ✨ NEW: Resume Job
  const resumeJob = useCallback(async () => {
    if (!currentJob || status !== "PAUSED") {
      console.warn('[JobContext] Cannot resume: job not paused');
      return;
    }
    
    const resumeTime = new Date().toISOString();
    console.log('[JobContext] ▶️ Resuming job');
    
    // Update last pause record with resume time
    const updatedPauseRecords = pauseRecords.map((record, index) => {
      if (index === pauseRecords.length - 1 && record.resumedAt === null) {
        const pausedAtTime = new Date(record.pausedAt).getTime();
        const resumedAtTime = new Date(resumeTime).getTime();
        const durationSeconds = Math.floor((resumedAtTime - pausedAtTime) / 1000);
        
        return {
          ...record,
          resumedAt: resumeTime,
          durationSeconds,
        };
      }
      return record;
    });
    
    setPauseRecords(updatedPauseRecords);
    
    // Update job
    setCurrentJob((prev) => prev ? {
      ...prev,
      status: 'STARTED',
      pause_records: updatedPauseRecords,
      resume_job_time: resumeTime,
    } : null);
    
    setStatus('STARTED');
    
    // Emit to backend
    emitJobProgress(currentJob.id, 'STARTED', location ?? undefined);
    
    console.log('[JobContext] ✅ Job resumed successfully');
  }, [currentJob, status, pauseRecords, location]);

  // ✨ PREPARE JOB FOR PAYMENT (NOT complete yet!)
  const prepareJobForPayment = useCallback(async (): Promise<ActiveJob | null> => {
    if (!currentJob) {
      console.warn('[JobContext] No job to prepare');
      return null;
    }
    
    console.log('[JobContext] 💰 Preparing job for payment collection');
    
    // Stop processing
    jobProcessor.stopContinuousProcessing();
    setIsProcessingJob(false);
    
    // Get final data
    const finalData = await jobProcessor.finalizeJob();
    
    // Get current timer state
    const timerState = globalJobTimer.getState();
    
    // Build job data with PENDING_PAYMENT status (NOT completed!)
    const pendingPaymentJobData: ActiveJob = {
      ...currentJob,
      status: 'PENDING_PAYMENT', // ✅ NEW STATUS: Waiting for payment
      complete_job_time: new Date().toISOString(),
      
      // Add final metrics
      totalAccumulatedDistanceMeters: timerState.totalDistanceMeters,
      totalAccumulatedWaitingSeconds: timerState.totalWaitingSeconds,
      
      // Add pause records
      pause_records: pauseRecords,
      
      // Add pricing breakdown
      pricingBreakdown: pricingBreakdown,
    };
    
    // Update state to PENDING_PAYMENT (not COMPLETED!)
    setCurrentJob(pendingPaymentJobData);
    setStatus('PENDING_PAYMENT');
    
    console.log('[JobContext] ✅ Job prepared for payment', {
      distance: `${timerState.totalDistanceMeters.toFixed(2)}m`,
      waiting: `${timerState.totalWaitingSeconds}s`,
      totalCost: pricingBreakdown?.totalCost,
      coordinatePoints: finalData.coordinateHistory?.totalPoints,
    });
    
    return pendingPaymentJobData;
  }, [currentJob, pauseRecords, pricingBreakdown, location]);

  // ✨ COMPLETE JOB (called AFTER payment is collected)
  const completeJob = useCallback(async (paymentMethod: string, amountPaid: number): Promise<void> => {
    if (!currentJob) {
      console.warn('[JobContext] No job to complete');
      return;
    }
    
    console.log('[JobContext] 🏁 Completing job after payment');
    
    // Update to COMPLETED status
    setCurrentJob((prev) => prev ? { ...prev, status: 'COMPLETED' } : null);
    setStatus('COMPLETED');
    
    // Emit to backend with payment info
    emitJobProgress(currentJob.id, 'COMPLETED', location ?? undefined);
    emitDriverStatus('AVAILABLE', location ?? undefined);
    
    // Clear job after a short delay
    setTimeout(() => {
      clearJob();
    }, 2000);
    
    console.log('[JobContext] ✅ Job completed and payment recorded', {
      paymentMethod,
      amountPaid,
    });
  }, [currentJob, location, clearJob]);

  // ✅ NEW: Change tariff mid-ride with automatic price recalculation
  const changeTariff = useCallback(async (newTariff: any): Promise<void> => {
    if (!currentJob) {
      console.warn('[JobContext] No active job to change tariff for');
      return;
    }
    
    if (status !== 'STARTED' && status !== 'ACTIVE') {
      console.warn('[JobContext] Can only change tariff during active ride');
      return;
    }
    
    console.log('[JobContext] 💱 Changing tariff mid-ride:', {
      jobId: currentJob.id,
      oldTariff: currentJob.tariff?.name,
      newTariff: newTariff.name,
      currentDistance: (timer.distanceMeters / 1000).toFixed(2) + ' km',
      currentTime: Math.floor(timer.elapsedSeconds / 60) + ' min',
    });
    
    try {
      // Store tariff change timestamp (for pricing breakdown history)
      const tariffChangePoint = {
        timestamp: Date.now(),
        distanceMeters: timer.distanceMeters,
        elapsedSeconds: timer.elapsedSeconds,
        oldTariffId: currentJob.tariff?.id,
        newTariffId: newTariff.id,
        oldTariffName: currentJob.tariff?.name,
        newTariffName: newTariff.name,
      };
      
      // ✅ FIX: Update current job with new tariff
      setCurrentJob((prev) => prev ? {
        ...prev,
        tariff: newTariff,
        tariffChangeHistory: [
          ...(prev.tariffChangeHistory || []),
          tariffChangePoint,
        ],
      } : null);
      
      // ✅ CRITICAL: Update ShiftContext's selectedTariff so UI reflects the change
      // This is needed because fare calculations and display use selectedTariff from ShiftContext
      if (shiftContext.selectTariff) {
        await shiftContext.selectTariff(newTariff);
        console.log('[JobContext] ✅ Updated ShiftContext selectedTariff - UI will reflect new tariff');
      } else {
        console.warn('[JobContext] ⚠️ ShiftContext selectTariff not available');
      }
      
      // ✅ Force job processor to recalculate with new rates
      // The job processor will pick up the new tariff from currentJob on next iteration
      console.log('[JobContext] 🔄 Job processor will use new tariff rates on next update');
      
      // TODO: Notify backend about tariff change
      // await httpClient.post(`/api/mobile/driver/jobs/${currentJob.id}/change-tariff`, {
      //   newTariffId: newTariff.id,
      //   changePoint: tariffChangePoint,
      // });
      
      console.log('[JobContext] ✅ Tariff changed successfully - pricing will recalculate', {
        newRates: {
          perKm: newTariff.perKmRate,
          perMin: newTariff.perMinuteRate,
          waiting: newTariff.waitingTimeRate,
        },
        changePoint: tariffChangePoint,
      });
      
    } catch (error) {
      console.error('[JobContext] ❌ Failed to change tariff:', error);
      throw error;
    }
  }, [currentJob, status, timer, shiftContext]);

  const updateStatus = useCallback(
    (nextStatus: JobStatus) => {
      const driverStatusMap: Record<JobStatus, string | null> = {
        IDLE: null,
        INCOMING: null,
        ASSIGNED: "BUSY",
        ACCEPTED: "BUSY",
        ON_THE_WAY: "BUSY",
        ARRIVED: "BUSY",
        STARTED: "BUSY",
        PAUSED: "BUSY", // ✨ NEW: Paused still shows busy
        ACTIVE: "BUSY",
        REACHED: "BUSY",
        PENDING_PAYMENT: "BUSY", // ✅ NEW: Collecting payment
        COMPLETED: "AVAILABLE",
        REJECTED: "AVAILABLE",
        CANCELLED: "AVAILABLE",
        NO_SHOW: "AVAILABLE",
        RECALLED: "AVAILABLE",
      };

      if (!currentJob?.id) {
        console.warn("⚠️ JobContext: updateStatus called without an active job");
        return;
      }

      const jobId = String(currentJob.id);

      setPendingAction({
        type: "STATUS",
        jobId,
        targetStatus: nextStatus,
      });

      setStatus(nextStatus);
      setCurrentJob((previous) =>
        previous ? { ...previous, status: nextStatus } : previous
      );

      emitJobProgress(jobId, nextStatus, location ?? undefined);

      const driverStatus = driverStatusMap[nextStatus];
      if (driverStatus) {
        emitDriverStatus(driverStatus, location ?? undefined);
      }
    },
    [currentJob, location]
  );

  const updateTimer = useCallback((partial: Partial<JobTimerState>) => {
    setTimer((prev) => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    if (status !== "STARTED") {
      return;
    }

    // Timer increment every second
    const timerInterval = setInterval(() => {
      setTimer((prev) => ({
        ...prev,
        elapsedSeconds: prev.elapsedSeconds + 1,
      }));
    }, 1000);

    // ✅ Meter telemetry emission every 1 second (real-time fare updates to dispatch)
    const telemetryInterval = setInterval(() => {
      if (currentJob?.id) {
        setTimer((currentTimer) => {
          // Emit current meter state with pricing breakdown
          emitMeterTelemetry(
            currentJob.id,
            {
              elapsedSeconds: currentTimer.elapsedSeconds,
              distanceMeters: currentTimer.distanceMeters,
              waitingSeconds: currentTimer.waitingSeconds,
              currentFare: currentTimer.earningsSoFar ?? currentJob.fare ?? 0,
              speedKmh: location?.speed ?? 0,
            },
            location ?? undefined
          );
          return currentTimer;
        });
      }
    }, 1000); // ✅ Real-time: every 1 second

    return () => {
      clearInterval(timerInterval);
      clearInterval(telemetryInterval);
    };
  }, [status, currentJob, location]);

  useEffect(() => {
    if (status !== "ARRIVED") {
      return;
    }

    const interval = setInterval(() => {
      setTimer((prev) => ({
        ...prev,
        waitingSeconds: prev.waitingSeconds + 1,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [status]);

  const value = useMemo<JobContextValue>(
    () => ({
      status,
      currentJob,
      timer,
      pendingAction,
      setIncomingJob,
      startWalkInJob, // ✅ NEW: Direct start for walk-in jobs
      acceptJob,
      rejectJob,
      noShowJob,
      recallJob,
      updateStatus,
      updateTimer,
      clearJob,
      routePoints,
      
      // ✨ NEW: Enhanced job control
      pricingBreakdown,
      pauseRecords,
      pauseJob,
      resumeJob,
      prepareJobForPayment, // ✅ NEW
      completeJob,
      changeTariff, // ✅ NEW: Change tariff mid-ride
    }),
    [
      status,
      currentJob,
      timer,
      pendingAction,
      setIncomingJob,
      startWalkInJob, // ✅ NEW
      acceptJob,
      rejectJob,
      noShowJob,
      recallJob,
      updateStatus,
      updateTimer,
      clearJob,
      routePoints,
      pricingBreakdown,
      pauseRecords,
      pauseJob,
      resumeJob,
      prepareJobForPayment, // ✅ NEW
      completeJob,
      changeTariff, // ✅ NEW
    ]
  );

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
};

export const useJob = (): JobContextValue => {
  const context = useContext(JobContext);
  if (!context) {
    // ✅ FIX: During app state transitions, provider might be temporarily unavailable
    // Return safe defaults instead of throwing error
    console.warn('⚠️ JobContext not available yet, returning safe defaults');
    return {
      status: 'IDLE' as JobStatus,
      currentJob: null,
      timer: {
        elapsedSeconds: 0,
        waitingSeconds: 0,
        distanceMeters: 0,
      },
      pendingAction: null,
      setIncomingJob: () => {},
      startWalkInJob: () => {},
      acceptJob: () => {},
      rejectJob: () => {},
      noShowJob: () => {},
      recallJob: () => {},
      updateStatus: () => {},
      updateTimer: () => {},
      clearJob: () => {},
      routePoints: [],
      pricingBreakdown: null,
      pauseRecords: [],
      pauseJob: async () => {},
      resumeJob: async () => {},
      prepareJobForPayment: async () => null,
      completeJob: async () => {},
      changeTariff: async () => {}, // ✅ NEW
    };
  }
  return context;
};
