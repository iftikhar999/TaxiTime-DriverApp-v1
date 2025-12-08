import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, Modal, PanResponder, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
import httpClient from "../../services/httpClient";
import { getSocket, updateSocketIntervals } from "../../services/driverSocket";
import { calculateDistance, formatDistance } from "../../utils/distance";
import {
  DashboardHeader,
  DashboardMetric,
  JobStatusCards,
  LocationMap,
  RideHistorySection,
  StatusModal,
  TariffCard,
  TodayStatsSection,
  UpcomingJobsSection,
} from "./components";
import { formatCurrency, formatDuration, formatShiftDuration, normalizeMapProvider } from "./utils/homeScreenUtils";
import { getWaitingRatePerMinute } from "../../utils/tariffUtils";
import { RideSummary } from "../../types/rides";

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
    activeShift,
    rideHistory,
    refreshCurrentShift,
    refreshRideHistory,
    endShift: endShiftAction,
  } = useShift();
  const { status: jobStatus, currentJob, startWalkInJob, timer, pricingBreakdown, setIncomingJob } = useJob();
  const { location } = useLocation();
  const { currentZone, loading: zoneLoading, error: zoneError, forceRefresh: retryZoneDetection } = useZone();
  const latestLocationRef = useRef(location);
  useEffect(() => {
    latestLocationRef.current = location;
  }, [location]);
  
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList, "Home">>();
  
  const [mapProvider, setMapProvider] = useState<MapProvider>("NATIVE");
  const [mapProviderLoading, setMapProviderLoading] = useState(false);
  const [locationUpdateInterval, setLocationUpdateInterval] = useState<number>(2); // Default 2 seconds
  const [manualStatus, setManualStatus] = useState<Exclude<DriverAvailability, "BUSY">>("AVAILABLE");
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [todayStats] = useState({ jobs: 0, earnings: 0 });
  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJobSummary[]>([]);
  const [upcomingJobsLoading, setUpcomingJobsLoading] = useState(false);
  const [upcomingJobsError, setUpcomingJobsError] = useState<string | null>(null);
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);
  const [walkInConfirmVisible, setWalkInConfirmVisible] = useState(false);
  const [walkInSliderResetKey, setWalkInSliderResetKey] = useState(0);
  const [creatingWalkInJob, setCreatingWalkInJob] = useState(false);
  const [awayReminderVisible, setAwayReminderVisible] = useState(false);

  const [drawerVisible, setDrawerVisible] = useState(false);
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [timeTicker, setTimeTicker] = useState(Date.now());
  const awayReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasNavigatedRef = useRef<string | null>(null);

  const lastSyncedStatus = useRef<DriverShiftStatus | null>(null);
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
    () => (isBusy ? "BUSY" : manualStatus),
    [isBusy, manualStatus]
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

  const refreshUpcomingJobs = useCallback(async () => {
    if (!shouldShowUpcomingJobs) {
      setUpcomingJobs([]);
      setUpcomingJobsLoading(false);
      setUpcomingJobsError(null);
      return;
    }

    setUpcomingJobsLoading(true);
    setUpcomingJobsError(null);

    try {
      const jobs = await fetchUpcomingJobs({
        zoneId: currentZone?.id ?? null,
      });
      setUpcomingJobs(decorateUpcomingJobs(jobs));
    } catch (error: any) {
      console.error("Failed to load upcoming jobs:", error);
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

  useEffect(() => {
    refreshUpcomingJobs();
  }, [refreshUpcomingJobs]);

  useEffect(() => {
    if (!shouldShowUpcomingJobs) {
      return;
    }
    const interval = setInterval(() => {
      refreshUpcomingJobs();
    }, 30000);
    return () => clearInterval(interval);
  }, [shouldShowUpcomingJobs, refreshUpcomingJobs]);

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
      try {
        const response = await fetchCompanySettings(driver.companyId);
        const provider = normalizeMapProvider(response?.settings?.mapProvider || undefined);
        const interval = response?.settings?.locationUpdateInterval || 2;
        
        console.log(`🗺️ Company Settings: Provider=${provider}, Interval=${interval}s`);
        
        setMapProvider(provider);
        setLocationUpdateInterval(interval);
        
        // Update native GPS service with the interval
        try {
          await updateLocationInterval(interval);
          console.log(`✅ Native GPS interval updated to ${interval}s`);
        } catch (nativeError) {
          console.error("Failed to update native GPS interval:", nativeError);
        }

        try {
          updateSocketIntervals(
            interval,
            response?.settings?.heartbeatInterval || undefined
          );
          console.log(
            `🔁 Socket throttle/heartbeat synced to company interval (${interval}s)`
          );
        } catch (socketIntervalError) {
          console.error(
            "Failed to update socket intervals:",
            socketIntervalError
          );
        }
      } catch (error) {
        console.error("Failed to fetch company settings:", error);
        setMapProvider("NATIVE");
        setLocationUpdateInterval(2);
      } finally {
        setMapProviderLoading(false);
      }
    };
    fetchCompanyConfig();
  }, [driver?.companyId]);

  // Sync driver status
  const syncStatus = useCallback(
    async (status: DriverShiftStatus) => {
      if (!activeShift?.id || lastSyncedStatus.current === status) return;
      try {
        await updateDriverShiftStatus(status);
        lastSyncedStatus.current = status;
      } catch (error) {
        console.error("Status sync failed:", error);
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
    if (!currentJob) {
      hasNavigatedRef.current = null;
      return;
    }

    const resolvedJobId = currentJob.id || currentJob.jobId || currentJob.publicJobId;
    if (!resolvedJobId) {
      return;
    }

    if (["STARTED", "ACTIVE", "REACHED", "PENDING_PAYMENT"].includes(jobStatus)) {
      hasNavigatedRef.current = null;
    }

    const jobKey = `${resolvedJobId}_${jobStatus}`;
    if (hasNavigatedRef.current === jobKey) {
      return;
    }

    const navigateSafely = <T extends keyof AppStackParamList>(
      route: T,
      params?: AppStackParamList[T]
    ) => {
      try {
        if (params) {
          navigation.navigate(route, params as AppStackParamList[T]);
        } else {
          navigation.navigate(route);
        }
        hasNavigatedRef.current = jobKey;
      } catch (navError) {
        console.warn("Navigation failed, will retry:", navError);
        hasNavigatedRef.current = null;
      }
    };

    if (jobStatus === "INCOMING") {
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
      refreshRideHistory(),
      refreshUpcomingJobs(),
    ]);
    setRefreshing(false);
  }, [refreshCurrentShift, refreshRideHistory, refreshUpcomingJobs]);

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
      if (!jobId || claimingJobId) {
        return;
      }

      setClaimingJobId(jobId);
      try {
        const result = await claimUpcomingJob(jobId);
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
        refreshUpcomingJobs();
      }
    },
    [claimingJobId, currentJob?.passenger, currentJob?.tariffName, refreshUpcomingJobs, setIncomingJob]
  );

  const handleViewOnGoingJobs = useCallback(() => {
    if (!currentJob) {
      return;
    }

    const resolvedJobId = currentJob.id || currentJob.jobId || currentJob.publicJobId;
    const status = jobStatus || currentJob.status;

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

    navigation.navigate("ActiveRide");
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
      setWalkInSliderResetKey((key) => key + 1);
      return;
    }

    if (isBusy || currentJob) {
      Alert.alert("Already Busy", "Finish your current job before starting a walk-in job.");
      setWalkInSliderResetKey((key) => key + 1);
      return;
    }

    if (!selectedTariff) {
      Alert.alert(
        "Select Tariff",
        "Choose a tariff before starting a walk-in job.",
        [
          {
            text: "Choose Tariff",
            onPress: () => {
              navigation.navigate("TariffSelection", {
                vehicleId: selectedVehicle?.id || "",
                mode: "change",
              });
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
      setWalkInSliderResetKey((key) => key + 1);
      return;
    }

    setWalkInConfirmVisible(true);
  }, [activeShift, isBusy, currentJob, selectedTariff, navigation, selectedVehicle?.id]);

  const closeWalkInConfirm = useCallback(() => {
    setWalkInConfirmVisible(false);
    setWalkInSliderResetKey((key) => key + 1);
  }, []);

  const handleChangeTariffFromConfirm = useCallback(() => {
    closeWalkInConfirm();
    navigation.navigate("TariffSelection", {
      vehicleId: selectedVehicle?.id || "",
      mode: selectedVehicle?.id ? "change" : "start",
    });
  }, [closeWalkInConfirm, navigation, selectedVehicle?.id]);

  const handleConfirmWalkInJob = useCallback(async () => {
    if (!activeShift) {
      Alert.alert("No Active Shift", "Start your shift before creating a walk-in job.");
      return;
    }

    if (!selectedTariff) {
      Alert.alert("Select Tariff", "Choose a tariff before starting a walk-in job.");
      return;
    }

    if (isBusy || currentJob) {
      Alert.alert("Already Busy", "Finish your current job before starting a walk-in job.");
      return;
    }

    if (!location) {
      Alert.alert("Location Not Ready", "Waiting for GPS fix. Ensure location services are enabled and try again.");
      return;
    }

    setCreatingWalkInJob(true);
    try {
      const response = await httpClient.post("/mobile/driver/jobs/walk-in/create");
      const payload = response?.data ?? response;
      const { success, job: walkInJob } = payload || {};

      if (!success || !walkInJob) {
        throw new Error("Invalid response from walk-in job API");
      }

      startWalkInJob({
        id: walkInJob.id,
        status: "STARTED",
        pickupAddress: walkInJob.pickupLocation?.address || "Current Location",
        pickupLatitude: walkInJob.pickupLocation?.latitude ?? location.latitude,
        pickupLongitude: walkInJob.pickupLocation?.longitude ?? location.longitude,
        dropoffAddress: walkInJob.dropoffLocation?.address || "Destination - To be set",
        dropoffLatitude: walkInJob.dropoffLocation?.latitude ?? null,
        dropoffLongitude: walkInJob.dropoffLocation?.longitude ?? null,
        estimatedFare: walkInJob.estimatedFare || 0,
        createdAt: walkInJob.createdAt,
        customer: null,
        passenger: {
          id: null,
          name: "",
          phone: "",
        },
      });

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
  }, [
    activeShift,
    selectedTariff,
    isBusy,
    currentJob,
    location,
    startWalkInJob,
    closeWalkInConfirm,
    navigation,
  ]);

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
    const extractEarnings = (ride: typeof rideHistory[number]): number => {
      const paymentAmount =
        ride.payment?.driverEarnings ??
        ride.payment?.amount ??
        ride.fare?.driverEarnings ??
        ride.actualFare ??
        ride.estimatedFare ??
        0;
      return typeof paymentAmount === "number" && Number.isFinite(paymentAmount)
        ? paymentAmount
        : 0;
    };

    const recentEarnings = rideHistory.slice(0, 5).reduce((sum, ride) => sum + extractEarnings(ride), 0);
    const cashOnHand = rideHistory.reduce((sum, ride) => {
      const method = ride.payment?.method?.toUpperCase();
      if (method === "CASH" || method === "CASH_COLLECTION") {
        return sum + extractEarnings(ride);
      }
      return sum;
    }, 0);

    return {
      recentEarnings,
      cashOnHand,
    };
  }, [rideHistory]);

  const drawerStatusMeta = useMemo(() => {
    switch (driverStatus) {
      case "AWAY":
        return { label: "Away", color: "#f97316" };
      case "BUSY":
        return { label: "Busy", color: "#38bdf8" };
      case "AVAILABLE":
      default:
        return { label: "Online", color: "#4ade80" };
    }
  }, [driverStatus]);

  const drawerMenuItems = useMemo(
    () => [
      {
        key: "profiles",
        icon: "account-switch",
        label: "Driver Profiles",
        description: "Switch between saved fleet identities and preferences.",
      },
      {
        key: "wallet",
        icon: "wallet",
        label: "Wallet Management",
        description: "Track balances, payouts, and transfer requests.",
      },
      {
        key: "recentEarnings",
        icon: "chart-line",
        label: "Recent Earnings",
        description: "Last five completed rides credited to you.",
        value: formatCurrency(financialSnapshot.recentEarnings),
      },
      {
        key: "cashOnHand",
        icon: "hand-coin-outline",
        label: "Cash In Hand",
        description: "Cash collections to remit back to the company.",
        value: formatCurrency(financialSnapshot.cashOnHand),
      },
      {
        key: "operations",
        icon: "earth",
        label: "Operating Principles",
        description: "Guidelines aligned with the platform’s service nature.",
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

  return (
    <SafeAreaView style={[styles.safeArea, { paddingTop: Math.max((insets.top || 0) - 12, 0) }]}>
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
          onPressStatus={() => setStatusModalVisible(true)}
          onEndShift={handleEndShift}
          onRetryZone={retryZoneDetection}
          onOpenMenu={openDrawer}
        />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
          showsVerticalScrollIndicator={false}
        >
          <TariffCard
          
          tariffName={selectedTariff?.name}
          baseFare={selectedTariff?.baseFare}
          perKm={selectedTariff?.perKmRate}
          perMinute={selectedTariff?.perMinuteRate}
          onPress={() => {
            if (selectedVehicle?.id) {
              navigation.navigate("TariffSelection", {
                vehicleId: selectedVehicle.id,
                mode: "change",
              });
            }
          }}
          formatCurrency={formatCurrency}
        />

                <LocationMap
          location={location}
          mapProvider={mapProvider}
          mapProviderLoading={mapProviderLoading}
          zoneCoordinates={currentZone?.coordinates}
          vehicle={selectedVehicle}
          locationUpdateInterval={locationUpdateInterval}
        />

        <View style={styles.metricsRow}>
          <DashboardMetric icon="cash" label="Earned" value={formatCurrency(shiftSnapshot.totalEarnings)} color="#f5b400" />
          <DashboardMetric icon="car" label="Trips" value={shiftSnapshot.totalRides.toString()} color="#4ade80" />
          <DashboardMetric icon="clock-outline" label="Time" value={shiftSnapshot.durationLabel} color="#38bdf8" />
        </View>

        <TodayStatsSection totalJobs={todayStats.jobs} totalEarnings={todayStats.earnings} formatCurrency={formatCurrency} />

        <JobStatusCards
          acceptedJobsCount={acceptedJobsCount}
          onGoingJobsCount={onGoingJobsCount}
          onViewAcceptedJobs={handleViewAcceptedJobs}
          onViewOnGoingJobs={handleViewOnGoingJobs}
          activeJobPreview={activeJobPreview}
        />

        <UpcomingJobsSection
          jobs={upcomingJobsCards}
          loading={upcomingJobsLoading}
          errorMessage={upcomingJobsError}
          claimingJobId={claimingJobId}
          onClaimJob={handleClaimUpcomingJob}
          onRefresh={refreshUpcomingJobs}
          formatCurrency={formatCurrency}
        />

        <RideHistorySection
          rides={rideHistory}
          onViewAll={() => {
            // Navigate to ride history screen when implemented
            console.log("View all ride history");
          }}
          formatCurrency={formatCurrency}
          formatDuration={(seconds) => formatDuration(seconds / 60)}
        />
        </ScrollView>

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
                <Text style={styles.drawerStatValue}>
                  {formatCurrency(shiftSnapshot.totalEarnings)}
                </Text>
                <Text style={styles.drawerStatLabel}>Shift Earnings</Text>
              </View>
              <View style={styles.drawerStatCard}>
                <Text style={styles.drawerStatValue}>
                  {shiftSnapshot.totalRides}
                </Text>
                <Text style={styles.drawerStatLabel}>Trips Completed</Text>
              </View>
              <View style={styles.drawerStatCard}>
                <Text style={styles.drawerStatValue}>
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
                    console.log(`Menu item selected: ${item.key}`);
                    closeDrawer();
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
    </SafeAreaView>
  );
};

interface WalkInSliderProps {
  disabled: boolean;
  loading: boolean;
  onComplete: () => void;
  resetTrigger: number;
}

const WalkInSlider: React.FC<WalkInSliderProps> = ({
  disabled,
  loading,
  onComplete,
  resetTrigger,
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
    marginBottom: 12,
    gap: 10,
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
});

export default HomeScreen;
