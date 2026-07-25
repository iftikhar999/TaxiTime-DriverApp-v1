import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Modal, PanResponder, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
// Use SafeAreaView from react-native-safe-area-context — the legacy
// react-native one has known issues on Android (bottom gesture nav,
// edge-to-edge) and ignores the configured insets provider.
import { SafeAreaView } from "react-native-safe-area-context";
import KeepAwake from "react-native-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { useAuth } from "../../context/AuthContext";
import { useJob } from "../../context/JobContext";
import { useLocation } from "../../context/LocationContext";
import { useShift } from "../../context/ShiftContext";
import { useZone } from "../../context/ZoneContext";
import { updateLocationInterval } from "../../native/locationService";
import { AppStackParamList } from "../../navigation/RootNavigator";
import { fetchCompanySettings, MapProvider } from "../../services/companySettingsService";
import {
    claimUpcomingJob,
    fetchUpcomingJobs,
    updateDriverShiftStatus,
    type DriverShiftStatus,
    type UpcomingJobSummary,
} from "../../services/driverService";
import { getSocket, updateSocketIntervals } from "../../services/driverSocket";
import httpClient from "../../services/httpClient";
import { jobProcessor } from "../../services/jobProcessor";
import { RecentJobSummary } from "../../types/recentJob";
import { RideSummary } from "../../types/rides";
import { calculateDistance, formatDistance } from "../../utils/distance";
import { getWaitingRatePerMinute } from "../../utils/tariffUtils";
import {
    DashboardHeader,
    DashboardMetric,
    EarningsGoalCard,
    GreetingBanner,
    JobStatusCards,
    LocationMap,
    OutOfZoneBanner,
    QuickActionsBar,
    // OverlayPermissionBanner is added separately below — Home/components
    // re-exports require a barrel update; we import directly to avoid that.
    // RecentJobsSection — moved to JobHistoryScreen
    StatusModal,
    TariffCard,
    UpcomingJobsSection,
    WalkInDropoffPicker,
    type WalkInDropoffSelection
} from "./components";
import OverlayPermissionBanner from "./components/OverlayPermissionBanner";
import { formatCurrency, formatDuration, formatShiftDuration, normalizeMapProvider } from "./utils/homeScreenUtils";

type DriverAvailability = "AVAILABLE" | "AWAY" | "BUSY";

const combineName = (first?: string | null, last?: string | null) => {
  const value = [first, last].filter(Boolean).join(" ").trim();
  return value.length ? value : undefined;
};

