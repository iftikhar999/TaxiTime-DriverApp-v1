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
import { Platform } from "react-native";
import type { MediaStream } from "react-native-webrtc";
import JobRecalledModal from "../components/JobRecalledModal";
import JobUpdatedModal, { type JobChange } from "../components/JobUpdatedModal";
import {
    emitDriverStatus,
    emitJobProgress,
    emitMeterSnapshot,
    emitMeterTelemetry,
    ensureDriverSocket,
    getSocket,
    registerDriverStateRestoration, // ✅ NEW: For receiving complete driver state via socket
    unregisterDriverStateRestoration, // ✅ FIX: For cleanup
    setActiveJobIdForLocation, // 🆕 So emitDriverLocation tags pings with jobId
} from "../services/driverSocket";
import { ForegroundService } from "../services/foregroundService";
import { navigate as navigateGlobal } from "../navigation/navigationRef";
import { RideSummary } from "../types/rides";
import { Tariff } from "../types/tariff";
import { calculateDistance } from "../utils/distance";
import { playJobNotificationSound } from "../utils/soundNotification";
import { useAuth } from "./AuthContext";
import { useLocation } from "./LocationContext";
import { useShift } from "./ShiftContext"; // ✅ NEW: For updating selectedTariff during tariff change

// ✨ NEW: Import job processing services
import jobMeterService from "../native/jobMeterService"; // ✅ NEW: Background meter service
import { coordinateHistory } from "../services/coordinateHistory";
import { jobProcessor } from "../services/jobProcessor";
import {
    getDriverVideoStreamingState,
    startDriverVideoStream,
    stopDriverVideoStream,
    subscribeToDriverVideoState,
} from "../services/videoStreamingService";
import { PauseRecord, PricingBreakdown } from "../types/jobTypes";
import { DriverVideoStreamingState } from "../types/video";
import { globalJobTimer, TimerState } from "../utils/enhancedJobTimer";
import { getWaitingRatePerMinute } from "../utils/tariffUtils";

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
  speedKmh?: number;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

const JOB_STATE_STORAGE_KEY = "driverApp:jobState";
const MAX_ROUTE_POINTS = 1500;
const MIN_ROUTE_INCREMENT_METERS = 1.5;
const AUTO_RESUME_DISTANCE_METERS = 12;
const AUTO_RESUME_SPEED_KMH = 5;
const SNAPSHOT_INTERVAL_MS = 60000;
const TRACKABLE_STATUSES = new Set<JobStatus>([
  "ASSIGNED",
  "ACCEPTED",
  "ON_THE_WAY",
  "ARRIVED",
  "STARTED",
  "PAUSED",
  "ACTIVE",
  "REACHED",
  "NO_SHOW",
  "RECALLED",
]);

const VIDEO_STREAMING_JOB_STATUSES = new Set<JobStatus>([
  "STARTED",
  "ACTIVE",
]);

const toSafeNumber = (value: any, fallback = 0): number => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeTariffSnapshot = (source: any): Tariff | null => {
  if (!source || typeof source !== "object") {
    return null;
  }

  const waitingCandidates = [
    source.waitingTimeRate,
    source.waiting_rate,
    source.waitingRate,
    source.waiting_fee,
    source.waitingFee,
    source.waiting_fee_per_minute,
    source.waitingFeePerMinute,
    source.waitingCost,
    source.waiting_cost,
    source.waitingCharge,
    source.waiting_charge,
  ];

  const waitingValue = waitingCandidates.find((candidate) =>
    Number.isFinite(Number(candidate))
  );

  const normalized: Tariff = {
    id: String(
      source.id ??
        source.tariffId ??
        source.tariff_id ??
        source._id ??
        source.uuid ??
        source.code ??
        source.name ??
        `tariff_${Date.now()}`
    ),
    name: source.name ?? source.label ?? source.title ?? "Tariff",
    baseFare: toSafeNumber(
      source.baseFare ?? source.base_fare ?? source.startingPrice ?? source.base,
      0
    ),
    perKmRate: toSafeNumber(
      source.perKmRate ??
        source.per_km_rate ??
        source.distanceRate ??
        source.ratePerKm ??
        source.kmRate,
      0
    ),
    perMinuteRate: toSafeNumber(
      source.perMinuteRate ??
        source.per_minute_rate ??
        source.timeRate ??
        source.ratePerMinute ??
        source.minuteRate,
      0
    ),
    minimumFare: toSafeNumber(
      source.minimumFare ??
        source.minimum_fare ??
        source.minimum ??
        source.minimumFareAmount,
      0
    ),
  };

  if (waitingValue !== undefined) {
    const parsedWaiting = Number(waitingValue);
    if (Number.isFinite(parsedWaiting)) {
      normalized.waitingTimeRate = parsedWaiting;
    }
  }

  return normalized;
};

const getTariffIdentity = (tariff?: Tariff | null): string | null => {
  if (!tariff) {
    return null;
  }
  return (
    (tariff.id && String(tariff.id)) ||
    (tariff as any)?.tariffId ||
    (tariff as any)?.code ||
    tariff.name ||
    null
  );
};

type PersistedJobState = {
  status: JobStatus;
  job: ActiveJob;
  timer: JobTimerState;
  routePoints: RoutePoint[];
  timestamp: number;
  selectedTariffId?: string; // ✅ ADD: Persist selected tariff
  pricingBreakdown?: PricingBreakdown; // ✅ ADD: Persist pricing breakdown
  pauseRecords?: PauseRecord[]; // ✅ ADD: Persist pause records
  timerState?: TimerState; // ✅ NEW: Persist timer engine state for crash recovery
};

export interface ActiveJob extends Omit<RideSummary, "status" | "passenger"> {
  customer: any;
  countdownMs?: number;
  expiresAt?: string | null;
  assignmentId?: string | null;
  offerId?: string | null;
  internalJobId?: string | null;
  legacyJobId?: string | null;
  publicJobId?: string | null;
  jobId?: string | null;
  jobType?: string;
  // 🎯 Service type: TAXI | DELIVERY | COURIER — used by JobOfferScreen to
  // render the correct badge/iconography so the driver knows what they're
  // being dispatched to before accepting.
  serviceType?: string;
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
  resumePendingPayment: () => void;
  prepareJobForPayment: () => Promise<ActiveJob | null>; // ✅ NEW: Prepare for payment
  completeJob: (paymentMethod: string, amountPaid: number) => Promise<void>; // ✅ UPDATED: Complete after payment
  changeTariff: (newTariff: any) => Promise<void>; // ✅ NEW: Change tariff mid-ride
  videoStreamingState: DriverVideoStreamingState;
  startVideoStreaming: () => Promise<MediaStream | null>;
  stopVideoStreaming: (reason?: string) => Promise<void>;
}

const JobContext = createContext<JobContextValue | undefined>(undefined);

type RecallModalState = {
  visible: boolean;
  title: string;
  message: string;
  type: 'recalled' | 'cancelled' | 'taken';
};

export const JobProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [status, setStatus] = useState<JobStatus>("IDLE");
  const [currentJob, setCurrentJob] = useState<ActiveJob | null>(null);
  const [recallModal, setRecallModal] = useState<RecallModalState>({
    visible: false,
    title: '',
    message: '',
    type: 'recalled',
  });
  const [updateModal, setUpdateModal] = useState<{ visible: boolean; changes: JobChange[] }>({
    visible: false,
    changes: [],
  });
  const [timer, setTimer] = useState<JobTimerState>({
    elapsedSeconds: 0,
    waitingSeconds: 0,
    distanceMeters: 0,
    speedKmh: 0,
  });
  const [pendingAction, setPendingAction] =
    useState<PendingJobAction | null>(null);
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const routePointsRef = useRef<RoutePoint[]>([]);
  const lastSnapshotIndexRef = useRef(0);
  const [hydrated, setHydrated] = useState(false);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobRef = useRef<ActiveJob | null>(null);
  const statusRef = useRef<JobStatus>(status);
  const statusTransitionRef = useRef<JobStatus>(status);
  const pendingActionRef = useRef<PendingJobAction | null>(null);
  const { location } = useLocation();
  const locationRef = useRef(location); // ✅ Store latest location in ref for jobProcessor
  const timerRef = useRef<JobTimerState>(timer);
  const pricingBreakdownRef = useRef<PricingBreakdown | null>(null);
  const pausedLocationRef = useRef<{ latitude: number; longitude: number; timestamp?: number } | null>(null);
  const autoResumeInFlightRef = useRef(false);
  const pendingPaymentSnapshotRef = useRef<{
    timerState: TimerState;
    pricing: PricingBreakdown | null;
  } | null>(null);
  const { driver } = useAuth();
  const shiftContext = useShift(); // ✅ NEW: For updating selectedTariff during tariff change
  const refreshShiftRecentJobs = shiftContext.refreshRecentJobs;
  const resolvedCompanyId = driver?.companyId ?? driver?.company?.id ?? null;
  
  // ✅ Keep locationRef updated with latest location
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  
  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  useEffect(() => {
    pricingBreakdownRef.current = pricingBreakdown;
  }, [pricingBreakdown]);

  // ✨ NEW: Enhanced job processing state
  const [pricingBreakdown, setPricingBreakdown] = useState<PricingBreakdown | null>(null);
  const [pauseRecords, setPauseRecords] = useState<PauseRecord[]>([]);
  const [isProcessingJob, setIsProcessingJob] = useState(false);
  const [videoStreamingState, setVideoStreamingState] =
    useState<DriverVideoStreamingState>(getDriverVideoStreamingState());

  // Subscribe to video state changes - MUST be after useState declaration
  useEffect(() => {
    return subscribeToDriverVideoState(setVideoStreamingState);
  }, []);
  
  const syncTimerFromEngine = useCallback(() => {
    const engineState = globalJobTimer.getState();
    if (!engineState) {
      return engineState;
    }

    let derivedElapsed = timer.elapsedSeconds;
    if (engineState.startTime && engineState.lastUpdateTime) {
      derivedElapsed = Math.max(
        0,
        (engineState.lastUpdateTime - engineState.startTime) / 1000
      );
    }

    setTimer((previous) => ({
      ...previous,
      elapsedSeconds: Number.isFinite(derivedElapsed)
        ? derivedElapsed
        : previous.elapsedSeconds,
      waitingSeconds:
        engineState.totalWaitingSeconds ?? previous.waitingSeconds,
      distanceMeters:
        engineState.totalDistanceMeters ?? previous.distanceMeters,
    }));

    return engineState;
  }, [timer.elapsedSeconds, timer.waitingSeconds, timer.distanceMeters]);

  const startVideoStreamingManually = useCallback(async (): Promise<MediaStream | null> => {
    if (!currentJob?.id || !driver?.id || !resolvedCompanyId) {
      throw new Error("Active job and company context are required to stream video.");
    }

    return startDriverVideoStream({
      jobId: currentJob.id,
      driverId: driver.id,
      companyId: resolvedCompanyId,
    });
  }, [currentJob?.id, driver?.id, resolvedCompanyId]);

  const stopVideoStreamingManually = useCallback(
    async (reason?: string) => {
      await stopDriverVideoStream(reason);
    },
    []
  );

  const captureRouteSegment = useCallback((): RoutePoint[] => {
    const points = routePointsRef.current;
    if (!points.length) {
      lastSnapshotIndexRef.current = 0;
      return [];
    }

    const startIndex = Math.min(lastSnapshotIndexRef.current, points.length);
    if (startIndex >= points.length) {
      return [];
    }

    const freshPoints = points.slice(startIndex);
    lastSnapshotIndexRef.current = points.length;

    if (freshPoints.length <= 40) {
      return freshPoints;
    }

    const step = Math.max(1, Math.ceil(freshPoints.length / 40));
    return freshPoints.filter((_, index) => index % step === 0);
  }, []);

  const emitPersistentSnapshot = useCallback(
    (reason: "interval" | "final") => {
      const job = currentJobRef.current;
      const timerSnapshot = timerRef.current;

      if (!job?.id || !timerSnapshot) {
        return;
      }

      const pricingSnapshot = pricingBreakdownRef.current;
      const fallbackFare = Number(
        timerSnapshot.earningsSoFar ??
          job.earningsSoFar ??
          job.fare ??
          0
      );
      const currentFare = pricingSnapshot?.totalCost
        ? Number(pricingSnapshot.totalCost)
        : fallbackFare;

      const routeSegment = captureRouteSegment();
      const locationPayload = locationRef.current
        ? {
            latitude: Number(locationRef.current.latitude),
            longitude: Number(locationRef.current.longitude),
            accuracy: locationRef.current.accuracy ?? null,
            heading: locationRef.current.heading ?? null,
            speed: locationRef.current.speed ?? null,
            timestamp: locationRef.current.timestamp ?? Date.now(),
          }
        : undefined;

      emitMeterSnapshot(
        job.id,
        {
          elapsedSeconds: Math.round(timerSnapshot.elapsedSeconds ?? 0),
          distanceMeters: Number(
            (timerSnapshot.distanceMeters ?? 0).toFixed(2)
          ),
          waitingSeconds: Math.round(timerSnapshot.waitingSeconds ?? 0),
          currentFare,
          speedKmh: Number(timerSnapshot.speedKmh ?? 0),
        },
        locationPayload,
        {
          status: statusRef.current,
          isPaused: statusRef.current === "PAUSED",
          recordedAt: Date.now(),
          reason,
          routeSegment,
        }
      );
    },
    [captureRouteSegment]
  );

  const clearPersistedJobState = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(JOB_STATE_STORAGE_KEY);
    } catch (error) {
      console.warn("Failed to clear persisted job state", error);
    }
  }, []); // ✅ FIX: Empty deps - doesn't need syncTimerFromEngine


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
    lastSnapshotIndexRef.current = 0;
  }, [currentJob?.id]);

  useEffect(() => {
    if (status === "PAUSED") {
      globalJobTimer.pause();

      if (location) {
        pausedLocationRef.current = {
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          timestamp: Number(location.timestamp) || Date.now(),
        };
      }
    } else if (
      statusTransitionRef.current === "PAUSED" &&
      (status === "STARTED" || status === "ACTIVE")
    ) {
      const resumeLocation = location ?? locationRef.current ?? null;
      globalJobTimer.resume(resumeLocation);
      pausedLocationRef.current = null;
      autoResumeInFlightRef.current = false;
    }

    statusTransitionRef.current = status;
  }, [status, location]);

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
            
            // ✅ FIX: Restore timer state FIRST before anything else
            if (parsed?.timerState) {
              try {
                globalJobTimer.restoreState(parsed.timerState);
                console.log('[JobContext] ✅ Timer engine restored from persisted state');
                
                // ✅ CRITICAL: Immediately sync timer to UI state BEFORE any processing starts
                const restoredState = globalJobTimer.getState();
                if (restoredState) {
                  // Calculate elapsed time from start time
                  const elapsedMs = restoredState.startTime 
                    ? Date.now() - restoredState.startTime 
                    : 0;
                  const elapsedSeconds = Math.floor(elapsedMs / 1000);
                  
                  setTimer({
                    elapsedSeconds,
                    waitingSeconds: restoredState.totalWaitingSeconds || 0,
                    distanceMeters: restoredState.totalDistanceMeters || 0,
                    speedKmh: 0, // Will be updated by processor
                    earningsSoFar: Number.parseFloat(parsed.pricingBreakdown?.totalCost || '0') || 0,
                  });
                  console.log('[JobContext] ✅ Timer UI state synced immediately:', {
                    distance: (restoredState.totalDistanceMeters || 0).toFixed(2) + 'm',
                    waiting: (restoredState.totalWaitingSeconds || 0).toFixed(0) + 's',
                    elapsed: elapsedSeconds + 's',
                  });
                }
              } catch (timerRestoreError) {
                console.warn('[JobContext] ⚠️ Failed to restore timer state:', timerRestoreError);
              }
            }
            
            // ✅ Restore pricing breakdown
            if (parsed?.pricingBreakdown) {
              setPricingBreakdown(parsed.pricingBreakdown);
              console.log('[JobContext] ✅ Pricing breakdown restored');
            }
            
            // ✅ Restore pause records
            if (parsed?.pauseRecords?.length) {
              setPauseRecords(parsed.pauseRecords);
              console.log('[JobContext] ✅ Pause records restored:', parsed.pauseRecords.length);
            }
            
            // ✅ Restore selected tariff (if tariff ID was saved)
            if (parsed?.selectedTariffId && shiftContext.tariffs?.length) {
              const savedTariff = shiftContext.tariffs.find(
                (t) => t.id === parsed.selectedTariffId
              );
              if (savedTariff && typeof shiftContext.selectTariff === 'function') {
                shiftContext
                  .selectTariff(savedTariff)
                  .then(() => console.log('✅ Restored selected tariff:', savedTariff.name))
                  .catch((error) =>
                    console.warn('⚠️ Failed to sync restored tariff via selectTariff:', error)
                  );
              }
            }
            
            // ✅ FIX: Auto-restart job processor for trackable statuses after hydration
            if (parsed?.job && TRACKABLE_STATUSES.has(parsed.status)) {
              console.log('[JobContext] 🔄 Auto-restarting job processor after hydration for status:', parsed.status);
              // Set flag to trigger processor restart in the processing effect
              setIsProcessingJob(false); // Will be set to true by the effect
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
      selectedTariffId: shiftContext.selectedTariff?.id, // ✅ Persist selected tariff ID
      pricingBreakdown: pricingBreakdown || undefined, // ✅ Persist pricing breakdown
      pauseRecords: pauseRecords.length > 0 ? pauseRecords : undefined, // ✅ Persist pause records
      timerState: globalJobTimer.getState(),
    };

    schedulePersist(snapshot);
  }, [hydrated, currentJob, status, timer, routePoints, schedulePersist, shiftContext.selectedTariff, pricingBreakdown, pauseRecords]);

  // 🆕 Keep driverSocket's module-level activeJobId in sync with our
  // currentJob so every outgoing `driver:location:update` carries a jobId.
  // Without this the backend can't route location pings to the passenger's
  // `job_<jobId>` room and the passenger sees no driver movement on the map.
  useEffect(() => {
    setActiveJobIdForLocation(currentJob?.id ?? null);
  }, [currentJob?.id]);

  // Ensure active jobs always carry a tariff snapshot for pricing/meter calculations
  useEffect(() => {
    if (!currentJob || currentJob.tariff || !shiftContext.selectedTariff) {
      return;
    }

    setCurrentJob((previous) => {
      if (!previous || previous.tariff) {
        return previous;
      }

      console.log(
        "[JobContext] 🧾 Attaching selected tariff snapshot to active job",
        {
          jobId: previous.id,
          tariffName: shiftContext.selectedTariff?.name,
        }
      );

      // Ensure tariff has a valid id
      const tariffSnapshot: Tariff = { 
        id: shiftContext.selectedTariff?.id || `tariff_${Date.now()}`,
        name: shiftContext.selectedTariff?.name || 'Default Tariff',
        baseFare: shiftContext.selectedTariff?.baseFare || 0,
        perKmRate: shiftContext.selectedTariff?.perKmRate || 0,
        perMinuteRate: shiftContext.selectedTariff?.perMinuteRate || 0,
        minimumFare: shiftContext.selectedTariff?.minimumFare || 0,
        ...shiftContext.selectedTariff,
      };

      return {
        ...previous,
        tariff: tariffSnapshot,
        tariffName: previous.tariffName || shiftContext?.selectedTariff?.name,
      } as ActiveJob;
    });
  }, [currentJob?.id, currentJob?.tariff, shiftContext.selectedTariff]);

  const setIncomingJob = useCallback((job: ActiveJob) => {
    console.log("🔔 [setIncomingJob] Called with job:", { id: job.id, status: job.status });
    console.log("🔔 [setIncomingJob] Playing notification sound...");

    // Play notification sound
    playJobNotificationSound().catch((error) =>
      console.error("Failed to play notification sound:", error)
    );

    setPendingAction(null);
    console.log("🔔 [setIncomingJob] Calling setCurrentJob...");
    setCurrentJob(job);
    console.log("🔔 [setIncomingJob] Calling setStatus('INCOMING')...");
    setStatus("INCOMING");
    console.log("🔔 [setIncomingJob] Status should now be INCOMING");
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0, speedKmh: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
    // NOTE: navigation to JobOffer happens in the socket-level
    // `handleJobAssigned` handler (below in this provider), NOT here.
    // setIncomingJob is also called by JobOfferScreen's own setup effect
    // when it mounts with a route param — navigating from inside this
    // action caused an infinite loop (mount → setIncomingJob →
    // navigate → mount with new params → setIncomingJob → navigate → …)
    // which surfaced as "Maximum update depth exceeded" in the driver
    // app and a flood of phantom-rejection events on the dispatcher.
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
    currentJobRef.current = startedJob;
    setStatus("STARTED");
    statusRef.current = "STARTED";
    setPendingAction(null);
    
    // Initialize timer and route
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0, speedKmh: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
    
    // Initialize pricing
    setPricingBreakdown(null);
    setPauseRecords([]);
    
    // Start job processor and timer immediately
    console.log("⏱️ Starting job processor and timer for walk-in job");
    globalJobTimer.start();
    jobProcessor.startContinuousProcessing(
      () => currentJobRef.current,
      () => {
        const loc = locationRef.current;
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
          setCurrentJob((prev) => prev ? { ...prev, ...updates } : null);
          if (updates.pricingBreakdown) {
            setPricingBreakdown(updates.pricingBreakdown);
          }
          setTimer((prev) => ({
            distanceMeters: updates.totalAccumulatedDistanceMeters ?? prev.distanceMeters,
            waitingSeconds: updates.totalAccumulatedWaitingSeconds ?? prev.waitingSeconds,
            elapsedSeconds: updates.elapsedSeconds ?? prev.elapsedSeconds,
            speedKmh: updates.estimatedSpeedKmh ?? prev.speedKmh ?? 0,
            earningsSoFar: updates.earningsSoFar ? parseFloat(updates.earningsSoFar) : prev.earningsSoFar,
          }));
        },
        setJobStatus: (newStatus: JobStatus) => {
          setStatus(newStatus);
          setCurrentJob((prev) => prev ? { ...prev, status: newStatus } : prev);
        },
        clearJob: () => {
          setCurrentJob(null);
          setStatus('IDLE');
          setPricingBreakdown(null);
          setPauseRecords([]);
        },
      }
    );
    setIsProcessingJob(true);
    
    // ✅ NEW: Start background meter service
    if (location) {
      jobMeterService.startJobMeter(
        Date.now(),
        0, // initial waiting seconds
        0, // initial distance meters
        location.latitude,
        location.longitude
      ).catch(error => {
        console.error('Failed to start background meter:', error);
      });
    }
    
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
    setTimer({ elapsedSeconds: 0, waitingSeconds: 0, distanceMeters: 0, speedKmh: 0 });
    setRoutePoints([]);
    routePointsRef.current = [];
    
    // ✨ NEW: Clear enhanced job state
    setPricingBreakdown(null);
    setPauseRecords([]);
    setIsProcessingJob(false);
    pendingPaymentSnapshotRef.current = null;
    pausedLocationRef.current = null;
    autoResumeInFlightRef.current = false;
    
    // Stop job processing if active
    jobProcessor.stopContinuousProcessing();
    globalJobTimer.reset();
    
    // ✅ NEW: Stop background meter service
    jobMeterService.stopJobMeter().catch(error => {
      console.warn('Failed to stop background meter:', error);
    });
    
    clearPersistedJobState().catch((error) =>
      console.warn("Failed to clear job state on reset", error)
    );
    schedulePersist(null);
  }, [clearPersistedJobState, schedulePersist]);

  // ✅ NEW: Subscribe to background meter updates
  useEffect(() => {
    if (status !== "STARTED") return;

    console.log('[JobContext] 📡 Subscribing to background meter updates');
    const unsubscribe = jobMeterService.onMeterUpdate((update) => {
      console.log('[JobContext] 🔔 Meter update from background:', update);
      
      // Update timer state from background service
      setTimer({
        elapsedSeconds: update.elapsedSeconds,
        waitingSeconds: update.waitingSeconds,
        distanceMeters: update.distanceMeters,
      });

      // ✅ FIX: Emit meter telemetry to backend for real-time dispatch tracking
      if (currentJob?.id) {
        emitMeterTelemetry(currentJob.id, {
          elapsedSeconds: update.elapsedSeconds,
          waitingSeconds: update.waitingSeconds,
          distanceMeters: update.distanceMeters,
          isMoving: update.isMoving,
          timestamp: update.timestamp || Date.now(),
        });
      }
    });

    return () => {
      console.log('[JobContext] 📡 Unsubscribing from background meter updates');
      unsubscribe();
    };
  }, [status, currentJob?.id]);

  // ✅ FIX: Periodic meter telemetry emission (every 5 seconds during active ride)
  useEffect(() => {
    if (status !== "STARTED" || !currentJob?.id) return;

    console.log('[JobContext] 📊 Starting periodic meter telemetry emission');
    
    const intervalId = setInterval(() => {
      // Emit current timer state to backend
      emitMeterTelemetry(currentJob.id!, {
        elapsedSeconds: timer.elapsedSeconds,
        waitingSeconds: timer.waitingSeconds,
        distanceMeters: timer.distanceMeters,
        currentFare: timer.earningsSoFar || pricingBreakdown?.total || 0,
        speedKmh: timer.speedKmh || 0,
      });
      console.log(`[JobContext] 📊 Emitted telemetry: ${timer.elapsedSeconds}s, ${timer.distanceMeters}m, $${timer.earningsSoFar || 0}`);
    }, 5000); // Every 5 seconds

    return () => {
      console.log('[JobContext] 📊 Stopping periodic meter telemetry emission');
      clearInterval(intervalId);
    };
  }, [status, currentJob?.id, timer.elapsedSeconds, timer.waitingSeconds, timer.distanceMeters, timer.earningsSoFar, timer.speedKmh, pricingBreakdown?.total]);

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

  useEffect(() => {
    if (
      !currentJob?.id ||
      !["STARTED", "PAUSED", "ACTIVE"].includes(status)
    ) {
      return;
    }

    emitPersistentSnapshot("interval");
    const interval = setInterval(() => {
      emitPersistentSnapshot("interval");
    }, SNAPSHOT_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [currentJob?.id, status, emitPersistentSnapshot]);

  useEffect(() => {
    if (status !== "PAUSED") {
      pausedLocationRef.current = null;
      autoResumeInFlightRef.current = false;
      return;
    }

    if (!location) {
      return;
    }

    if (!pausedLocationRef.current) {
      pausedLocationRef.current = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        timestamp: Number(location.timestamp) || Date.now(),
      };
      return;
    }

    const lastPoint = pausedLocationRef.current;
    const movedMeters =
      calculateDistance(
        lastPoint.latitude,
        lastPoint.longitude,
        Number(location.latitude),
        Number(location.longitude)
      ) * 1000;
    const speedKmh =
      typeof location.speed === "number"
        ? Math.max(location.speed * 3.6, 0)
        : 0;

    if (
      (movedMeters >= AUTO_RESUME_DISTANCE_METERS ||
        speedKmh >= AUTO_RESUME_SPEED_KMH) &&
      !autoResumeInFlightRef.current
    ) {
      autoResumeInFlightRef.current = true;
      resumeJob()
        .then(() => {
          console.log(
            "[JobContext] 🔄 Auto-resumed job due to movement while paused",
            {
              movedMeters: movedMeters.toFixed(2),
              speedKmh: speedKmh.toFixed(1),
            }
          );
        })
        .catch((error) => {
          console.error(
            "[JobContext] ❌ Failed to auto-resume job from movement:",
            error
          );
          autoResumeInFlightRef.current = false;
        });
    }
  }, [status, location, resumeJob]);

  // ✨ NEW: Job Processor Integration
  // Start/stop job processing based on job status
  useEffect(() => {
    // Process when job is STARTED or PAUSED (needed for hydration after app restart)
    if ((status === "STARTED" || status === "PAUSED") && currentJob && !isProcessingJob) {
      console.log('[JobContext] 🚀 Starting job processor for job:', currentJob.id, 'status:', status);
      setIsProcessingJob(true);
      
      // Start coordinate tracking
      coordinateHistory.startTracking(currentJob.id).catch((error) => {
        console.error('[JobContext] Failed to start coordinate tracking:', error);
      });
      
      // Initialize timer from job data (for crash recovery)
      globalJobTimer.initializeFromJob(currentJob);
      
      // Start timer only if job is STARTED (not if PAUSED)
      if (status === "STARTED") {
        globalJobTimer.start();
      }
      
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
              speedKmh: updates.estimatedSpeedKmh ?? prev.speedKmh ?? 0,
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
    if (status !== "STARTED" && status !== "PAUSED" && isProcessingJob) {
      console.log('[JobContext] ⏸️ Stopping job processor');
      setIsProcessingJob(false);
      jobProcessor.stopContinuousProcessing();
    }
  }, [status, currentJob?.id, isProcessingJob]);

  // Ensure processor stops on unmount
  useEffect(() => {
    return () => {
      jobProcessor.stopContinuousProcessing();
    };
  }, []);

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

  // ✅ NEW: Update background meter service with location changes
  useEffect(() => {
    console.log('🎯 JobContext location effect:', {
      status,
      hasLocation: !!location,
      hasCurrentJob: !!currentJob,
      location: location ? {
        lat: location.latitude.toFixed(6),
        lng: location.longitude.toFixed(6),
        accuracy: location.accuracy,
        speed: location.speed
      } : null
    });
    
    if (status === "STARTED" && location && currentJob) {
      console.log('📍 Updating background meter with location:', {
        lat: location.latitude,
        lng: location.longitude,
        accuracy: location.accuracy,
        speed: location.speed
      });
      
      jobMeterService.updateLocation(
        location.latitude,
        location.longitude,
        location.accuracy ?? 0,
        location.speed ?? 0
      ).catch(error => {
        console.warn('Failed to update background meter location:', error);
      });
    } else {
      console.log('❌ Not updating meter - conditions not met:', {
        statusIsStarted: status === "STARTED",
        hasLocation: !!location,
        hasCurrentJob: !!currentJob
      });
    }
  }, [status, location, currentJob]);

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

    const resolveTariffForJob = (payload: any): Tariff | null => {
      const payloadTariff =
        payload?.tariff ||
        payload?.tariffDetails ||
        payload?.tariffInfo ||
        payload?.tariffSnapshot ||
        null;

      const normalizedPayloadTariff = normalizeTariffSnapshot(payloadTariff);
      if (normalizedPayloadTariff) {
        return normalizedPayloadTariff;
      }

      const tariffId =
        payload?.tariffId ??
        payload?.tariff_id ??
        payloadTariff?.tariffId ??
        payloadTariff?.id;

      if (
        tariffId &&
        Array.isArray(shiftContext.tariffs) &&
        shiftContext.tariffs.length > 0
      ) {
        const matched = shiftContext.tariffs.find(
          (tariff) => String(tariff.id) === String(tariffId)
        );
        if (matched) {
          return { ...matched };
        }
      }

      if (shiftContext.selectedTariff) {
        return { ...shiftContext.selectedTariff };
      }

      return null;
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
      const jobTariff = resolveTariffForJob(payload) || undefined;

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
        tariff: jobTariff,
        tariffName:
          jobTariff?.name ??
          payload?.tariff?.name ??
          payload?.tariffName ??
          null,
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
        // Intermediate stops/waypoints
        stops: (() => {
          const s = payload?.stops || payload?.requirements?.stops;
          return Array.isArray(s) ? s : [];
        })(),
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

    const handleJobAssigned = async (raw: any) => {
      console.log("🎯 JobContext: Job assignment received:", raw);
      console.log("🎯 JobContext: Raw payload:", JSON.stringify(raw, null, 2));
      console.log("🎯 JobContext: Current socket status:", {
        connected: socket.connected,
        id: socket.id,
      });

      try {
        // ✅ REFRESH TARIFF DATA: Ensure we have latest tariff before building job
        console.log("🔄 JobContext: Refreshing tariff data for new job assignment...");
        await shiftContext.refreshTariffs().catch((error) => {
          console.error("⚠️ JobContext: Failed to refresh tariffs, using cached:", error);
        });

        const job = buildActiveJobFromPayload(raw);
        console.log("🎯 JobContext: Built active job:", job);
        setIncomingJob(job);

        // Auto-open the offer screen from wherever the driver currently is
        // (Home, Earnings, Settings…). This was previously inside
        // setIncomingJob but moved here so it fires ONLY when a new offer
        // arrives via socket — not when JobOfferScreen re-syncs its own
        // state via setIncomingJob (that re-sync was looping the navigate
        // call and crashing the app with "Maximum update depth exceeded").
        // Defer one tick so React commits the state set above first.
        setTimeout(() => {
          try {
            navigateGlobal("JobOffer", { job: job as any });
          } catch (navErr) {
            console.warn("[handleJobAssigned] navigate('JobOffer') failed:", navErr);
          }
        }, 0);

        if (Platform.OS === "android") {
          ForegroundService.bringToForeground().catch((error) =>
            console.error("Failed to bring app to foreground:", error)
          );
        }

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

      console.log("🚫 JobContext: Job unassigned/recalled by dispatcher", raw);
      
      // Show alert to driver
      const reason = raw?.reason || raw?.message || "The dispatcher has recalled this job.";
      setRecallModal({
        visible: true,
        title: 'Job Recalled',
        message: reason,
        type: 'recalled',
      });
      
      clearJob();
    };

    const handleJobCancelled = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      console.log("❌ JobContext: Job cancelled by dispatcher", raw);
      
      // Show alert to driver
      const reason = raw?.reason || raw?.message || "The job has been cancelled by the dispatcher.";
      setRecallModal({
        visible: true,
        title: 'Job Cancelled',
        message: reason,
        type: 'cancelled',
      });
      
      clearJob();
    };

    const handleJobTaken = (raw: any) => {
      // ✅ FIX: Ignore if this driver is the one who was assigned the job
      const takenBy = raw?.takenBy || raw?.driverId || raw?.assignedDriverId;
      if (takenBy && takenBy === driver?.id) {
        console.log("ℹ️ JobContext: Ignoring job:taken - we are the assigned driver", raw);
        return;
      }

      // Check if this matches the current incoming job (job offer screen)
      if (!matchesCurrentJob(raw)) {
        return;
      }

      console.log("⚠️ JobContext: Job taken by another driver", raw);
      
      // Show alert to driver
      setRecallModal({
        visible: true,
        title: 'Job Taken',
        message: 'This job has been assigned to another driver.',
        type: 'taken',
      });
      
      clearJob();
    };

    const handleJobDataUpdated = (raw: any) => {
      if (!matchesCurrentJob(raw)) {
        return;
      }

      console.log("📝 JobContext: Job data updated by dispatcher", raw);

      // If the backend sent pre-computed changes, use them directly
      const serverChanges: JobChange[] = raw?.changes || [];

      // Build the updated job from payload
      const payload = raw?.updatedJob ?? raw?.job ?? raw;
      const job = buildActiveJobFromPayload(payload);
      const { status: _ignoredStatus, ...rest } = job;

      // Detect changes by comparing with current job
      const detectedChanges: JobChange[] = [...serverChanges];
      const current = currentJobRef.current;

      if (current && detectedChanges.length === 0) {
        // Pickup location
        if (job.pickupAddress && job.pickupAddress !== current.pickupAddress && job.pickupAddress !== 'Unknown') {
          detectedChanges.push({ field: 'Pickup Location', oldValue: current.pickupAddress || 'Not set', newValue: job.pickupAddress });
        }
        // Dropoff location
        if (job.dropoffAddress && job.dropoffAddress !== current.dropoffAddress && job.dropoffAddress !== 'Unknown') {
          detectedChanges.push({ field: 'Drop-off Location', oldValue: current.dropoffAddress || 'Not set', newValue: job.dropoffAddress });
        }
        // Fare
        if (job.estimatedFare && job.estimatedFare !== current.estimatedFare && job.estimatedFare !== 0) {
          detectedChanges.push({ field: 'Estimated Fare', oldValue: `${current.estimatedFare ?? 0}`, newValue: `${job.estimatedFare}` });
        }
        // Passenger name
        if (job.passenger?.name && job.passenger.name !== current.passenger?.name && job.passenger.name !== 'Unknown') {
          detectedChanges.push({ field: 'Passenger Name', oldValue: current.passenger?.name || 'Not set', newValue: job.passenger.name });
        }
        // Passenger phone
        if (job.passenger?.phone && job.passenger.phone !== current.passenger?.phone) {
          detectedChanges.push({ field: 'Passenger Phone', oldValue: current.passenger?.phone || 'Not set', newValue: job.passenger.phone });
        }
        // Vehicle type
        if (job.vehicleType && job.vehicleType !== current.vehicleType) {
          detectedChanges.push({ field: 'Vehicle Type', oldValue: current.vehicleType || 'Not set', newValue: job.vehicleType });
        }
      }

      // Update the current job state with new data
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

      // Show the update modal if there are changes to display
      if (detectedChanges.length > 0) {
        setUpdateModal({
          visible: true,
          changes: detectedChanges,
        });
      }
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

      if (
        statusRef.current === "PENDING_PAYMENT" &&
        !["COMPLETED", "CANCELLED", "REJECTED", "NO_SHOW", "RECALLED", "IDLE"].includes(
          nextStatus
        )
      ) {
        console.log(
          "[JobContext] ⏸️ Ignoring server status update while collecting payment",
          {
            incoming: nextStatus,
            jobId: currentJobRef.current?.id,
          }
        );
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
        if (
          statusRef.current === "PENDING_PAYMENT" &&
          !["COMPLETED", "CANCELLED", "REJECTED", "NO_SHOW", "RECALLED", "IDLE"].includes(
            confirmedStatus
          )
        ) {
          console.log(
            "[JobContext] ⏸️ Ignoring confirmation status while collecting payment",
            {
              incoming: confirmedStatus,
              jobId: currentJobRef.current?.id,
            }
          );
          return;
        }

        if (confirmedStatus === "IDLE") {
          clearJob();
        } else if (confirmedStatus === "COMPLETED") {
          // ✅ FIX: Don't call clearJob() immediately for COMPLETED
          // Set status to COMPLETED so JobQueueContext can detect and auto-start queued job
          // Job will be cleared after queue processing or by fallback timeout
          console.log('[JobContext] ✅ Job COMPLETED confirmed - setting status (not clearing yet, queue may auto-start)');
          setStatus(confirmedStatus);
          setCurrentJob((previous) =>
            previous ? { ...previous, status: confirmedStatus } : previous
          );
        } else if (confirmedStatus === "REJECTED") {
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

    // Wrap every socket handler in try/catch. A malformed payload from the
    // server previously surfaced as an unhandled promise rejection, which on
    // Android tears the RN bridge and makes the app look "crashed / minimised"
    // to the driver. Logging and swallowing lets the session continue so the
    // dispatcher can resend the job.
    const safe = <H extends (...a: any[]) => any>(label: string, fn: H) =>
      (...args: any[]) => {
        try {
          const r = fn(...args);
          if (r && typeof (r as any).catch === 'function') {
            (r as any).catch((err: any) =>
              console.error(`⚠️ socket handler "${label}" threw:`, err?.message || err),
            );
          }
        } catch (err: any) {
          console.error(`⚠️ socket handler "${label}" threw:`, err?.message || err);
        }
      };
    const safeJobAssigned = safe('job_assigned', handleJobAssigned);
    const safeJobUnassigned = safe('job_unassigned', handleJobUnassigned);
    const safeJobCancelled = safe('job:cancelled', handleJobCancelled);
    const safeJobTaken = safe('job:taken', handleJobTaken);
    const safeJobDataUpdated = safe('job:data:updated', handleJobDataUpdated);
    const safeJobProgressUpdated = safe('job:progress:updated', handleJobProgressUpdated);
    const safeServerJobConfirmed = safe('server:job:confirmed', handleServerJobConfirmed);
    const safeServerJobError = safe('server:job:error', handleServerJobError);

    socket.on("job_assigned", safeJobAssigned);
    socket.on("jobAssigned", safeJobAssigned);
    socket.on("job_unassigned", safeJobUnassigned);
    socket.on("jobUnassigned", safeJobUnassigned);
    socket.on("job:cancelled", safeJobCancelled);
    socket.on("job:taken", safeJobTaken);
    socket.on("job:data:updated", safeJobDataUpdated);
    socket.on("job:progress:updated", safeJobProgressUpdated);
    socket.on("server:job:confirmed", safeServerJobConfirmed);
    socket.on("server:job:error", safeServerJobError);

    console.log(`🔌 JobContext: Socket connected = ${socket.connected}`);
    console.log(`🔌 JobContext: Socket ID = ${socket.id}`);

    return () => {
      socket.off("job_assigned", safeJobAssigned);
      socket.off("jobAssigned", safeJobAssigned);
      socket.off("job_unassigned", safeJobUnassigned);
      socket.off("jobUnassigned", safeJobUnassigned);
      socket.off("job:cancelled", safeJobCancelled);
      socket.off("job:taken", safeJobTaken);
      socket.off("job:data:updated", safeJobDataUpdated);
      socket.off("job:progress:updated", safeJobProgressUpdated);
      socket.off("server:job:confirmed", safeServerJobConfirmed);
      socket.off("server:job:error", safeServerJobError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    driver?.id,
    driver?.companyId,
    driver?.company?.id,
    setIncomingJob,
    clearJob,
    mapProgressToStatus,
    // ❌ REMOVED: shiftContext.selectedTariff, shiftContext.tariffs
    // These were causing infinite loops because state restoration updates them,
    // which re-triggered socket setup, which re-authenticated, which restored state again
    // The values are used in event handlers which access them via closure/context
  ]);

  useEffect(() => {
    const jobId = currentJob?.id;
    const driverId = driver?.id;

    console.log('[video] 🎥 Auto-start check:', {
      jobId,
      driverId,
      resolvedCompanyId,
      status,
      videoStatus: videoStreamingState.status,
      videoJobId: videoStreamingState.jobId,
      statusInSet: VIDEO_STREAMING_JOB_STATUSES.has(status),
    });

    if (!jobId || !driverId || !resolvedCompanyId) {
      console.log('[video] ❌ Missing context for video:', { jobId, driverId, resolvedCompanyId });
      if (videoStreamingState.status !== "idle") {
        stopDriverVideoStream("missing_context").catch((error) => {
          console.warn("[video] Cleanup after missing context failed", error);
        });
      }
      return;
    }

    const shouldAutoStart =
      VIDEO_STREAMING_JOB_STATUSES.has(status) &&
      (videoStreamingState.status === "idle" ||
        videoStreamingState.jobId !== jobId);

    console.log('[video] 🎬 Should auto-start:', shouldAutoStart);

    if (shouldAutoStart) {
      console.log('[video] 🚀 Starting video stream...');
      startDriverVideoStream({
        jobId,
        driverId,
        companyId: resolvedCompanyId,
      }).catch((error) => {
        console.warn("[video] Failed to auto-start video stream", error);
      });
      return;
    }

    const shouldAutoStop =
      (!VIDEO_STREAMING_JOB_STATUSES.has(status) ||
        videoStreamingState.jobId !== jobId) &&
      videoStreamingState.status !== "idle";

    if (shouldAutoStop) {
      stopDriverVideoStream("status_not_streamable").catch((error) => {
        console.warn("[video] Failed to auto-stop video stream", error);
      });
    }
  }, [
    status,
    currentJob?.id,
    driver?.id,
    resolvedCompanyId,
    videoStreamingState.status,
    videoStreamingState.jobId,
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
        
        // ✅ FIX: Don't override local state if we already have this job with a more recent status change
        // This prevents socket reconnection from overriding pause/resume/complete actions
        if (currentJobRef.current?.id === serverJob.id) {
          const localStatus = statusRef.current;
          
          // If local status is PAUSED, COMPLETED, or CANCELLED, trust local state over server
          // Server might have stale STARTED status when we just paused locally
          if (localStatus === 'PAUSED' || localStatus === 'COMPLETED' || localStatus === 'CANCELLED') {
            console.log(`⚠️ JobContext: Ignoring server status (${serverJob.status}) - local status is ${localStatus} (more recent)`);
            return;
          }
          
          // If local status is PENDING_PAYMENT, don't revert to STARTED
          if (localStatus === 'PENDING_PAYMENT' && serverJob.status === 'STARTED') {
            console.log(`⚠️ JobContext: Ignoring server STARTED - local is PENDING_PAYMENT (more recent)`);
            return;
          }
        }
        
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
          // Intermediate stops
          stops: (() => {
            const reqs = serverJob.requirements;
            const parsed = typeof reqs === 'string' ? JSON.parse(reqs) : (reqs || {});
            return Array.isArray(parsed.stops) ? parsed.stops : [];
          })(),
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

  // ✅ NEW: Register socket listener for job unassignment/recall (dispatch takes back job)
  useEffect(() => {
    if (!driver?.id) {
      return;
    }

    const handleJobUnassigned = (data: { jobId: string; internalJobId?: string; reason?: string; message?: string }) => {
      console.log('🔄 JobContext: Job unassigned/recalled by dispatch:', {
        receivedJobId: data.jobId,
        receivedInternalJobId: data.internalJobId,
        currentJobId: currentJobRef.current?.jobId,
        currentInternalId: currentJobRef.current?.id,
        currentStatus: statusRef.current,
        reason: data.reason,
        message: data.message,
      });

      // Match job by either jobId (public ID) or internalJobId (database ID)
      const jobMatches = 
        currentJobRef.current?.jobId === data.jobId || 
        currentJobRef.current?.id === data.jobId ||
        currentJobRef.current?.id === data.internalJobId ||
        currentJobRef.current?.jobId === data.internalJobId ||
        currentJobRef.current?.id?.toString() === data.jobId?.toString() ||
        currentJobRef.current?.jobId?.toString() === data.jobId?.toString();

      if (jobMatches) {
        console.log('✅ JobContext: Clearing job - taken back by dispatch');
        
        // Stop video streaming if active
        if (videoStreamingState.status !== 'idle') {
          stopDriverVideoStream('job_unassigned').catch((error) => {
            console.warn('[video] Failed to stop video on job unassignment', error);
          });
        }
        
        // Clear the job and reset to IDLE
        clearJob();
        
        // Emit driver status as AVAILABLE
        emitDriverStatus("AVAILABLE", location ?? undefined);
        
        // Show beautiful modal to driver
        setTimeout(() => {
          setRecallModal({
            visible: true,
            title: 'Job Recalled',
            message: data.message || data.reason || 'This job has been taken back by dispatch.',
            type: 'recalled',
          });
        }, 300);
      } else {
        console.log('ℹ️ JobContext: Ignoring unassignment for different job:', {
          unassignedJobId: data.jobId,
          currentJobId: currentJobRef.current?.id,
        });
      }
    };

    // Register the callback
    const { registerJobUnassignedCallback, unregisterJobUnassignedCallback } = require('../services/driverSocket');
    registerJobUnassignedCallback(handleJobUnassigned);
    console.log('✅ JobContext: Registered for job unassignment notifications');

    // Cleanup on unmount
    return () => {
      unregisterJobUnassignedCallback(handleJobUnassigned);
      console.log('🧹 JobContext: Job unassignment listener unregistered');
    };
  }, [driver?.id]);

  // 🆕 POLLING FALLBACK: Periodically verify job is still assigned to this driver
  // This catches cases where socket events are missed (e.g., network issues)
  // ⚠️ DISABLED: getActiveJob() returns null (no backend endpoint exists for /mobile/driver/jobs/current)
  // This was causing false "Job Recalled" popups because null was treated as "no active job".
  // Re-enable this once a real backend endpoint is implemented.
  /*
  useEffect(() => {
    if (!currentJob?.id || !driver?.id) {
      return;
    }

    // Don't poll for completed/cancelled/payment jobs
    const nonPollableStatuses: JobStatus[] = ['COMPLETED', 'CANCELLED', 'IDLE', 'PENDING_PAYMENT'];
    if (nonPollableStatuses.includes(status)) {
      return;
    }

    // Validity polling cadence. Was 10 s — felt laggy to drivers when the
    // socket briefly missed an event. 3 s keeps the fallback near-instant
    // while still cheap.
    const POLL_INTERVAL_MS = 3000;

    const checkJobValidity = async () => {
      try {
        const { getActiveJob } = await import('../services/v2/jobService');
        const response = await getActiveJob();
        
        const serverJob = response?.job || response?.data?.job || response?.data || response;
        
        // If server returns no active job, the job was recalled/unassigned
        if (!serverJob || !serverJob.id) {
          console.log('🔄 POLL: Server returned no active job - job was likely recalled');
          setRecallModal({
            visible: true,
            title: 'Job Recalled',
            message: 'This job has been taken back by dispatch.',
            type: 'recalled',
          });
          clearJob();
          emitDriverStatus("AVAILABLE", location ?? undefined);
          return;
        }

        // If server returns a different job, clear current and set new
        if (serverJob.id !== currentJobRef.current?.id && 
            serverJob.jobId !== currentJobRef.current?.jobId) {
          console.log('🔄 POLL: Server returned different job - switching to new job');
          clearJob();
          // Job context should be restored via driver state restoration
          return;
        }

        // If server shows job as UNASSIGNED/CANCELLED, clear it
        if (serverJob.status === 'UNASSIGNED' || serverJob.status === 'CANCELLED' || serverJob.status === 'RECALLED') {
          console.log(`🔄 POLL: Server shows job status as ${serverJob.status} - clearing job`);
          setRecallModal({
            visible: true,
            title: serverJob.status === 'CANCELLED' ? 'Job Cancelled' : 'Job Recalled',
            message: `This job has been ${serverJob.status.toLowerCase()} by dispatch.`,
            type: serverJob.status === 'CANCELLED' ? 'cancelled' : 'recalled',
          });
          clearJob();
          emitDriverStatus("AVAILABLE", location ?? undefined);
          return;
        }

        // If server shows different driver assigned, clear it
        if (serverJob.assignedDriverId && serverJob.assignedDriverId !== driver?.id) {
          console.log('🔄 POLL: Job assigned to different driver - clearing job');
          setRecallModal({
            visible: true,
            title: 'Job Reassigned',
            message: 'This job has been assigned to another driver.',
            type: 'taken',
          });
          clearJob();
          emitDriverStatus("AVAILABLE", location ?? undefined);
          return;
        }

        console.log('✅ POLL: Job still valid');
      } catch (error: any) {
        // If we get a 404, the endpoint may not exist or the job is gone
        // Only clear if we're confident the endpoint works (not a route-level 404)
        if (error?.response?.status === 404) {
          console.warn('⚠️ POLL: Got 404 - endpoint may not exist, ignoring');
          return;
        }
        console.warn('⚠️ POLL: Failed to check job validity:', error?.message);
      }
    };

    // Run immediately once
    checkJobValidity();

    // Set up polling interval
    const pollInterval = setInterval(checkJobValidity, POLL_INTERVAL_MS);
    console.log(`🔄 JobContext: Started job validity polling (every ${POLL_INTERVAL_MS / 1000}s)`);

    return () => {
      clearInterval(pollInterval);
      console.log('🧹 JobContext: Stopped job validity polling');
    };
  }, [currentJob?.id, driver?.id, status, clearJob, location]);
  */

  // ✅ FALLBACK: If status stays COMPLETED for 5 seconds, clear job
  // This handles the case where there's no queued job to auto-start
  useEffect(() => {
    if (status === 'COMPLETED') {
      const fallbackTimeout = setTimeout(() => {
        console.log('[JobContext] ⏰ COMPLETED fallback - clearing job after 5s (no queue auto-start)');
        clearJob();
      }, 5000);
      
      return () => clearTimeout(fallbackTimeout);
    }
  }, [status, clearJob]);

  // 🆕 IDLE POLLING: If the driver has NO current job but an active shift,
  // poll the server for OFFERED jobs we may have missed via the socket.
  // This is the safety net for dead-socket / empty-room situations.
  useEffect(() => {
    // Only poll when driver is idle (no current job) and has an active shift
    if (currentJob || !driver?.id) {
      return;
    }

    // Only poll if the status is IDLE or we have no status
    if (status !== 'IDLE' && status !== 'INCOMING') {
      // If status is something else (ASSIGNED, ON_THE_WAY, etc.) we shouldn't be polling
      // unless status is IDLE
      if (status !== 'IDLE') {
        return;
      }
    }

    // Idle polling cadence. Was 8 s — drivers saw up to an 8 s gap between
    // dispatcher send and job appearing when the socket event was dropped.
    // 3 s keeps the worst-case wait inside the "instant" feel.
    const IDLE_POLL_INTERVAL_MS = 3000;
    let isMounted = true;

    const checkForPendingJobs = async () => {
      if (!isMounted) return;
      try {
        const { getActiveJob } = await import('../services/v2/jobService');
        const response = await getActiveJob();
        if (!isMounted) return;
        
        const serverJob = response?.job || response?.data?.job || response?.data || response;
        
        if (serverJob && serverJob.id && serverJob.status === 'OFFERED') {
          console.log('📡 IDLE_POLL: Found a pending OFFERED job from server!', serverJob.id);
          
          // Build an ActiveJob and trigger the job offer UI
          // Use setIncomingJob to show the accept/reject screen
          const incomingJob = {
            id: String(serverJob.id),
            internalJobId: String(serverJob.id),
            legacyJobId: null,
            publicJobId: serverJob.jobId ? String(serverJob.jobId) : null,
            jobId: serverJob.jobId || serverJob.id,
            assignmentId: serverJob.assignmentId || null,
            offerId: serverJob.offerId || null,
            status: 'INCOMING' as any,
            createdAt: serverJob.createdAt || new Date().toISOString(),
            pickupAddress: serverJob.pickupAddress || 'Unknown',
            pickupLatitude: serverJob.pickupLatitude || null,
            pickupLongitude: serverJob.pickupLongitude || null,
            dropoffAddress: serverJob.dropoffAddress || 'Unknown',
            dropoffLatitude: serverJob.dropoffLatitude || null,
            dropoffLongitude: serverJob.dropoffLongitude || null,
            distance: serverJob.distance || 0,
            estimatedDuration: serverJob.estimatedDuration || null,
            estimatedFare: serverJob.estimatedPrice || serverJob.estimatedFare || 0,
            actualFare: serverJob.actualFare || 0,
            fare: serverJob.actualFare || serverJob.estimatedPrice || 0,
            vehicleType: serverJob.vehicleType || null,
            tariff: undefined,
            tariffName: null,
            passenger: {
              id: serverJob.customer?.id || serverJob.customerId || null,
              name: serverJob.customer?.name || 'Unknown',
              phone: serverJob.customer?.phone || '',
            },
            countdownMs: undefined,
            expiresAt: undefined,
            company: undefined,
          };

          setIncomingJob(incomingJob as any);
          console.log('✅ IDLE_POLL: Triggered incoming job UI via polling');
        }
      } catch (error: any) {
        // Silently ignore polling errors — socket is primary, this is a fallback
        if (error?.response?.status !== 404 && error?.response?.status !== 401) {
          console.warn('⚠️ IDLE_POLL: Error checking for pending jobs:', error?.message);
        }
      }
    };

    // Run after a short delay (allow socket events to arrive first)
    const initialDelay = setTimeout(() => {
      if (isMounted) checkForPendingJobs();
    }, 3000);

    const pollInterval = setInterval(checkForPendingJobs, IDLE_POLL_INTERVAL_MS);
    console.log(`📡 JobContext: Started idle job polling (every ${IDLE_POLL_INTERVAL_MS / 1000}s)`);

    return () => {
      isMounted = false;
      clearTimeout(initialDelay);
      clearInterval(pollInterval);
      console.log('🧹 JobContext: Stopped idle job polling');
    };
  }, [currentJob, driver?.id, status, setIncomingJob]);

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

    // Silence the looping ringer + system notification immediately so
    // the chime stops the moment the driver taps Accept.
    try {
      const { JobNotification } = require('react-native').NativeModules;
      JobNotification?.cancelJobNotification?.().catch?.(() => {});
    } catch (_e) { /* native module not present — fine */ }

    console.log("✅ JobContext: Accepting job", currentJob.id);

    setStatus("ASSIGNED");
    setCurrentJob((prev) => (prev ? { ...prev, status: "ASSIGNED" } : prev));

    const acceptAction = {
      type: "ACCEPT" as const,
      jobId: String(currentJob.id),
      targetStatus: "ASSIGNED" as JobStatus,
    };

    setPendingAction(acceptAction);

    // Emit BOTH a dedicated job:accept and a job:progress:update with
    // status='ACCEPTED'. The progress emit goes through the offline-queue
    // path (smartEmit) so it survives a socket-reconnect window — that's
    // the canonical signal. The direct socket.emit('job:accept') is the
    // fast path when the socket is already up. The backend handles
    // either independently and is idempotent, so worst case the job
    // status flips ASSIGNED twice (no-op the second time). Previously,
    // when the app came back from background via an FCM tap and the
    // driver tapped Accept before the socket finished re-authenticating,
    // the direct emit was lost AND the progress emit's ACCEPTED status
    // had no handler server-side — so dispatch stayed stuck on OFFERED
    // even though the driver was already mid-trip.
    const socket = getSocket();
    if (socket && socket.connected) {
      socket.emit("job:accept", {
        jobId: currentJob.id,
        driverId: driver?.id,
        acceptedAt: new Date().toISOString(),
        location: location ? {
          latitude: location.latitude,
          longitude: location.longitude,
        } : undefined,
      });
      console.log("📡 JobContext: Emitted job:accept (fast path, socket connected)");
    } else {
      console.log("📡 JobContext: Socket not connected, relying on progress:update queue");
    }

    emitJobProgress(currentJob.id, "ACCEPTED", location ?? undefined, {
      acceptedAt: new Date().toISOString(),
      driverId: driver?.id,
    });
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

      // Silence the looping ringer + system notification immediately
      // on reject — both manual and timeout-triggered.
      try {
        const { JobNotification } = require('react-native').NativeModules;
        JobNotification?.cancelJobNotification?.().catch?.(() => {});
      } catch (_e) { /* native module not present — fine */ }

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

    // Hard limit: a driver may pause a single job at most 3 times. The
    // dispatcher expects pauses to be exceptional ("traffic cop", "rest
    // stop") and our settlement engine doesn't price unlimited pauses
    // sensibly. Beyond 3, the driver must finish or recall the job.
    const MAX_PAUSES_PER_JOB = 3;
    if (pauseRecords.length >= MAX_PAUSES_PER_JOB) {
      console.warn(`[JobContext] ⛔ Pause limit reached (${pauseRecords.length}/${MAX_PAUSES_PER_JOB}) — request rejected`);
      try {
        const Toast = require('react-native-toast-message').default;
        Toast.show({
          type: 'error',
          text1: 'Pause limit reached',
          text2: `You have already paused this job ${pauseRecords.length} times. Finish or contact dispatch.`,
        });
      } catch {}
      return;
    }

    const pauseTime = new Date().toISOString();
    console.log(`[JobContext] ⏸️ Pausing job (pause #${pauseRecords.length + 1}/${MAX_PAUSES_PER_JOB})`);
    
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
    globalJobTimer.pause();
    pausedLocationRef.current = location
      ? {
          latitude: Number(location.latitude),
          longitude: Number(location.longitude),
          timestamp: Number(location.timestamp) || Date.now(),
        }
      : null;
    autoResumeInFlightRef.current = false;
    
    // Flush latest timer metrics before pausing processors
    syncTimerFromEngine();
    
    // ✅ NEW: Pause background meter service
    jobMeterService.pauseJobMeter().catch(error => {
      console.warn('Failed to pause background meter:', error);
    });
    
    // Emit to backend with the running pause-count + this pause record so
    // the dispatcher's Job Timeline can render "Driver paused (2/3)" and
    // settlement / abuse-alerting can act on it.
    emitJobProgress(currentJob.id, 'PAUSED', location ?? undefined, {
      pauseCount: updatedPauseRecords.length,
      pauseRecord: newPauseRecord,
      pausedAt: pauseTime,
    });

    console.log('[JobContext] ✅ Job paused successfully');
  }, [currentJob, status, pauseRecords, location, syncTimerFromEngine]);

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
    
    // ✅ FIX: Sync timer from engine before resuming (ensure UI has latest state)
    syncTimerFromEngine();
    
    // Update job
    setCurrentJob((prev) => prev ? {
      ...prev,
      status: 'STARTED',
      pause_records: updatedPauseRecords,
      resume_job_time: resumeTime,
    } : null);
    
    setStatus('STARTED');
    const resumeLocation = location ?? locationRef.current ?? null;
    globalJobTimer.resume(resumeLocation);
    pausedLocationRef.current = null;
    autoResumeInFlightRef.current = false;
    
    // ✅ NEW: Resume background meter service
    jobMeterService.resumeJobMeter().catch(error => {
      console.warn('Failed to resume background meter:', error);
    });
    
    // Emit to backend
    emitJobProgress(currentJob.id, 'STARTED', location ?? undefined);
    
    console.log('[JobContext] ✅ Job resumed successfully');
  }, [currentJob, status, pauseRecords, location, syncTimerFromEngine]);

  const resumePendingPayment = useCallback(() => {
    if (status !== 'PENDING_PAYMENT') {
      return;
    }

    console.log('[JobContext] 🔄 Resuming job after leaving payment screen');
    const snapshot = pendingPaymentSnapshotRef.current;
    if (snapshot?.timerState) {
      // CRITICAL: snapshot.timerState was captured BEFORE we called
      // globalJobTimer.pause() in the PENDING_PAYMENT transition, so its
      // `isPaused` flag is false. Restoring it as-is leaves the timer
      // thinking it's already running, and resume() is a no-op (returns
      // immediately when !isPaused). The result was `lastUpdateTime`
      // never being bumped to `now`, so the processor's first tick
      // either added the entire payment-screen duration as waiting OR
      // computed garbage and stalled — which is what the driver sees as
      // "waiting time stopped". Force isPaused=true on restore so that
      // resume() actually runs the rebase logic (lastUpdateTime = now,
      // totalPausedMillis += pause duration).
      globalJobTimer.restoreState({
        ...snapshot.timerState,
        isPaused: true,
        pauseStartedAt: snapshot.timerState.pauseStartedAt ?? Date.now(),
      });
      const resumeLocation = locationRef.current ?? null;
      globalJobTimer.resume(resumeLocation);
      syncTimerFromEngine();
    } else {
      // No snapshot (e.g. user navigated to payment via a path that
      // didn't capture state) — at minimum unpause the timer if it was
      // paused, so the processor can start ticking again.
      if (globalJobTimer.isTimerPaused()) {
        globalJobTimer.resume(locationRef.current ?? null);
      }
    }
    pendingPaymentSnapshotRef.current = null;
    setStatus('STARTED');
    // Force the job-processor restart effect to re-fire by toggling the
    // flag. setIsProcessingJob(false) was previously a no-op when it was
    // already false (state didn't change → useEffect didn't re-run).
    // Setting to false is fine here because the useEffect at the top of
    // this provider keys on (status, currentJob?.id, isProcessingJob),
    // and the status flip alone will trigger it now.
    setIsProcessingJob(false);
  }, [status, syncTimerFromEngine]);

  const buildPricingSnapshot = useCallback(
    (
      tariff: Tariff | null | undefined,
      metrics: {
        distanceMeters: number;
        waitingSeconds: number;
        elapsedSeconds: number;
      }
    ): PricingBreakdown | null => {
      if (!tariff) {
        console.warn(
          "[JobContext] ⚠️ Unable to build pricing snapshot - missing tariff"
        );
        return null;
      }

      const baseFare = toSafeNumber(tariff.baseFare, 0);
      const perKmRate = toSafeNumber(tariff.perKmRate, 0);
      const perMinuteRate = toSafeNumber(tariff.perMinuteRate, 0);
      const waitingRate = getWaitingRatePerMinute(tariff);

      const distanceCost = (metrics.distanceMeters / 1000) * perKmRate;
      const durationCost = (metrics.elapsedSeconds / 60) * perMinuteRate;
      const waitingCost = (metrics.waitingSeconds / 60) * waitingRate;
      const totalCost = baseFare + distanceCost + durationCost + waitingCost;

      return {
        startingPrice: baseFare.toFixed(2),
        distanceCost: distanceCost.toFixed(2),
        durationCost: durationCost.toFixed(2),
        waitingCost: waitingCost.toFixed(2),
        totalDistance: Number(metrics.distanceMeters.toFixed(2)),
        duration: Number(metrics.elapsedSeconds.toFixed(2)),
        waitingSeconds: Number(metrics.waitingSeconds.toFixed(2)),
        totalCost: totalCost.toFixed(2),
      };
    },
    []
  );

  // ✨ PREPARE JOB FOR PAYMENT (NOT complete yet!)
  const prepareJobForPayment = useCallback(async (): Promise<ActiveJob | null> => {
    if (!currentJob) {
      console.warn('[JobContext] No job to prepare');
      return null;
    }
    
    console.log('[JobContext] 💰 Preparing job for payment collection');
    
    // Ensure latest timer snapshot is flushed before freezing
    syncTimerFromEngine();
    
    const timerState = globalJobTimer.getState();
    
    const tariffForPricing = currentJob.tariff || shiftContext.selectedTariff;
    const elapsedFallback =
      timerState.startTime && timerState.lastUpdateTime
        ? (timerState.lastUpdateTime - timerState.startTime) / 1000
        : 0;
    const meterSnapshot = {
      distanceMeters: toSafeNumber(
        timer.distanceMeters,
        toSafeNumber(timerState.totalDistanceMeters, 0)
      ),
      waitingSeconds: toSafeNumber(
        timer.waitingSeconds,
        toSafeNumber(timerState.totalWaitingSeconds, 0)
      ),
      elapsedSeconds: toSafeNumber(timer.elapsedSeconds, elapsedFallback),
    };

    let nextPricingBreakdown = pricingBreakdown;
    if (!nextPricingBreakdown) {
      nextPricingBreakdown = buildPricingSnapshot(
        tariffForPricing,
        meterSnapshot
      );
      if (nextPricingBreakdown) {
        setPricingBreakdown(nextPricingBreakdown);
      }
    }

    const totalCostValue = nextPricingBreakdown
      ? Number(nextPricingBreakdown.totalCost)
      : undefined;

    // Build job data with PENDING_PAYMENT status (NOT completed!)
    const pendingPaymentJobData: ActiveJob = {
      ...currentJob,
      status: 'PENDING_PAYMENT', // ✅ NEW STATUS: Waiting for payment
      complete_job_time: new Date().toISOString(),
      
      // Add final metrics
      totalAccumulatedDistanceMeters: meterSnapshot.distanceMeters,
      totalAccumulatedWaitingSeconds: meterSnapshot.waitingSeconds,
      
      // Add pause records
      pause_records: pauseRecords,
      
      // Add pricing breakdown
      pricingBreakdown: nextPricingBreakdown ?? undefined,
      fare: totalCostValue ?? currentJob.fare,
      earningsSoFar:
        totalCostValue !== undefined
          ? totalCostValue.toFixed(2)
          : currentJob.earningsSoFar,
    };
    
    pendingPaymentSnapshotRef.current = {
      timerState,
      pricing: nextPricingBreakdown ?? null,
    };

    globalJobTimer.pause();
    jobProcessor.stopContinuousProcessing();
    setIsProcessingJob(false);

    // Update state to PENDING_PAYMENT (not COMPLETED!)
    setCurrentJob(pendingPaymentJobData);
    setStatus('PENDING_PAYMENT');
    emitJobProgress(currentJob.id, 'PENDING_PAYMENT', location ?? undefined);
    emitDriverStatus('BUSY', location ?? undefined);
    
    console.log('[JobContext] ✅ Job prepared for payment', {
      distance: `${timerState.totalDistanceMeters.toFixed(2)}m`,
      waiting: `${timerState.totalWaitingSeconds}s`,
      totalCost: nextPricingBreakdown?.totalCost,
    });

    emitPersistentSnapshot('final');
    
    return pendingPaymentJobData;
  }, [
    currentJob,
    pauseRecords,
    pricingBreakdown,
    location,
    timer.distanceMeters,
    timer.waitingSeconds,
    timer.elapsedSeconds,
    buildPricingSnapshot,
    shiftContext.selectedTariff,
    emitPersistentSnapshot,
    syncTimerFromEngine,
  ]);

  // ✨ COMPLETE JOB (called AFTER payment is collected)
  const completeJob = useCallback(async (paymentMethod: string, amountPaid: number): Promise<void> => {
    if (!currentJob) {
      console.warn('[JobContext] No job to complete');
      return;
    }

    if (status !== 'PENDING_PAYMENT') {
      console.warn('[JobContext] ⚠️ completeJob called while not collecting payment - aborting to keep driver BUSY', {
        jobId: currentJob.id,
        currentStatus: status,
      });
      return;
    }
    
    console.log('[JobContext] 🏁 Completing job after payment', {
      jobId: currentJob.id,
      paymentMethod,
      amountPaid,
      currentLocation: location ? {
        lat: location.latitude,
        lng: location.longitude
      } : 'No location available'
    });
    
    // Update to COMPLETED status
    setCurrentJob((prev) => prev ? { ...prev, status: 'COMPLETED' } : null);
    setStatus('COMPLETED');
    
    let finalData: Awaited<ReturnType<typeof jobProcessor.finalizeJob>> | null = null;
    try {
      finalData = await jobProcessor.finalizeJob();
    } catch (error) {
      console.warn('[JobContext] Failed to finalize job processor during completion:', error);
    }
    pendingPaymentSnapshotRef.current = null;
    
    // ✅ NEW: Get current location for actual drop-off
    const dropOffLocation = location ? {
      latitude: location.latitude,
      longitude: location.longitude,
      timestamp: new Date().toISOString(),
    } : undefined;
    
    // ✅ Emit completion with drop-off location, final amount, AND the
    // full fare context so the dispatcher's Job Details can render a
    // proper breakdown (tariff used, base/distance/waiting components,
    // actual km, waiting minutes). Without this the backend was only
    // saving `actualFare` and the dispatch UI showed "Standard / 0.00 /
    // 0.00 / 0.00" for every closed walk-in.
    const tariffSnap = shiftContext.selectedTariff || null;
    const breakdown = currentJob.pricingBreakdown || null;
    const tariffPayload = tariffSnap
      ? {
          tariffId: tariffSnap.id,
          tariffName: tariffSnap.name,
        }
      : {};
    const breakdownPayload = breakdown
      ? {
          fareBreakdown: {
            base: Number(breakdown.startingPrice) || 0,
            distance: Number(breakdown.distanceCost) || 0,
            waiting: Number(breakdown.waitingCost) || 0,
            duration: Number(breakdown.durationCost) || 0,
            total: Number(breakdown.totalCost) || 0,
          },
          actualDistanceKm: typeof breakdown.totalDistance === 'number'
            ? breakdown.totalDistance / 1000
            : undefined,
          actualWaitingMinutes: typeof breakdown.waitingSeconds === 'number'
            ? Math.round(breakdown.waitingSeconds / 60)
            : undefined,
          actualDurationSeconds: typeof breakdown.duration === 'number'
            ? breakdown.duration
            : undefined,
        }
      : {};
    emitJobProgress(currentJob.id, 'COMPLETED', dropOffLocation, {
      finalAmount: amountPaid,
      paymentMethod,
      completedAt: new Date().toISOString(),
      ...tariffPayload,
      ...breakdownPayload,
    });
    
    emitDriverStatus('AVAILABLE', location ?? undefined);
    emitPersistentSnapshot('final');

    if (refreshShiftRecentJobs) {
      refreshShiftRecentJobs(3).catch((error) =>
        console.error('[JobContext] Failed to refresh ride history after completion:', error)
      );
    }
    
    // Clear job after a short delay
    setTimeout(() => {
      clearJob();
    }, 2000);
    
    console.log('[JobContext] ✅ Job completed and payment recorded', {
      paymentMethod,
      amountPaid,
      dropOffLocation,
    });
  }, [currentJob, location, clearJob, refreshShiftRecentJobs, emitPersistentSnapshot, status]);

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

    // Hard limit: max 3 tariff changes per job. Tariff swapping can be
    // abused to game pricing (start with cheap rate, switch to expensive
    // mid-trip). Three changes covers legitimate scenarios (zone exit,
    // wheelchair add, night-rate kick-in) without giving free rein.
    const MAX_TARIFF_CHANGES = 3;
    const currentChanges = currentJob.tariffChangeHistory?.length || 0;
    if (currentChanges >= MAX_TARIFF_CHANGES) {
      console.warn(`[JobContext] ⛔ Tariff-change limit reached (${currentChanges}/${MAX_TARIFF_CHANGES}) — request rejected`);
      try {
        const Toast = require('react-native-toast-message').default;
        Toast.show({
          type: 'error',
          text1: 'Tariff change limit reached',
          text2: `You have already changed tariff ${currentChanges} times on this job. Contact dispatch.`,
        });
      } catch {}
      throw new Error('TARIFF_CHANGE_LIMIT_REACHED');
    }

    console.log(`[JobContext] 💱 Changing tariff mid-ride (#${currentChanges + 1}/${MAX_TARIFF_CHANGES}):`, {
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
      
      // Notify backend so the dispatcher's Job Timeline can show "Driver
      // changed tariff: Standard → Doha (2/3)". We use the existing
      // job:progress:update channel with a dedicated `event=TARIFF_CHANGED`
      // discriminator so the server-side handler can append to
      // requirements.tariffChangeHistory and write a job_audit_log row.
      try {
        emitJobProgress(currentJob.id, 'TARIFF_CHANGED', location ?? undefined, {
          event: 'TARIFF_CHANGED',
          tariffChangeIndex: currentChanges + 1,
          tariffChangePoint,
          newTariffId: newTariff.id,
          newTariffName: newTariff.name,
        });
      } catch (emitErr) {
        console.warn('[JobContext] tariff-change emit failed:', (emitErr as any)?.message);
      }
      
      const newWaitingRate = getWaitingRatePerMinute(newTariff);

      console.log('[JobContext] ✅ Tariff changed successfully - pricing will recalculate', {
        newRates: {
          perKm: newTariff.perKmRate,
          perMin: newTariff.perMinuteRate,
          waiting: newWaitingRate,
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
              speedKmh:
                currentTimer.speedKmh ??
                Math.max(((location?.speed ?? 0) as number) * 3.6, 0),
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
      resumePendingPayment,
      prepareJobForPayment, // ✅ NEW
      completeJob,
      changeTariff, // ✅ NEW: Change tariff mid-ride
      videoStreamingState,
      startVideoStreaming: startVideoStreamingManually,
      stopVideoStreaming: stopVideoStreamingManually,
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
      resumePendingPayment,
      prepareJobForPayment, // ✅ NEW
      completeJob,
      changeTariff, // ✅ NEW
      videoStreamingState,
      startVideoStreamingManually,
      stopVideoStreamingManually,
    ]
  );

  return (
    <JobContext.Provider value={value}>
      {children}
      <JobRecalledModal
        visible={recallModal.visible}
        title={recallModal.title}
        message={recallModal.message}
        type={recallModal.type}
        onDismiss={() => setRecallModal(prev => ({ ...prev, visible: false }))}
      />
      <JobUpdatedModal
        visible={updateModal.visible}
        changes={updateModal.changes}
        onDismiss={() => setUpdateModal(prev => ({ ...prev, visible: false }))}
      />
    </JobContext.Provider>
  );
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
        speedKmh: 0,
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
      resumePendingPayment: () => {},
      prepareJobForPayment: async () => null,
      completeJob: async () => {},
      changeTariff: async () => {}, // ✅ NEW
      videoStreamingState: {
        status: "idle",
        jobId: null,
        driverId: null,
        companyId: null,
        localStream: null,
        viewerCount: 0,
        startedAt: null,
        lastUpdatedAt: Date.now(),
        error: null,
        lastStoppedReason: null,
      },
      startVideoStreaming: async () => null,
      stopVideoStreaming: async () => {},
    };
  }
  return context;
};