const prettifyStatus = (status?: string | null) => {
  if (!status) {
    return "In Progress";
  }
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const HomeScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const { driver, logout } = useAuth();
  const {
    selectedVehicle,
    selectedTariff,
    tariffs,
    refreshTariffs,
    selectTariff,
    activeShift,
    recentJobs,
    recentJobsLoading,
    refreshCurrentShift,
    refreshRecentJobs,
    endShift: endShiftAction,
  } = useShift();
  const { status: jobStatus, currentJob, startWalkInJob, timer, pricingBreakdown, setIncomingJob } = useJob();
  const { location } = useLocation();
  const { currentZone, loading: zoneLoading, error: zoneError, forceRefresh: retryZoneDetection, isOutOfZone, lastKnownZoneName, dismissOutOfZone } = useZone();
  const latestLocationRef = useRef(location);
  const lastUpcomingRefreshRef = useRef(0);
  const tariffRepairInFlight = useRef(false);
  useEffect(() => {
    latestLocationRef.current = location;
  }, [location]);
  
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, "Home">>();
  
  const [mapProvider, setMapProvider] = useState<MapProvider>("NATIVE");
  const [mapProviderLoading, setMapProviderLoading] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Track if config loaded
  const [locationUpdateInterval, setLocationUpdateInterval] = useState<number>(5); // Default 5 seconds
  const [manualStatus, setManualStatus] = useState<Exclude<DriverAvailability, "BUSY">>("AVAILABLE");
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJobSummary[]>([]);
  const [upcomingJobsLoading, setUpcomingJobsLoading] = useState(false);
  const [upcomingJobsError, setUpcomingJobsError] = useState<string | null>(null);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);

  // Eligibility self-diagnostic — drives the badge that tells the driver
  // why (or why not) they'd receive a job offer right now.
  // Refreshed on mount + every 45s while home is visible.
  const [eligibility, setEligibility] = useState<{
    verdict: 'ACCEPTING' | 'PARTIAL' | 'OFF_SHIFT' | 'INELIGIBLE' | 'LOADING';
    reasons: string[];
  }>({ verdict: 'LOADING', reasons: [] });
  const [walkInConfirmVisible, setWalkInConfirmVisible] = useState(false);
  const [walkInSliderResetKey, setWalkInSliderResetKey] = useState(0);
  const [creatingWalkInJob, setCreatingWalkInJob] = useState(false);
  const [walkInDropoff, setWalkInDropoff] = useState<WalkInDropoffSelection | null>(null);
  const [lastWalkInDropoff, setLastWalkInDropoff] = useState<WalkInDropoffSelection | null>(null);
  const [walkInDropoffPickerVisible, setWalkInDropoffPickerVisible] = useState(false);
  const [awayReminderVisible, setAwayReminderVisible] = useState(false);
  const [tariffPickerVisible, setTariffPickerVisible] = useState(false);

  const resetWalkInSlider = useCallback(
    (options?: { preserveDropoff?: boolean }) => {
      setWalkInSliderResetKey((key) => key + 1);
      if (!options?.preserveDropoff) {
        setWalkInDropoff((previous) => {
          if (previous) {
            setLastWalkInDropoff(previous);
          }
          return null;
        });
      }
    },
    []
  );

  const openWalkInDropoffPicker = useCallback(() => {
    setWalkInDropoffPickerVisible(true);
  }, []);

  const closeWalkInDropoffPicker = useCallback(() => {
    setWalkInDropoffPickerVisible(false);
  }, []);

  const handleWalkInDropoffSelected = useCallback((selection: WalkInDropoffSelection) => {
    setWalkInDropoff(selection);
    setWalkInDropoffPickerVisible(false);
  }, []);

  const handleClearWalkInDropoff = useCallback(() => {
    setWalkInDropoff((previous) => {
      if (previous) {
        setLastWalkInDropoff(previous);
      }
      return null;
    });
  }, []);

  const handleUseLastWalkInDropoff = useCallback(() => {
    if (lastWalkInDropoff) {
      setWalkInDropoff(lastWalkInDropoff);
    }
  }, [lastWalkInDropoff]);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [timeTicker, setTimeTicker] = useState(Date.now());
  const awayReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasNavigatedRef = useRef<string | null>(null);

  const lastSyncedStatus = useRef<DriverShiftStatus | null>(null);
  const statusSyncPending = useRef<boolean>(false);
  const statusSyncTimestamp = useRef<number>(0);
  const openDrawer = useCallback(() => {
    setDrawerVisible(true);
    requestAnimationFrame(() => {
      Animated.timing(drawerAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setDrawerVisible(false);
      }
    });
  }, [drawerAnim]);

  // Derived state - check if driver is busy based on job status
  const isBusy = useMemo(
    () =>
      [
        "INCOMING",
        "ASSIGNED",
        "ACCEPTED",
        "ON_THE_WAY",
        "ARRIVED",
        "STARTED",
      ].includes(jobStatus),
    [jobStatus]
  );
  const driverStatus: DriverAvailability = useMemo(
    () => {
      // ✅ Only show AVAILABLE/AWAY/BUSY status when there's an active shift
      if (!activeShift?.id) {
        return "AWAY"; // Will display as "Offline" when no shift
      }
      return isBusy ? "BUSY" : manualStatus;
    },
    [isBusy, manualStatus, activeShift?.id]
  );

  const shouldShowUpcomingJobs = useMemo(
    () => !isBusy && !currentJob && Boolean(currentZone?.id) && Boolean(activeShift?.id),
    [isBusy, currentJob, currentZone?.id, activeShift?.id]
  );

  const activeJobPreview = useMemo(() => {
    if (!currentJob) {
      return null;
    }

    const tariff = (currentJob as any)?.tariff || selectedTariff;
    const elapsedSeconds = timer?.elapsedSeconds ?? 0;
    const waitingSeconds = Math.min(timer?.waitingSeconds ?? 0, elapsedSeconds);
    const distanceMeters = timer?.distanceMeters ?? 0;

    const fareFromBreakdown = pricingBreakdown?.totalCost
      ? Number.parseFloat(String(pricingBreakdown.totalCost))
      : null;

    const waitingRate = getWaitingRatePerMinute(tariff);

    const liveFare = tariff
      ? (tariff.baseFare ?? 0) +
        (distanceMeters / 1000) * (tariff.perKmRate ?? 0) +
        (elapsedSeconds / 60) * (tariff.perMinuteRate ?? 0) +
        (waitingSeconds / 60) * waitingRate
      : null;

    const fallbackFare =
      currentJob.fare ??
      currentJob.estimatedFare ??
      currentJob.estimatedPrice ??
      0;

    const passengerName =
      currentJob.passenger?.name ||
      combineName(currentJob.passenger?.firstName, currentJob.passenger?.lastName) ||
      combineName(currentJob.customer?.firstName, currentJob.customer?.lastName);

    const destination =
      currentJob.dropoffAddress ||
      (currentJob as any)?.destination?.address ||
      "Destination pending";
    const dropoffLatitude =
      typeof currentJob.dropoffLatitude === "number" && Number.isFinite(currentJob.dropoffLatitude)
        ? currentJob.dropoffLatitude
        : typeof (currentJob as any)?.destination?.latitude === "number"
        ? (currentJob as any).destination.latitude
        : null;
    const dropoffLongitude =
      typeof currentJob.dropoffLongitude === "number" && Number.isFinite(currentJob.dropoffLongitude)
        ? currentJob.dropoffLongitude
        : typeof (currentJob as any)?.destination?.longitude === "number"
        ? (currentJob as any).destination.longitude
        : null;

    const statusLabel = prettifyStatus(jobStatus);
    const jobLabel = currentJob.publicJobId || currentJob.jobId || currentJob.id;
    const displayJobId = jobLabel && jobLabel.length > 14
      ? `${jobLabel.slice(0, 8)}…${jobLabel.slice(-4)}`
      : jobLabel;

    const fareValue = liveFare ?? fareFromBreakdown ?? fallbackFare;

    return {
      jobLabel,
      displayJobId,
      passengerName,
      destination,
      dropoffLatitude,
      dropoffLongitude,
      statusLabel,
      fareLabel: formatCurrency(Math.max(fareValue, 0)),
      durationLabel: formatShiftDuration(elapsedSeconds),
      waitingLabel: waitingSeconds > 0 ? formatShiftDuration(waitingSeconds) : null,
    };
  }, [currentJob, jobStatus, pricingBreakdown, selectedTariff, timer?.distanceMeters, timer?.elapsedSeconds, timer?.waitingSeconds]);

  const upcomingJobsCards = useMemo(
    () =>
      upcomingJobs.map((job) => ({
        id: job.id,
        pickupAddress: job.pickup?.address || "Pickup location pending",
        dropoffAddress: job.dropoff?.address || undefined,
        estimatedDistance:
          job.distanceToPickup ?? job.estimatedDistance ?? undefined,
        estimatedFare: job.estimatedFare ?? undefined,
        scheduledFor: job.scheduledAt ?? undefined,
        passengerName:
          combineName(job.customer?.firstName, job.customer?.lastName) ||
          undefined,
        isLate: job.isLate,
        minutesToPickup: job.minutesToPickup,
        distanceToPickup: job.distanceToPickup,
      })),
    [upcomingJobs]
  );

  const decorateUpcomingJobs = useCallback(
    (jobs: UpcomingJobSummary[]) => {
      const latestLocation = latestLocationRef.current;
      if (!latestLocation?.latitude || !latestLocation?.longitude) {
        return jobs;
      }

      return jobs
        .map((job) => {
          const pickupLat = job.pickup?.latitude;
          const pickupLng = job.pickup?.longitude;
          if (
            typeof pickupLat === "number" &&
            typeof pickupLng === "number" &&
            Number.isFinite(pickupLat) &&
            Number.isFinite(pickupLng)
          ) {
            const distanceToPickup = calculateDistance(
              latestLocation.latitude,
              latestLocation.longitude,
              pickupLat,
              pickupLng
            );
            return { ...job, distanceToPickup };
          }
          return job;
        })
        .sort((a, b) => {
          const distA =
            typeof a.distanceToPickup === "number"
              ? a.distanceToPickup
              : a.estimatedDistance ?? Number.POSITIVE_INFINITY;
          const distB =
            typeof b.distanceToPickup === "number"
              ? b.distanceToPickup
              : b.estimatedDistance ?? Number.POSITIVE_INFINITY;
          return distA - distB;
        });
    },
    []
  );

  const refreshUpcomingJobs = useCallback(async (force = false) => {
    if (!shouldShowUpcomingJobs) {
      setUpcomingJobs([]);
      setUpcomingJobsLoading(false);
      setUpcomingJobsError(null);
      return;
    }

    const now = Date.now();
    if (!force && now - lastUpcomingRefreshRef.current < 5000) {
      return;
    }
    lastUpcomingRefreshRef.current = now;

    setUpcomingJobsLoading(true);
    setUpcomingJobsError(null);

    try {
      const jobs = await fetchUpcomingJobs({
        zoneId: currentZone?.id ?? null,
      });
      setUpcomingJobs(decorateUpcomingJobs(jobs));
    } catch (error: any) {
      const is401 = error?.response?.status === 401;
      console.error("Failed to load upcoming jobs:", {
        status: error?.response?.status,
        message: error?.response?.data?.message || error?.message,
        isAuth: is401,
      });
      
      if (is401) {
        console.warn("⚠️ 401 Unauthorized - Driver may need to login or token expired");
      }
      
      setUpcomingJobs([]);
      setUpcomingJobsError(
        error?.response?.data?.message ||
          error?.message ||
          "Unable to load nearby jobs"
      );
    } finally {
      setUpcomingJobsLoading(false);
    }
  }, [shouldShowUpcomingJobs, currentZone?.id, decorateUpcomingJobs]);

  useEffect(() => {
    setTimeTicker(Date.now());
    const interval = setInterval(() => {
      setTimeTicker(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeShift?.id, activeShift?.startTime]);

  // ✅ Refresh upcoming jobs when conditions change (zone, availability)
  useEffect(() => {
    if (!shouldShowUpcomingJobs) {
      setUpcomingJobs([]);
      setUpcomingJobsLoading(false);
      setUpcomingJobsError(null);
      return;
    }
    refreshUpcomingJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowUpcomingJobs, currentZone?.id]); // Only re-fetch when zone or availability changes

  // ✅ Auto-refresh upcoming jobs every 30 seconds
  useEffect(() => {
    if (!shouldShowUpcomingJobs) {
      return;
    }
    const interval = setInterval(() => {
      refreshUpcomingJobs();
    }, 30000);
    return () => clearInterval(interval);
  }, [shouldShowUpcomingJobs, refreshUpcomingJobs]);

  // Eligibility self-check — drives the home-screen badge. Hits
  // GET /api/mobile/driver/eligibility once on mount and every 45s.
  useEffect(() => {
    let cancelled = false;
    const fetchEligibility = async () => {
      try {
        const resp = await httpClient.get('/mobile/driver/eligibility');
        if (cancelled) return;
        const data = resp?.data?.data;
        if (data && typeof data === 'object') {
          setEligibility({
            verdict: data.verdict || (data.eligible ? 'ACCEPTING' : 'PARTIAL'),
            reasons: Array.isArray(data.reasons) ? data.reasons : [],
          });
        }
      } catch (_err) {
        // Network blip — keep last known verdict rather than flashing
        // "LOADING" repeatedly.
      }
    };
    fetchEligibility();
    const interval = setInterval(fetchEligibility, 45000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!location) {
      return;
    }
    setUpcomingJobs((prev) => {
      if (!prev.length) {
        return prev;
      }
      return decorateUpcomingJobs([...prev]);
    });
  }, [location?.latitude, location?.longitude, decorateUpcomingJobs]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !shouldShowUpcomingJobs) {
      return;
    }

    const handleNearbyJob = (jobPayload: any) => {
      try {
        const pickup = jobPayload?.pickup || {};
        const dropoff = jobPayload?.dropoff || {};
        let distanceToPickup =
          typeof jobPayload?.distanceToPickup === "number"
            ? jobPayload.distanceToPickup
            : null;

        const latestLocation = latestLocationRef.current;
        if (
          latestLocation?.latitude &&
          latestLocation?.longitude &&
          typeof pickup.latitude === "number" &&
          typeof pickup.longitude === "number"
        ) {
          distanceToPickup = calculateDistance(
            latestLocation.latitude,
            latestLocation.longitude,
            pickup.latitude,
            pickup.longitude
          );
        }

        const fallbackId =
          jobPayload?.id ||
          jobPayload?.jobId ||
          jobPayload?.internalJobId ||
          `job_${Date.now()}`;
        const resolvedId = String(fallbackId);
        const resolvedJobId = String(jobPayload?.jobId || resolvedId);

        const newJob: UpcomingJobSummary = {
          id: resolvedId,
          jobId: resolvedJobId,
          status: jobPayload?.status || "UNASSIGNED",
          pickup: {
            address: pickup.address ?? null,
            latitude: pickup.latitude ?? null,
            longitude: pickup.longitude ?? null,
          },
          dropoff: {
            address: dropoff.address ?? null,
            latitude: dropoff.latitude ?? null,
            longitude: dropoff.longitude ?? null,
          },
          scheduledAt: jobPayload?.scheduledAt || null,
          estimatedFare:
            jobPayload?.estimatedFare ?? jobPayload?.estimatedPrice ?? null,
          estimatedDistance:
            jobPayload?.estimatedDistance ??
            (typeof distanceToPickup === "number" ? distanceToPickup : null),
          estimatedDuration: jobPayload?.estimatedDuration ?? null,
          isLate: jobPayload?.isLate ?? false,
          minutesToPickup:
            typeof jobPayload?.minutesToPickup === "number"
              ? jobPayload.minutesToPickup
              : 0,
          customer: jobPayload?.customer ?? null,
          zone: jobPayload?.zone ?? null,
          distanceToPickup:
            typeof distanceToPickup === "number" ? distanceToPickup : undefined,
        };

        setUpcomingJobs((prev) => {
          const exists = prev.some(
            (job) =>
              job.id === newJob.id ||
              (newJob.jobId && job.jobId === newJob.jobId)
          );
          if (exists) {
            return prev;
          }
          return decorateUpcomingJobs([...prev, newJob]);
        });

        if (pickup?.address || typeof distanceToPickup === "number") {
          const formattedDistance = formatDistance(distanceToPickup || 0);
          Toast.show({
            type: "info",
            text1: "New Job Available",
            text2: `${formattedDistance} away - ${
              pickup.address || "Nearby pickup"
            }`,
          });
        }
      } catch (error) {
        console.error("Failed to process nearby job", error);
      }
    };

    socket.on("job:available:nearby", handleNearbyJob);
    return () => {
      socket.off("job:available:nearby", handleNearbyJob);
    };
  }, [shouldShowUpcomingJobs, decorateUpcomingJobs]);

  // Fetch map provider and location update interval
  useEffect(() => {
    const fetchCompanyConfig = async () => {
      if (!driver?.companyId) return;
      setMapProviderLoading(true);
      
      // ✅ FIX: Default interval for fallback scenarios
      const DEFAULT_INTERVAL = 5; // Reasonable default if API fails
      const MIN_INTERVAL = 1; // Minimum 1 second
      const MAX_INTERVAL = 60; // Maximum 60 seconds
      
      try {
        const response = await fetchCompanySettings(driver.companyId);
        const provider = normalizeMapProvider(response?.settings?.mapProvider || undefined);
        const rawInterval = response?.settings?.locationUpdateInterval || DEFAULT_INTERVAL;
        
        // ✅ FIX: Validate and clamp interval to safe range
        const clampedInterval = Math.max(MIN_INTERVAL, Math.min(rawInterval, MAX_INTERVAL));
        
        if (clampedInterval !== rawInterval) {
          console.warn(
            `⚠️ Invalid location interval ${rawInterval}s, clamped to ${clampedInterval}s (range: ${MIN_INTERVAL}-${MAX_INTERVAL}s)`
          );
          Toast.show({
            type: 'warning',
            text1: 'Location Interval Adjusted',
            text2: `Using ${clampedInterval}s (company setting was out of range)`,
          });
        }
        
        console.log(`🗺️ Company Settings: Provider=${provider}, Interval=${clampedInterval}s`);
        
        setMapProvider(provider);
        setLocationUpdateInterval(clampedInterval);
        jobProcessor.configure({ updateInterval: clampedInterval * 1000 });
        
        // Update native GPS service with the validated interval
        try {
          await updateLocationInterval(clampedInterval);
          console.log(`✅ Native GPS interval updated to ${clampedInterval}s`);
        } catch (nativeError) {
          console.error("Failed to update native GPS interval:", nativeError);
        }

        try {
          updateSocketIntervals(
            clampedInterval,
            response?.settings?.heartbeatInterval || undefined
          );
          console.log(
            `🔁 Socket throttle/heartbeat synced to company interval (${clampedInterval}s)`
          );
        } catch (socketIntervalError) {
          console.error(
            "Failed to update socket intervals:",
            socketIntervalError
          );
        }
        
        // ✅ Mark settings as loaded successfully
        setSettingsLoaded(true);
      } catch (error) {
        // ✅ FIX: Better fallback handling with user notification
        console.error("Failed to fetch company settings:", error);
        console.warn(`Using default interval: ${DEFAULT_INTERVAL}s`);
        
        Toast.show({
          type: 'warning',
          text1: 'Using Default Settings',
          text2: `Company settings unavailable, using ${DEFAULT_INTERVAL}s location interval`,
          visibilityTime: 4000,
        });
        
        setMapProvider("NATIVE");
        setLocationUpdateInterval(DEFAULT_INTERVAL);
        jobProcessor.configure({ updateInterval: DEFAULT_INTERVAL * 1000 });
        
        // Still try to update GPS and socket with default interval
        try {
          await updateLocationInterval(DEFAULT_INTERVAL);
          updateSocketIntervals(DEFAULT_INTERVAL, undefined);
        } catch (fallbackError) {
          console.error("Failed to apply default interval:", fallbackError);
        }
        
        // ✅ Mark settings as loaded even with fallback
        setSettingsLoaded(true);
      } finally {
        setMapProviderLoading(false);
      }
    };
    fetchCompanyConfig();
  }, [driver?.companyId]);

  useEffect(() => {
    if (!driver?.companyId) {
      return;
    }
    if (selectedTariff) {
      tariffRepairInFlight.current = false;
      return;
    }
    if (tariffRepairInFlight.current) {
      return;
    }

    tariffRepairInFlight.current = true;
    refreshTariffs(driver.companyId)
      .catch((error) => {
        console.warn("⚠️ Tariff auto-refresh from HomeScreen failed:", error);
      })
      .finally(() => {
        tariffRepairInFlight.current = false;
      });
  }, [driver?.companyId, refreshTariffs, selectedTariff]);

  useEffect(() => {
    if (!currentJob?.tariffId) {
      return;
    }
    if (selectedTariff?.id === currentJob.tariffId) {
      return;
    }
    const matchingTariff = tariffs.find((tariff) => tariff.id === currentJob.tariffId);
    if (!matchingTariff) {
      return;
    }

    selectTariff(matchingTariff).catch((error) => {
      console.warn("⚠️ Failed to sync tariff selection with active job:", error);
    });
  }, [currentJob?.tariffId, selectTariff, selectedTariff?.id, tariffs]);

  // Sync driver status
  const syncStatus = useCallback(
    async (status: DriverShiftStatus) => {
      // Prevent duplicate calls within 1 second
      const now = Date.now();
      if (!activeShift?.id || 
          lastSyncedStatus.current === status || 
          statusSyncPending.current ||
          (now - statusSyncTimestamp.current < 1000 && lastSyncedStatus.current === status)) {
        console.log(`⏭️ Skipping duplicate status sync: ${status}`);
        return;
      }
      
      statusSyncPending.current = true;
      statusSyncTimestamp.current = now;
      
      try {
        await updateDriverShiftStatus(status);
        lastSyncedStatus.current = status;
        console.log(`✅ Status synced: ${status}`);
      } catch (error) {
        console.error("Status sync failed:", error);
      } finally {
        statusSyncPending.current = false;
      }
    },
    [activeShift?.id]
  );

  useEffect(() => {
    if (driverStatus === "AVAILABLE") {
      syncStatus("AVAILABLE");
    } else if (driverStatus === "AWAY") {
      syncStatus("AWAY");
    } else if (driverStatus === "BUSY") {
      syncStatus("BUSY");
    }
  }, [driverStatus, syncStatus]);

  useEffect(() => {
    if (manualStatus === "AWAY" && !isBusy && activeShift?.id) {
      scheduleAwayReminder();
    } else {
      clearAwayReminder();
      setAwayReminderVisible(false);
    }
  }, [manualStatus, isBusy, activeShift?.id, scheduleAwayReminder, clearAwayReminder]);

  useEffect(() => {
    return () => {
      clearAwayReminder();
    };
  }, [clearAwayReminder]);

  useEffect(() => {
    console.log('🔍 [AUTO-NAV] useEffect triggered', {
      hasCurrentJob: !!currentJob,
      jobStatus,
      currentJobId: currentJob?.id,
      hasNavigatedRef: hasNavigatedRef.current,
    });

    if (!currentJob) {
      console.log('🔍 [AUTO-NAV] No currentJob, clearing ref');
      hasNavigatedRef.current = null;
      return;
    }

    const resolvedJobId = currentJob.id || currentJob.jobId || currentJob.publicJobId;
    if (!resolvedJobId) {
      console.log('🔍 [AUTO-NAV] No resolvedJobId, returning');
      return;
    }

    // ✅ FIX: Don't navigate if job is COMPLETED or CANCELLED - let it clear naturally
    if (jobStatus === "COMPLETED" || jobStatus === "CANCELLED") {
      console.log('Job completed/cancelled, clearing navigation ref');
      hasNavigatedRef.current = null;
      return;
    }

    if (["STARTED", "ACTIVE", "REACHED", "PENDING_PAYMENT"].includes(jobStatus)) {
      hasNavigatedRef.current = null;
    }

    const jobKey = `${resolvedJobId}_${jobStatus}`;
    console.log('🔍 [AUTO-NAV] jobKey:', jobKey, 'hasNavigatedRef:', hasNavigatedRef.current);
    
    if (hasNavigatedRef.current === jobKey) {
      console.log('🔍 [AUTO-NAV] Already navigated for this jobKey, skipping');
      return;
    }

    const navigateSafely = <T extends keyof AppStackParamList>(
      route: T,
      params?: AppStackParamList[T]
    ) => {
      console.log('🔍 [AUTO-NAV] Navigating to:', route);
      try {
        if (params) {
          navigation.navigate(route, params as AppStackParamList[T]);
        } else {
          navigation.navigate(route);
        }
        hasNavigatedRef.current = jobKey;
        console.log('🔍 [AUTO-NAV] Navigation successful, hasNavigatedRef set to:', jobKey);
      } catch (navError) {
        console.warn("Navigation failed, will retry:", navError);
        hasNavigatedRef.current = null;
      }
    };

    if (jobStatus === "INCOMING") {
      console.log('🔍 [AUTO-NAV] Status is INCOMING, navigating to JobOffer');
      navigateSafely("JobOffer", { job: currentJob as RideSummary });
      return;
    }

    if (["ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"].includes(jobStatus)) {
      navigateSafely("EnhancedJobTracking");
      return;
    }

    if (["STARTED", "ACTIVE", "REACHED"].includes(jobStatus)) {
      navigateSafely("ActiveRide");
      return;
    }

    if (jobStatus === "PAUSED") {
      navigateSafely("JobPaused");
      return;
    }

    if (jobStatus === "PENDING_PAYMENT") {
      const amount =
        Number(currentJob.earningsSoFar) ||
        Number(currentJob.finalAmount) ||
        Number(currentJob.estimatedFare) ||
        0;

      navigateSafely("PaymentCollection", {
        jobId: resolvedJobId,
        amount,
        customerId: currentJob.customer?.id ?? null,
        customerName:
          combineName(currentJob.customer?.firstName, currentJob.customer?.lastName) ||
          currentJob.passenger?.name ||
          undefined,
      });
    }
  }, [currentJob, jobStatus, navigation]);

  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => {
        if (!currentJob || !jobStatus) {
          return;
        }
        const resolvedJobId = currentJob.id || currentJob.jobId || currentJob.publicJobId;
        if (!resolvedJobId) {
          return;
        }
        const jobKey = `${resolvedJobId}_${jobStatus}`;
        if (hasNavigatedRef.current !== jobKey) {
          hasNavigatedRef.current = null;
        }
      }, 300);

      return () => clearTimeout(timer);
    }, [currentJob, jobStatus])
  );

  // Handlers
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refreshCurrentShift(),
      refreshRecentJobs(),
      refreshUpcomingJobs(true),
    ]);
    setRefreshing(false);
  }, [refreshCurrentShift, refreshRecentJobs, refreshUpcomingJobs]);

  const handleEndShift = useCallback(() => {
    Alert.alert(
      "End Shift",
      "Are you sure you want to end your shift?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End Shift",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await endShiftAction();
                // Navigate back to root - let app handle redirect to ShiftStart
                navigation.reset({
                  index: 0,
                  routes: [{ name: "Home" }],
                });
              } catch (error) {
                console.error("Failed to end shift:", error);
                Alert.alert("Error", "Failed to end shift");
              }
            })();
          },
        },
      ]
    );
  }, [endShiftAction, navigation]);

  const handleLogout = useCallback(() => {
    Alert.alert(
      "Logout",
      "Are you sure you want to logout?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Logout",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                await logout();
                // Navigation will be handled by auth context
              } catch (error) {
                console.error("Failed to logout:", error);
                Alert.alert("Error", "Failed to logout");
              }
            })();
          },
        },
      ]
    );
  }, [logout]);

  const clearAwayReminder = useCallback(() => {
    if (awayReminderTimerRef.current) {
      clearTimeout(awayReminderTimerRef.current);
      awayReminderTimerRef.current = null;
    }
  }, []);

  const scheduleAwayReminder = useCallback(() => {
    clearAwayReminder();
    awayReminderTimerRef.current = setTimeout(() => {
      setAwayReminderVisible(true);
    }, 15000);
  }, [clearAwayReminder]);

  const handleStatusChange = useCallback((newStatus: DriverAvailability) => {
    if (newStatus !== "BUSY") {
      setManualStatus(newStatus);
    }
  }, []);

  const handleAwayReminderConfirm = useCallback(() => {
    setManualStatus("AVAILABLE");
    setAwayReminderVisible(false);
    clearAwayReminder();
    Toast.show({
      type: "success",
      text1: "Back Online",
      text2: "You will start receiving jobs again.",
    });
  }, [clearAwayReminder]);

  const handleAwayReminderSnooze = useCallback(() => {
    setAwayReminderVisible(false);
    scheduleAwayReminder();
  }, [scheduleAwayReminder]);

  const handleClaimUpcomingJob = useCallback(
    async (jobId: string) => {
      console.log('🎯 [CLAIM] handleClaimUpcomingJob called with jobId:', jobId);
      
      if (!jobId || claimingJobId) {
        console.log('🎯 [CLAIM] Aborting - no jobId or already claiming');
        return;
      }

      setClaimingJobId(jobId);
      try {
        console.log('🎯 [CLAIM] Calling API claimUpcomingJob...');
        const result = await claimUpcomingJob(jobId);
        console.log('🎯 [CLAIM] API result:', result);
        const payload = result?.job ?? result;

        if (!payload) {
          throw new Error("No job payload returned by server");
        }

        const pickup = payload.pickup || {};
        const dropoff = payload.dropoff || {};
        const resolvedId =
          payload.internalJobId ||
          payload.legacyJobId ||
          payload.id ||
          payload.jobId ||
          jobId;

        console.log('🎯 [CLAIM] Calling setIncomingJob with resolvedId:', resolvedId);
        
        setIncomingJob({
          id: String(resolvedId),
          internalJobId: payload.internalJobId ?? null,
          legacyJobId: payload.legacyJobId ?? null,
          publicJobId: payload.jobId ?? null,
          jobId: payload.jobId ?? resolvedId,
          status: "INCOMING",
          createdAt: payload.createdAt || new Date().toISOString(),
          pickupAddress:
            payload.pickupAddress || pickup.address || "Pickup location pending",
          pickupLatitude: payload.pickupLatitude ?? pickup.latitude ?? null,
          pickupLongitude: payload.pickupLongitude ?? pickup.longitude ?? null,
          dropoffAddress: payload.dropoffAddress || dropoff.address || undefined,
          dropoffLatitude: payload.dropoffLatitude ?? dropoff.latitude ?? null,
          dropoffLongitude: payload.dropoffLongitude ?? dropoff.longitude ?? null,
          estimatedFare:
            payload.estimatedPrice ??
            payload.estimatedFare ??
            payload.fare ??
            null,
          actualFare: payload.fare ?? null,
          distance: payload.distance ?? payload.estimatedDistance ?? null,
          estimatedDuration: payload.estimatedDuration ?? null,
          vehicleType: payload.vehicleType ?? null,
          passenger: payload.customer
            ? {
                id: payload.customer.id ?? null,
                name:
                  combineName(
                    payload.customer.firstName,
                    payload.customer.lastName
                  ) ||
                  payload.customer.firstName ||
                  "Passenger",
                phone: payload.customer.phone || "",
              }
            : currentJob?.passenger || {
                id: null,
                name: "Passenger",
                phone: "",
              },
          expiresAt: payload.expiresAt || null,
          countdownMs: payload.expiresAt
            ? Math.max(0, new Date(payload.expiresAt).getTime() - Date.now())
            : undefined,
          assignmentId: payload.assignmentId || null,
          offerId: payload.offerId || null,
          tariffName: payload.tariff?.name || currentJob?.tariffName || null,
          tariff: payload.tariff || undefined,
          customer: payload.customer ?? undefined,
        });

        console.log('🎯 [CLAIM] setIncomingJob called successfully');

        // ✅ FIX: Navigate immediately after setting incoming job
        // The useEffect auto-navigation sometimes doesn't trigger due to React batching
        const jobForNavigation = {
          id: String(resolvedId),
          internalJobId: payload.internalJobId ?? null,
          legacyJobId: payload.legacyJobId ?? null,
          publicJobId: payload.jobId ?? null,
          jobId: payload.jobId ?? resolvedId,
          status: "INCOMING" as const,
          pickupAddress: payload.pickupAddress || pickup.address || "Pickup location pending",
          pickupLatitude: payload.pickupLatitude ?? pickup.latitude ?? null,
          pickupLongitude: payload.pickupLongitude ?? pickup.longitude ?? null,
          dropoffAddress: payload.dropoffAddress || dropoff.address || undefined,
          dropoffLatitude: payload.dropoffLatitude ?? dropoff.latitude ?? null,
          dropoffLongitude: payload.dropoffLongitude ?? dropoff.longitude ?? null,
          estimatedFare: payload.estimatedPrice ?? payload.estimatedFare ?? payload.fare ?? null,
          passenger: payload.customer
            ? {
                id: payload.customer.id ?? null,
                name: combineName(payload.customer.firstName, payload.customer.lastName) || payload.customer.firstName || "Passenger",
                phone: payload.customer.phone || "",
              }
            : { id: null, name: "Passenger", phone: "" },
          expiresAt: payload.expiresAt || null,
          countdownMs: payload.expiresAt ? Math.max(0, new Date(payload.expiresAt).getTime() - Date.now()) : undefined,
          customer: payload.customer ?? undefined,
        };
        
        console.log('🎯 [CLAIM] Navigating to JobOffer screen...');
        navigation.navigate("JobOffer", { job: jobForNavigation as RideSummary });

        Toast.show({
          type: "success",
          text1: "Job claimed",
          text2: "Opening job details...",
        });
      } catch (error: any) {
        console.error("Failed to claim job:", error);
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Unable to claim job.";
        Toast.show({
          type: "error",
          text1: "Job claim failed",
          text2: message,
        });
      } finally {
        setClaimingJobId(null);
        refreshUpcomingJobs(true);
      }
    },
    [claimingJobId, currentJob?.passenger, currentJob?.tariffName, navigation, refreshUpcomingJobs, setIncomingJob]
  );

  const handleViewOnGoingJobs = useCallback(() => {
    if (!currentJob) {
      return;
    }

    const resolvedJobId = currentJob.id || currentJob.jobId || currentJob.publicJobId;
    const status = jobStatus || currentJob.status;

    // ✅ FIX: Don't navigate if job is COMPLETED or CANCELLED
    if (status === "COMPLETED" || status === "CANCELLED") {
      console.log('Job is completed/cancelled, not navigating');
      return;
    }

    if (status === "INCOMING") {
      navigation.navigate("JobOffer", { job: currentJob as RideSummary });
      return;
    }

    if (["ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"].includes(status || "")) {
      navigation.navigate("EnhancedJobTracking");
      return;
    }

    if (status === "PAUSED") {
      navigation.navigate("JobPaused");
      return;
    }

    if (status === "PENDING_PAYMENT" && resolvedJobId) {
      const amount =
        Number(currentJob.earningsSoFar) ||
        Number(currentJob.finalAmount) ||
        Number(currentJob.estimatedFare) ||
        0;

      navigation.navigate("PaymentCollection", {
        jobId: resolvedJobId,
        amount,
        customerId: currentJob.customer?.id ?? null,
        customerName:
          combineName(currentJob.customer?.firstName, currentJob.customer?.lastName) ||
          currentJob.passenger?.name ||
          undefined,
      });
      return;
    }

    // Only navigate to ActiveRide for active statuses
    if (["STARTED", "ACTIVE", "REACHED"].includes(status || "")) {
      navigation.navigate("ActiveRide");
    }
  }, [currentJob, jobStatus, navigation]);

  const handleViewAcceptedJobs = useCallback(() => {
    if (!currentJob) {
      Toast.show({
        type: "info",
        text1: "No accepted job",
        text2: "Accept a job first to view its details.",
      });
      return;
    }

    const normalizedStatus = (jobStatus || currentJob.status || "").toUpperCase();

    if (normalizedStatus === "INCOMING") {
      navigation.navigate("JobOffer", { job: currentJob as RideSummary });
      return;
    }

    if (["ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "ARRIVED_READY"].includes(normalizedStatus)) {
      navigation.navigate("EnhancedJobTracking");
      return;
    }

    // If driver already made progress, fall back to the on-going handler
    if (["PAUSED", "STARTED", "ACTIVE", "IN_PROGRESS", "REACHED", "PENDING_PAYMENT"].includes(normalizedStatus)) {
      handleViewOnGoingJobs();
      return;
    }

    Toast.show({
      type: "info",
      text1: "No accepted job",
      text2: "Once you accept a job, tap here to resume.",
    });
  }, [currentJob, jobStatus, navigation, handleViewOnGoingJobs]);

  const handleWalkInSlideComplete = useCallback(() => {
    if (!activeShift) {
      Alert.alert("No Active Shift", "Start your shift before creating a walk-in job.");
      resetWalkInSlider();
      return;
    }

    if (isBusy || currentJob) {
      Alert.alert("Already Busy", "Finish your current job before starting a walk-in job.");
      resetWalkInSlider();
      return;
    }

    if (!selectedTariff) {
      // Auto-select first tariff if available
      if (tariffs.length > 0) {
        const defaultTariff = tariffs.find((t) => t.isDefault) || tariffs[0];
        selectTariff(defaultTariff).catch(console.warn);
        // Continue with walk-in - tariff will be set
      } else {
        Alert.alert("No Tariff Available", "No tariffs loaded. Pull to refresh.");
        resetWalkInSlider();
        return;
      }
    }

    setWalkInConfirmVisible(true);
  }, [activeShift, isBusy, currentJob, selectedTariff, navigation, selectedVehicle?.id, resetWalkInSlider]);

  const closeWalkInConfirm = useCallback(() => {
    setWalkInConfirmVisible(false);
    resetWalkInSlider();
  }, [resetWalkInSlider]);

  const handleChangeTariffFromConfirm = useCallback(() => {
    // Open the same picker modal used elsewhere so the driver can see and
    // pick from the full tariff list. (The old auto-cycle silently no-op'd
    // when the driver had only one tariff assigned, which read as "button
    // broken".)
    setTariffPickerVisible(true);
  }, []);

  const proceedWithWalkInCreation = useCallback(async (effectiveLocation: typeof location | null) => {
    setCreatingWalkInJob(true);
    try {
      const requestBody = walkInDropoff
        ? {
            dropoff: {
              address: walkInDropoff.address,
              latitude: walkInDropoff.latitude,
              longitude: walkInDropoff.longitude,
              placeId: walkInDropoff.placeId,
              source: walkInDropoff.source,
            },
          }
        : {};

      const response = await httpClient.post("/mobile/driver/jobs/walk-in/create", requestBody);
      const payload = response?.data ?? response;
      const { success, job: walkInJob } = payload || {};

      if (!success || !walkInJob) {
        throw new Error("Invalid response from walk-in job API");
      }

      // Use effective location with fallback to job location or default
      const pickupLat = walkInJob.pickupLocation?.latitude ?? effectiveLocation?.latitude ?? 0;
      const pickupLng = walkInJob.pickupLocation?.longitude ?? effectiveLocation?.longitude ?? 0;

      startWalkInJob({
        id: walkInJob.id,
        status: "STARTED",
        pickupAddress: walkInJob.pickupLocation?.address || "Current Location",
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
        dropoffAddress: walkInJob.dropoffLocation?.address || "Destination - To be set",
        dropoffLatitude: walkInJob.dropoffLocation?.latitude ?? null,
        dropoffLongitude: walkInJob.dropoffLocation?.longitude ?? null,
        estimatedFare: walkInJob.estimatedFare || 0,
        createdAt: walkInJob.createdAt,
        // Walk-in = guest hail, no registered passenger. Downstream screens
        // (PaymentCollectionScreen, RatePassenger, completion toast) read
        // `isWalkIn` to skip customer-only flows like rating and receipt email.
        isWalkIn: true,
        customer: null,
        passenger: {
          id: null,
          name: "Walk-in passenger",
          phone: "",
        },
      } as any);

      if (walkInDropoff) {
        setLastWalkInDropoff(walkInDropoff);
      }
      setWalkInDropoff(null);
      closeWalkInConfirm();
      Toast.show({
        type: "success",
        text1: "Walk-in job started",
        text2: "Meter is now running.",
        visibilityTime: 2500,
      });

      setTimeout(() => {
        try {
          navigation.navigate("ActiveRide" as never);
        } catch (navError) {
          console.warn("Failed to navigate to ActiveRide:", navError);
        }
      }, 300);
    } catch (error: any) {
      console.error("❌ Failed to create walk-in job:", error);
      const message =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Please try again.";
      Alert.alert("Job Creation Failed", message);
    } finally {
      setCreatingWalkInJob(false);
    }
  }, [startWalkInJob, closeWalkInConfirm, navigation, walkInDropoff]);

  const startWalkInWithDropoffCheck = useCallback(
    async (resolvedLocation: typeof location | null) => {
      if (!walkInDropoff) {
        Alert.alert(
          "Add drop-off?",
          "Navigation apps need a destination. You can still start now and add one later.",
          [
            {
              text: "Set Drop-off",
              onPress: openWalkInDropoffPicker,
            },
            {
              text: "Start Without Drop-off",
              style: "destructive",
              onPress: () => {
                proceedWithWalkInCreation(resolvedLocation).catch((error) => {
                  console.error("Failed to start walk-in without drop-off:", error);
                });
              },
            },
          ]
        );
        return;
      }

      await proceedWithWalkInCreation(resolvedLocation);
    },
    [walkInDropoff, openWalkInDropoffPicker, proceedWithWalkInCreation]
  );

  const handleConfirmWalkInJob = useCallback(async () => {
    if (!activeShift) {
      Alert.alert("No Active Shift", "Start your shift before creating a walk-in job.");
      return;
    }

    if (!selectedTariff) {
      // Auto-select tariff if available
      if (tariffs.length > 0) {
        const defaultTariff = tariffs.find((t: any) => t.isDefault) || tariffs[0];
        await selectTariff(defaultTariff);
      } else {
        Alert.alert("No Tariff Available", "No tariffs loaded. Pull to refresh.");
        return;
      }
    }

    if (isBusy || currentJob) {
      Alert.alert("Already Busy", "Finish your current job before starting a walk-in job.");
      return;
    }

    // ✅ Use current location or last known location for walk-in jobs
    const effectiveLocation = location || latestLocationRef.current;
    
    if (!effectiveLocation) {
      // ⚠️ Show warning but allow with default coordinates if no location at all
      Alert.alert(
        "Limited GPS", 
        "GPS signal is weak. Walk-in job will start with approximate location. Location will update automatically when GPS improves.",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Continue Anyway", 
            onPress: () => {
              startWalkInWithDropoffCheck(null);
            }
          }
        ]
      );
      return;
    }

    // Proceed with available location
    await startWalkInWithDropoffCheck(effectiveLocation);
  }, [activeShift, selectedTariff, isBusy, currentJob, location, startWalkInWithDropoffCheck]);

  const shiftSnapshot = useMemo(() => {
    if (!activeShift) {
      return {
        durationSeconds: 0,
        durationLabel: "0s",
        totalEarnings: 0,
        totalRides: 0,
      };
    }

    const baseSeconds =
      typeof activeShift.duration === "number" && Number.isFinite(activeShift.duration)
        ? Math.max(activeShift.duration, 0) * 60
        : 0;

    let elapsedSeconds = baseSeconds;
    if (activeShift.startTime) {
      const startTimestamp = new Date(activeShift.startTime).getTime();
      if (!Number.isNaN(startTimestamp)) {
        elapsedSeconds = Math.max(
          baseSeconds,
          Math.max(Math.floor((timeTicker - startTimestamp) / 1000), 0)
        );
      }
    }

    return {
      durationSeconds: elapsedSeconds,
      durationLabel: formatShiftDuration(elapsedSeconds),
      totalEarnings: activeShift.stats?.totalEarnings ?? 0,
      totalRides: activeShift.stats?.totalRides ?? 0,
    };
  }, [activeShift, timeTicker]);

  const financialSnapshot = useMemo(() => {
    const extractEarnings = (job: RecentJobSummary): number => {
      const candidate =
        job.fare?.driverEarnings ??
        job.fare?.total ??
        job.payment?.driverEarnings ??
        job.payment?.amount ??
        0;
      return typeof candidate === "number" && Number.isFinite(candidate)
        ? candidate
        : 0;
    };

    const recentEarnings = recentJobs
      .slice(0, 5)
      .reduce((sum, job) => sum + extractEarnings(job), 0);

    const cashOnHand = recentJobs.reduce((sum, job) => {
      const method = job.paymentMethod?.toUpperCase();
      if (method === "CASH" || method === "CASH_COLLECTION") {
        return sum + extractEarnings(job);
      }
      return sum;
    }, 0);

    return {
      recentEarnings,
      cashOnHand,
    };
  }, [recentJobs]);

  // ✅ Compute real today's stats from recentJobs + shift data
  const todayStats = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todaysJobs = recentJobs.filter((job) => {
      const completedDate = job.completedAt ? new Date(job.completedAt) : null;
      return completedDate && completedDate >= todayStart;
    });

    const todayEarnings = todaysJobs.reduce((sum, job) => {
      const earnings =
        job.fare?.driverEarnings ??
        job.fare?.total ??
        job.payment?.driverEarnings ??
        job.payment?.amount ??
        0;
      return sum + (typeof earnings === "number" && Number.isFinite(earnings) ? earnings : 0);
    }, 0);

    return {
      jobs: todaysJobs.length,
      earnings: todayEarnings + (shiftSnapshot.totalEarnings || 0),
    };
  }, [recentJobs, shiftSnapshot.totalEarnings]);

  // ✅ Driver rating (from auth context or API)
  const driverRating = useMemo(() => {
    const rating = (driver as any)?.rating ?? (driver as any)?.averageRating ?? null;
    if (typeof rating === "number" && Number.isFinite(rating) && rating > 0) {
      return rating;
    }
    return null;
  }, [driver]);

  const totalRatings = useMemo(() => {
    return (driver as any)?.totalRatings ?? (driver as any)?.ratingCount ?? 0;
  }, [driver]);

  const drawerStatusMeta = useMemo(() => {
    // ✅ Show "Offline" when there's no active shift
    if (!activeShift?.id) {
      return { label: "Offline", color: "#6b7280" }; // Gray color for offline
    }
    
    switch (driverStatus) {
      case "AWAY":
        return { label: "Away", color: "#f97316" };
      case "BUSY":
        return { label: "Busy", color: "#38bdf8" };
      case "AVAILABLE":
      default:
        return { label: "Online", color: "#4ade80" };
    }
  }, [driverStatus, activeShift?.id]);

  const drawerMenuItems = useMemo(
    () => [
      {
        // Real-time chat with the company dispatcher. Kept at the top of
        // the drawer so it's one tap away — dispatcher comms is a frequent
        // driver action (address clarifications, break requests, etc.).
        key: "dispatcherChat",
        icon: "headset",
        label: "Dispatcher Chat",
        description: "Message your dispatcher in real time — routing, breaks, issues.",
        route: "DispatcherChat",
      },
      {
        key: "wallet",
        icon: "wallet",
        label: "Wallet & Earnings",
        description: "Cash, card, EPOS totals, balances owed, and payouts.",
        route: "Wallet",
      },
      {
        key: "jobHistory",
        icon: "history",
        label: "Job History",
        description: "View all completed, cancelled, and no-show trips.",
        route: "JobHistory",
      },
      {
        key: "documents",
        icon: "file-document-outline",
        label: "Documents",
        description: "License, insurance, vehicle registration + expiry status.",
        route: "Documents",
      },
      {
        key: "profile",
        icon: "account-circle-outline",
        label: "Profile",
        description: "Your account info, fleet assignment, and logout.",
        route: "Profile",
      },
      {
        // "Recent Earnings" = sum of your LAST 5 completed rides (quick glance
        // at how the last handful of jobs went). Tap-through opens Wallet
        // where the full period breakdown is shown.
        key: "recentEarnings",
        icon: "chart-line",
        label: "Recent Earnings",
        description: "Total from your last 5 completed trips. Tap to open Wallet.",
        value: formatCurrency(financialSnapshot.recentEarnings),
        route: "Wallet",
      },
      {
        // "Cash In Hand" = sum of cash payments you've collected that are
        // still waiting to be reconciled with the company at settlement time.
        key: "cashOnHand",
        icon: "hand-coin-outline",
        label: "Cash In Hand",
        description: "Cash payments you collected that still owe the company.",
        value: formatCurrency(financialSnapshot.cashOnHand),
        route: "Wallet",
      },
      {
        key: "operations",
        icon: "earth",
        label: "Operating Principles",
        description: "Fleet policies — safety, metering, documents, service.",
        route: "OperatingPrinciples",
      },
    ],
    [financialSnapshot.cashOnHand, financialSnapshot.recentEarnings]
  );

  const walkInSliderDisabled = useMemo(
    () => !activeShift || isBusy || creatingWalkInJob || walkInConfirmVisible,
    [activeShift, isBusy, creatingWalkInJob, walkInConfirmVisible]
  );

  const canConfirmWalkIn = useMemo(
    () => Boolean(selectedTariff && location && activeShift && !isBusy && !currentJob && !creatingWalkInJob),
    [selectedTariff, location, activeShift, isBusy, currentJob, creatingWalkInJob]
  );

  const locationSummary = useMemo(() => {
    if (!location) {
      return "No GPS fix";
    }
    const lat = Number.isFinite(location.latitude) ? location.latitude.toFixed(5) : "N/A";
    const lng = Number.isFinite(location.longitude) ? location.longitude.toFixed(5) : "N/A";
    return `${lat}, ${lng}`;
  }, [location]);

  const locationAccuracyText = useMemo(() => {
    if (!location || location.accuracy == null) {
      return null;
    }
    if (!Number.isFinite(location.accuracy)) {
      return null;
    }
    return `${Math.round(location.accuracy)} m accuracy`;
  }, [location]);

  const drawerTranslateX = useMemo(
    () =>
      drawerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [-320, 0],
      }),
    [drawerAnim]
  );

  const drawerOverlayOpacity = useMemo(
    () =>
      drawerAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 0.5],
      }),
    [drawerAnim]
  );

  const normalizedCurrentJobStatus = (jobStatus || currentJob?.status || "").toUpperCase();
  const hasAcceptedJob = Boolean(
    currentJob &&
      ["ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED", "ARRIVED_READY"].includes(
        normalizedCurrentJobStatus
      )
  );
  const hasOnGoingJob = Boolean(
    currentJob &&
      ["STARTED", "ACTIVE", "IN_PROGRESS", "REACHED", "PENDING_PAYMENT", "PAUSED"].includes(
        normalizedCurrentJobStatus
      )
  );

  const acceptedJobsCount = hasAcceptedJob ? 1 : 0;
  const onGoingJobsCount = hasOnGoingJob ? 1 : 0;

  // Strict safe area — top inset honours the status bar / notch in
  // full, bottom inset clears the system gesture / nav bar. The
  // previous `(insets.top - 12)` was deliberately bleeding 12 px
  // under the status bar; the SafeAreaView from
  // react-native-safe-area-context handles all four edges natively.
  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.safeArea}>
      {/* Keep screen awake while driver is on shift */}
      <KeepAwake />
      <View style={styles.container}>
        {activeShift ? (
          <>
            <DashboardHeader
          driverName={driver?.firstName && driver?.lastName ? `${driver.firstName} ${driver.lastName}` : driver?.firstName || driver?.lastName || "Driver"}
          companyName={driver?.company?.name || undefined}
          driverStatus={driverStatus}
          zoneName={currentZone?.name}
          zoneLoading={zoneLoading}
          zoneError={zoneError}
          driverRating={driverRating}
          totalRatings={totalRatings}
          vehicleInfo={selectedVehicle ? `${selectedVehicle.licensePlate || ''} ${selectedVehicle.make || ''} ${selectedVehicle.model || ''}`.trim() || null : null}
          onPressStatus={() => setStatusModalVisible(true)}
          onEndShift={handleEndShift}
          onRetryZone={retryZoneDetection}
          onOpenMenu={openDrawer}
          onOpenDispatcherChat={() => navigation.navigate("DispatcherChat" as never)}
        />

        {/* Permission banner — only renders while overlay / battery
            optimisation grants are still missing. Self-clears once the
            user toggles them in settings. */}
        <OverlayPermissionBanner />

        {/* Out-of-zone alert banner */}
        {isOutOfZone && !isBusy && (
          <OutOfZoneBanner
            zoneName={lastKnownZoneName}
            onDismiss={dismissOutOfZone}
          />
        )}

        {/* ─── Eligibility badge ───────────────────────────────────────────
            One-line verdict on whether the driver would receive a job offer
            RIGHT NOW, plus a tap-to-expand list of blocking reasons. This
            replaces the "why am I not getting jobs?" mystery with concrete
            actionable copy ("start a shift", "license expired", etc).
            Hidden while the out-of-zone banner is up — that banner already
            states the specific blocker, so showing both just stacks alerts. */}
        {eligibility.verdict !== 'LOADING' && !(isOutOfZone && !isBusy) && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              if (eligibility.reasons.length === 0) return;
              Alert.alert(
                eligibility.verdict === 'ACCEPTING'
                  ? "You're accepting jobs"
                  : 'Why you may not be getting offers',
                eligibility.reasons.length > 0
                  ? eligibility.reasons.map((r, i) => `${i + 1}. ${r}`).join('\n')
                  : "You're fully set up — offers will arrive here as soon as a passenger books.",
                [{ text: 'OK' }],
              );
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginHorizontal: 14,
              marginVertical: 6,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 12,
              backgroundColor:
                eligibility.verdict === 'ACCEPTING' ? 'rgba(34,197,94,0.12)'
                : eligibility.verdict === 'OFF_SHIFT' ? 'rgba(148,163,184,0.14)'
                : eligibility.verdict === 'INELIGIBLE' ? 'rgba(239,68,68,0.14)'
                : 'rgba(234,179,8,0.14)', // PARTIAL
              borderWidth: 1,
              borderColor:
                eligibility.verdict === 'ACCEPTING' ? 'rgba(34,197,94,0.3)'
                : eligibility.verdict === 'OFF_SHIFT' ? 'rgba(148,163,184,0.3)'
                : eligibility.verdict === 'INELIGIBLE' ? 'rgba(239,68,68,0.3)'
                : 'rgba(234,179,8,0.3)',
            }}>
            <MCIcon
              name={
                eligibility.verdict === 'ACCEPTING' ? 'check-circle'
                : eligibility.verdict === 'OFF_SHIFT' ? 'power-standby'
                : eligibility.verdict === 'INELIGIBLE' ? 'alert-circle'
                : 'alert-octagon'
              }
              size={18}
              color={
                eligibility.verdict === 'ACCEPTING' ? '#22c55e'
                : eligibility.verdict === 'OFF_SHIFT' ? '#94a3b8'
                : eligibility.verdict === 'INELIGIBLE' ? '#ef4444'
                : '#eab308'
              }
            />
            <Text style={{
              flex: 1,
              marginLeft: 8,
              color: '#e5e7eb',
              fontSize: 13,
              fontWeight: '500',
            }}>
              {eligibility.verdict === 'ACCEPTING'
                ? 'Accepting jobs — you\'re in the offer pool'
                : eligibility.verdict === 'OFF_SHIFT'
                  ? 'Off shift — start a shift to receive offers'
                  : eligibility.verdict === 'INELIGIBLE'
                    ? `Blocked — tap for details${eligibility.reasons.length > 0 ? ` (${eligibility.reasons.length})` : ''}`
                    : `Partially eligible — tap for ${eligibility.reasons.length} reason${eligibility.reasons.length === 1 ? '' : 's'}`}
            </Text>
            {eligibility.reasons.length > 0 ? (
              <MCIcon name="chevron-right" size={18} color="#94a3b8" />
            ) : null}
          </TouchableOpacity>
        )}

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
          showsVerticalScrollIndicator={false}
        >
          {/* ✅ Greeting Banner with today's quick stats */}
          <GreetingBanner
            driverName={driver?.firstName && driver?.lastName ? `${driver.firstName} ${driver.lastName}` : driver?.firstName || "Driver"}
            totalEarnings={todayStats.earnings}
            totalTrips={todayStats.jobs + shiftSnapshot.totalRides}
            onlineMinutes={Math.floor(shiftSnapshot.durationSeconds / 60)}
            formatCurrency={formatCurrency}
          />

          {/* ✅ Earnings Goal Progress */}
          <EarningsGoalCard
            currentEarnings={todayStats.earnings}
            dailyGoal={150}
            formatCurrency={formatCurrency}
          />

          {/* Tariff (compact) */}
          <TariffCard
            tariffName={selectedTariff?.name}
            baseFare={selectedTariff?.baseFare}
            perKm={selectedTariff?.perKmRate}
            perMinute={selectedTariff?.perMinuteRate}
            onPress={() => setTariffPickerVisible(true)}
            formatCurrency={formatCurrency}
          />

          {/* Active / Accepted job cards */}
          <JobStatusCards
            acceptedJobsCount={acceptedJobsCount}
            onGoingJobsCount={onGoingJobsCount}
            onViewAcceptedJobs={handleViewAcceptedJobs}
            onViewOnGoingJobs={handleViewOnGoingJobs}
            activeJobPreview={activeJobPreview}
          />

          {/* Available jobs to claim */}
          <UpcomingJobsSection
            jobs={upcomingJobsCards}
            loading={upcomingJobsLoading}
            errorMessage={upcomingJobsError}
            claimingJobId={claimingJobId}
            onClaimJob={handleClaimUpcomingJob}
            onRefresh={() => refreshUpcomingJobs(true)}
            formatCurrency={formatCurrency}
          />

          {/* ✅ Map (collapsible - moved below priority content) */}
          {mapExpanded && (
            <LocationMap
              location={location}
              mapProvider={mapProvider}
              mapProviderLoading={mapProviderLoading}
              zoneCoordinates={currentZone?.coordinates}
              vehicle={selectedVehicle}
              locationUpdateInterval={locationUpdateInterval}
            />
          )}

        </ScrollView>

        {/* 🚨 Emergency SOS now lives inside DashboardHeader next to the
             settings icon (see DashboardHeader.tsx topRow). Placed there so
             it's always visible and thumb-reachable without blocking any
             screen content. */}

        <StatusModal
          visible={statusModalVisible}
          currentStatus={driverStatus}
          onSelect={handleStatusChange}
          onClose={() => setStatusModalVisible(false)}
        />
        <WalkInSlider
          disabled={walkInSliderDisabled}
          loading={creatingWalkInJob}
          onComplete={handleWalkInSlideComplete}
          resetTrigger={walkInSliderResetKey}
          bottomInset={insets.bottom}
        />
        <Modal
          transparent
          animationType="fade"
          visible={walkInConfirmVisible}
          onRequestClose={closeWalkInConfirm}
        >
          <View style={styles.walkInConfirmOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeWalkInConfirm} />
            <View style={styles.walkInConfirmCard}>
              <View style={styles.walkInConfirmHeader}>
                <MCIcon name="walk" size={18} color="#10b981" />
                <Text style={styles.walkInConfirmTitle}>Start Walk-In Job</Text>
              </View>
              <View style={styles.walkInConfirmSection}>
                <Text style={styles.walkInConfirmLabel}>Tariff</Text>
                <Text style={styles.walkInConfirmValue}>
                  {selectedTariff ? selectedTariff.name : "No tariff selected"}
                </Text>
              </View>
              <View style={styles.walkInConfirmSection}>
                <Text style={styles.walkInConfirmLabel}>Current Location</Text>
                <Text
                  style={[
                    styles.walkInConfirmValue,
                    !location && styles.walkInConfirmWarning,
                  ]}
                >
                  {locationSummary}
                </Text>
                {locationAccuracyText ? (
                  <Text style={styles.walkInConfirmHint}>{locationAccuracyText}</Text>
                ) : null}
              </View>
              <View style={styles.walkInConfirmSection}>
                <Text style={styles.walkInConfirmLabel}>Drop-off</Text>
                <View style={styles.walkInDropoffRow}>
                  <View style={styles.walkInDropoffInfo}>
                    <Text
                      style={[
                        styles.walkInConfirmValue,
                        !walkInDropoff && styles.walkInConfirmWarning,
                      ]}
                      numberOfLines={2}
                    >
                      {walkInDropoff?.address || "Not set"}
                    </Text>
                    {walkInDropoff ? (
                      <Text style={styles.walkInConfirmHint}>
                        {walkInDropoff.latitude.toFixed(5)}, {walkInDropoff.longitude.toFixed(5)}
                      </Text>
                    ) : (
                      <Text style={styles.walkInConfirmHint}>
                        Destination ensures navigation shortcuts work.
                      </Text>
                    )}
                    {!walkInDropoff && lastWalkInDropoff ? (
                      <TouchableOpacity
                        style={styles.walkInDropoffReuseButton}
                        onPress={handleUseLastWalkInDropoff}
                        activeOpacity={0.85}
                      >
                        <MCIcon name="history" size={14} color="#94a3b8" />
                        <Text style={styles.walkInDropoffReuseText}>Use last drop-off</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <TouchableOpacity
                    style={styles.walkInDropoffButton}
                    onPress={openWalkInDropoffPicker}
                    activeOpacity={0.85}
                  >
                    <MCIcon
                      name={walkInDropoff ? "map-marker-check" : "map-marker-plus"}
                      size={16}
                      color="#fff"
                    />
                    <Text style={styles.walkInDropoffButtonText}>
                      {walkInDropoff ? "Change" : "Set"}
                    </Text>
                  </TouchableOpacity>
                </View>
                {walkInDropoff ? (
                  <TouchableOpacity
                    style={styles.walkInDropoffClear}
                    onPress={handleClearWalkInDropoff}
                    activeOpacity={0.85}
                  >
                    <MCIcon name="close-circle" size={14} color="#f87171" />
                    <Text style={styles.walkInDropoffClearText}>Clear drop-off</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.walkInConfirmHint}>
                Confirm your location and tariff before starting the job. You can adjust the tariff if needed.
              </Text>
              <View style={styles.walkInConfirmActions}>
                <TouchableOpacity
                  style={styles.walkInConfirmButton}
                  onPress={handleChangeTariffFromConfirm}
                  activeOpacity={0.85}
                >
                  <MCIcon name="credit-card-sync" size={16} color="#8d95ad" />
                  <Text style={styles.walkInConfirmButtonTextSecondary}>Change Tariff</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.walkInConfirmButtonPrimary,
                    (!canConfirmWalkIn || creatingWalkInJob) && styles.walkInConfirmButtonDisabled,
                  ]}
                  onPress={handleConfirmWalkInJob}
                  disabled={!canConfirmWalkIn || creatingWalkInJob}
                  activeOpacity={0.85}
                >
                  {creatingWalkInJob ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MCIcon name="hand-back-right" size={18} color="#fff" />
                      <Text style={styles.walkInConfirmButtonText}>Start Walk-In</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        <WalkInDropoffPicker
          visible={walkInDropoffPickerVisible}
          initialValue={walkInDropoff}
          fallbackCoordinate={location || latestLocationRef.current || null}
          mapProvider={mapProvider}
          mapProviderLoading={mapProviderLoading}
          onClose={closeWalkInDropoffPicker}
          onConfirm={handleWalkInDropoffSelected}
        />
        <Modal
          transparent
          animationType="fade"
          visible={awayReminderVisible}
          onRequestClose={handleAwayReminderSnooze}
        >
          <View style={styles.awayReminderOverlay}>
            <View style={styles.awayReminderCard}>
              <MCIcon name="alarm" size={32} color="#fbbf24" />
              <Text style={styles.awayReminderTitle}>Are you available?</Text>
              <Text style={styles.awayReminderSubtitle}>
                You're still marked as away. Let dispatch know if you're ready to receive jobs.
              </Text>
              <View style={styles.awayReminderActions}>
                <TouchableOpacity
                  style={styles.awayReminderSecondary}
                  onPress={handleAwayReminderSnooze}
                  activeOpacity={0.85}
                >
                  <Text style={styles.awayReminderSecondaryText}>Still away</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.awayReminderPrimary}
                  onPress={handleAwayReminderConfirm}
                  activeOpacity={0.9}
                >
                  <Text style={styles.awayReminderPrimaryText}>I'm available</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
          </>
        ) : (
          // Show message when no active shift
          <View style={styles.noShiftContainer}>
            <DashboardHeader
              driverName={driver?.firstName && driver?.lastName ? `${driver.firstName} ${driver.lastName}` : driver?.firstName || driver?.lastName || "Driver"}
              companyName={driver?.company?.name || undefined}
              driverStatus="AVAILABLE"
              zoneName={currentZone?.name}
              zoneLoading={zoneLoading}
              zoneError={zoneError}
              onPressStatus={() => {}}
              onEndShift={handleLogout}
              onRetryZone={retryZoneDetection}
              onOpenMenu={openDrawer}
              showLogoutButton={true}
            />
            <View style={styles.noShiftMessage}>
              <MCIcon name="car-off" size={64} color="#8d95ad" />
              <Text style={styles.noShiftTitle}>No Active Shift</Text>
              <Text style={styles.noShiftSubtitle}>
                Start a shift to begin accepting jobs
              </Text>
              <TouchableOpacity
                style={styles.startShiftButton}
                onPress={() => {
                  navigation.navigate("TariffSelection", {
                    vehicleId: selectedVehicle?.id || "",
                    mode: "start",
                  });
                }}
              >
                <MCIcon name="play-circle" size={24} color="#fff" />
                <Text style={styles.startShiftButtonText}>Start Shift</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
      <Modal
        transparent
        visible={drawerVisible}
        animationType="none"
        onRequestClose={closeDrawer}
      >
        <View style={styles.drawerWrapper}>
          <Animated.View
            pointerEvents="none"
            style={[styles.drawerOverlay, { opacity: drawerOverlayOpacity }]}
          />
          <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
          <Animated.View
            style={[
              styles.drawerContainer,
              { transform: [{ translateX: drawerTranslateX }] },
            ]}
          >
            <View style={styles.drawerHeader}>
              <View style={styles.drawerAvatar}>
                <MCIcon name="account-circle" size={52} color="#f5b400" />
              </View>
              <View style={styles.drawerHeaderText}>
                <Text style={styles.drawerDriverName} numberOfLines={1}>
                  {driver?.firstName && driver?.lastName
                    ? `${driver.firstName} ${driver.lastName}`
                    : driver?.firstName || driver?.lastName || "Driver"}
                </Text>
                <View style={styles.drawerStatusRow}>
                  <View
                    style={[
                      styles.drawerStatusDot,
                      { backgroundColor: drawerStatusMeta.color },
                    ]}
                  />
                  <Text
                    style={[
                      styles.drawerStatusLabel,
                      { color: drawerStatusMeta.color },
                    ]}
                  >
                    {drawerStatusMeta.label}
                  </Text>
                </View>
                <Text style={styles.drawerCompany} numberOfLines={1}>
                  {driver?.company?.name || "Fleet"}
                </Text>
              </View>
            </View>

            <View style={styles.drawerStatsRow}>
              <View style={styles.drawerStatCard}>
                <Text
                  style={styles.drawerStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                >
                  {formatCurrency(shiftSnapshot.totalEarnings)}
                </Text>
                <Text style={styles.drawerStatLabel}>Shift Earnings</Text>
              </View>
              <View style={styles.drawerStatCard}>
                <Text
                  style={styles.drawerStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                >
                  {shiftSnapshot.totalRides}
                </Text>
                <Text style={styles.drawerStatLabel}>Trips Completed</Text>
              </View>
              <View style={styles.drawerStatCard}>
                <Text
                  style={styles.drawerStatValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.55}
                >
                  {shiftSnapshot.durationLabel}
                </Text>
                <Text style={styles.drawerStatLabel}>Time On Shift</Text>
              </View>
            </View>

            <View style={styles.drawerMenuList}>
              {drawerMenuItems.map((item) => (
                <TouchableOpacity
                  key={item.key}
                  style={styles.drawerMenuItem}
                  activeOpacity={0.85}
                  onPress={() => {
                    closeDrawer();
                    if ((item as any).route) {
                      setTimeout(() => {
                        navigation.navigate((item as any).route as any);
                      }, 250);
                    }
                  }}
                >
                  <View style={styles.drawerMenuIcon}>
                    <MCIcon name={item.icon as any} size={22} color="#f5b400" />
                  </View>
                  <View style={styles.drawerMenuContent}>
                    <View style={styles.drawerMenuHeader}>
                      <Text style={styles.drawerMenuLabel}>{item.label}</Text>
                      {item.value ? (
                        <Text style={styles.drawerMenuValue}>
                          {item.value}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.drawerMenuDescription}>
                      {item.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.drawerFooterCta}
              onPress={closeDrawer}
              activeOpacity={0.85}
            >
              <MCIcon name="chevron-left" size={20} color="#ffffff" />
              <Text style={styles.drawerFooterText}>Close menu</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

      {/* Tariff Picker Modal */}
      <Modal
        transparent
        visible={tariffPickerVisible}
        animationType="slide"
        onRequestClose={() => setTariffPickerVisible(false)}
      >
        <View style={styles.tariffPickerOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTariffPickerVisible(false)} />
          <View style={styles.tariffPickerSheet}>
            <View style={styles.tariffPickerHeader}>
              <Text style={styles.tariffPickerTitle}>Change Tariff</Text>
              <TouchableOpacity onPress={() => setTariffPickerVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <MCIcon name="close" size={24} color="#ffffff" />
              </TouchableOpacity>
            </View>
            {selectedTariff && (
              <Text style={styles.tariffPickerCurrentLabel}>
                Current: {selectedTariff.name}
              </Text>
            )}
            <ScrollView style={styles.tariffPickerList} showsVerticalScrollIndicator={false}>
              {tariffs.map((tariff) => {
                const isCurrent = selectedTariff?.id === tariff.id;
                return (
                  <TouchableOpacity
                    key={tariff.id}
                    style={[styles.tariffPickerCard, isCurrent && styles.tariffPickerCardCurrent]}
                    activeOpacity={0.85}
                    onPress={() => {
                      selectTariff(tariff).catch(console.warn);
                      setTariffPickerVisible(false);
                      Toast.show({ type: "success", text1: "Tariff Changed", text2: tariff.name });
                    }}
                  >
                    <View style={styles.tariffPickerCardHeader}>
                      <Text style={[styles.tariffPickerCardName, isCurrent && styles.tariffPickerCardNameCurrent]}>
                        {tariff.name}
                      </Text>
                      {isCurrent && (
                        <View style={styles.tariffPickerCurrentBadge}>
                          <Text style={styles.tariffPickerCurrentBadgeText}>CURRENT</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.tariffPickerRateRow}>
                      <View>
                        <Text style={styles.tariffPickerRateLabel}>Base Fare:</Text>
                        <Text style={styles.tariffPickerRateValue}>${tariff.baseFare?.toFixed(2) ?? '0.00'}</Text>
                      </View>
                      <View>
                        <Text style={styles.tariffPickerRateLabel}>Per KM:</Text>
                        <Text style={styles.tariffPickerRateValue}>${tariff.perKmRate?.toFixed(2) ?? '0.00'}</Text>
                      </View>
                      <View>
                        <Text style={styles.tariffPickerRateLabel}>Per Min:</Text>
                        <Text style={styles.tariffPickerRateValue}>${tariff.perMinuteRate?.toFixed(2) ?? '0.00'}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity
              style={styles.tariffPickerCancelBtn}
              onPress={() => setTariffPickerVisible(false)}
            >
              <Text style={styles.tariffPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

interface WalkInSliderProps {
  disabled: boolean;
  loading: boolean;
  onComplete: () => void;
  resetTrigger: number;
  bottomInset?: number;
}

const WalkInSlider: React.FC<WalkInSliderProps> = ({
  disabled,
  loading,
  onComplete,
  resetTrigger,
  bottomInset = 0,
}) => {
  const THUMB_SIZE = 44;
  const SIDE_MARGIN = 4;
  const translateX = useRef(new Animated.Value(0)).current;
  const wiggleAnim = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [resetTrigger, translateX, wiggleAnim]);

  useEffect(() => {
    if (disabled || loading) {
      wiggleAnim.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wiggleAnim, {
          toValue: 1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(wiggleAnim, {
          toValue: -1,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(wiggleAnim, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.delay(800),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [disabled, loading, wiggleAnim]);

  const maxTranslate = Math.max(trackWidth - THUMB_SIZE - SIDE_MARGIN, 0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled && !loading,
        onMoveShouldSetPanResponder: () => !disabled && !loading,
        onPanResponderGrant: () => {
          translateX.stopAnimation();
        },
        onPanResponderMove: (_, gestureState) => {
          if (disabled || loading) {
            return;
          }
          const nextValue = Math.min(
            Math.max(0, gestureState.dx),
            maxTranslate
          );
          translateX.setValue(nextValue);
        },
        onPanResponderRelease: () => {
          translateX.stopAnimation((value) => {
            if (disabled || loading) {
              Animated.timing(translateX, {
                toValue: 0,
                duration: 180,
                useNativeDriver: false,
              }).start();
              return;
            }

            if (value >= maxTranslate * 0.85) {
              Animated.timing(translateX, {
                toValue: maxTranslate,
                duration: 150,
                useNativeDriver: false,
              }).start(() => {
                onComplete();
              });
            } else {
              Animated.spring(translateX, {
                toValue: 0,
                useNativeDriver: false,
                stiffness: 160,
                damping: 18,
              }).start();
            }
          });
        },
      }),
    [disabled, loading, maxTranslate, translateX, onComplete]
  );

  return (
    <View
      pointerEvents={disabled ? "none" : "auto"}
      style={[
        styles.walkInSliderContainer,
        { bottom: 24 + bottomInset },
        disabled && !loading ? styles.walkInSliderDisabled : null,
      ]}
    >
      <View style={styles.walkInSliderWrapper}>
        <View
          style={styles.walkInSliderTrack}
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        >
          <Text style={styles.walkInSliderText}>
            {loading ? "Starting…" : "Slide to start walk-in job"}
          </Text>
          <Animated.View
            style={[
              styles.walkInSliderThumb,
              {
                transform: [
                  {
                    translateX: translateX,
                  },
                ],
              },
            ]}
            {...panResponder.panHandlers}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: wiggleAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: ["-10deg", "10deg"],
                      }),
                    },
                    {
                      translateY: wiggleAnim.interpolate({
                        inputRange: [-1, 1],
                        outputRange: [1, -1],
                      }),
                    },
                  ],
                }}
              >
                <MCIcon name="hand-back-right" size={20} color="#ff4d67" />
              </Animated.View>
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0f111a",
  },
  container: {
    flex: 1,
    backgroundColor: "#0f111a",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },
  metricsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 6,
  },
  noShiftContainer: {
    flex: 1,
  },
  noShiftMessage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  noShiftTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
    marginTop: 20,
    marginBottom: 8,
  },
  noShiftSubtitle: {
    fontSize: 16,
    color: "#8d95ad",
    marginBottom: 32,
    textAlign: "center",
  },
  startShiftButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f5b400",
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  startShiftButtonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  drawerWrapper: {
    flex: 1,
  },
  drawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f111a",
  },
  drawerContainer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 320,
    backgroundColor: "#161a26",
    paddingTop: Platform.OS === "ios" ? 52 : 32,
    paddingHorizontal: 20,
    paddingBottom: 24,
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 16,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  drawerAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#1f2535",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },
  drawerHeaderText: {
    flex: 1,
  },
  drawerDriverName: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  drawerStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  drawerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  drawerStatusLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  drawerCompany: {
    color: "#9aa4c1",
    fontSize: 12,
    marginTop: 4,
  },
  drawerStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
  },
  drawerStatCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: "#1f2535",
  },
  drawerStatValue: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  drawerStatLabel: {
    color: "#9aa4c1",
    fontSize: 12,
    fontWeight: "500",
  },
  drawerMenuList: {
    flex: 1,
  },
  drawerMenuItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#242b3d",
  },
  drawerMenuIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(245, 180, 0, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  drawerMenuContent: {
    flex: 1,
  },
  drawerMenuHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 12,
  },
  drawerMenuLabel: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  drawerMenuValue: {
    color: "#4ade80",
    fontSize: 13,
    fontWeight: "600",
  },
  drawerMenuDescription: {
    color: "#9aa4c1",
    fontSize: 12,
    lineHeight: 16,
  },
  drawerFooterCta: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#1f2535",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    gap: 6,
  },
  drawerFooterText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  walkInSliderContainer: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
  },
  walkInSliderWrapper: {
    backgroundColor: "rgba(26, 29, 41, 0.92)",
    borderRadius: 28,
    padding: 8,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  walkInSliderTrack: {
    height: 48,
    borderRadius: 24,
    backgroundColor: "#242838",
    justifyContent: "center",
    overflow: "hidden",
  },
  walkInSliderText: {
    position: "absolute",
    width: "100%",
    textAlign: "center",
    color: "#8d95ad",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  walkInSliderThumb: {
    position: "absolute",
    top: 2,
    left: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#10b981",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  walkInSliderDisabled: {
    opacity: 0.4,
  },
  walkInConfirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,17,26,0.78)",
    justifyContent: "flex-end",
    padding: 16,
  },
  walkInConfirmCard: {
    backgroundColor: "#1a1d29",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  walkInConfirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  walkInConfirmTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  walkInConfirmSection: {
    marginBottom: 12,
    gap: 4,
  },
  walkInConfirmLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8d95ad",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  walkInConfirmValue: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  walkInConfirmWarning: {
    color: "#f97316",
  },
  walkInConfirmHint: {
    fontSize: 12,
    color: "#8d95ad",
    marginBottom: 12,
  },
  walkInDropoffRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 6,
  },
  walkInDropoffInfo: {
    flex: 1,
  },
  walkInDropoffButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#10b981",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  walkInDropoffButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  walkInDropoffClear: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  walkInDropoffClearText: {
    color: "#f87171",
    fontSize: 12,
    fontWeight: "600",
  },
  walkInDropoffReuseButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  walkInDropoffReuseText: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  walkInConfirmActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  walkInConfirmButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#242838",
  },
  walkInConfirmButtonTextSecondary: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "600",
  },
  walkInConfirmButtonPrimary: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#10b981",
  },
  walkInConfirmButtonDisabled: {
    backgroundColor: "#1f2a2f",
    opacity: 0.6,
  },
  walkInConfirmButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  awayReminderOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  awayReminderCard: {
    width: "100%",
    backgroundColor: "#1a1d29",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    alignItems: "center",
    gap: 12,
  },
  awayReminderTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  awayReminderSubtitle: {
    fontSize: 13,
    color: "#9aa4c1",
    textAlign: "center",
    lineHeight: 18,
  },
  awayReminderActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 4,
  },
  awayReminderSecondary: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#374151",
    paddingVertical: 10,
    alignItems: "center",
  },
  awayReminderSecondaryText: {
    color: "#9aa4c1",
    fontWeight: "600",
  },
  awayReminderPrimary: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#22c55e",
    paddingVertical: 10,
    alignItems: "center",
  },
  awayReminderPrimaryText: {
    color: "#0f111a",
    fontWeight: "700",
  },
  // Tariff Picker Modal
  tariffPickerOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  tariffPickerSheet: {
    backgroundColor: "#14161f",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
    maxHeight: "80%",
  },
  tariffPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tariffPickerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
  },
  tariffPickerCurrentLabel: {
    fontSize: 13,
    color: "#8d95ad",
    marginBottom: 16,
  },
  tariffPickerList: {
    marginBottom: 12,
  },
  tariffPickerCard: {
    backgroundColor: "#1a1d29",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: "#2a2f3f",
  },
  tariffPickerCardCurrent: {
    borderColor: "#f5b400",
    backgroundColor: "rgba(99, 102, 241, 0.08)",
  },
  tariffPickerCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  tariffPickerCardName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    flex: 1,
  },
  tariffPickerCardNameCurrent: {
    color: "#f5b400",
  },
  tariffPickerCurrentBadge: {
    backgroundColor: "rgba(99, 102, 241, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#f5b400",
  },
  tariffPickerCurrentBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#f5b400",
  },
  tariffPickerRateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tariffPickerRateLabel: {
    fontSize: 11,
    color: "#8d95ad",
    marginBottom: 2,
  },
  tariffPickerRateValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f5b400",
  },
  tariffPickerCancelBtn: {
    backgroundColor: "#2a2f3f",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  tariffPickerCancelText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
});

export default HomeScreen;
