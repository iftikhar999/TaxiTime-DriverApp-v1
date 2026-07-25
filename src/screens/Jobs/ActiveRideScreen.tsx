/**
 * 🚕 ACTIVE RIDE SCREEN - ROBUST JOB TRACKING
 * 
 * Professional taxi meter screen for tracking active rides.
 * 
 * Features:
 * - Large, real-time fare meter
 * - Live distance, time, speed tracking
 * - 3D map with driver position
 * - Pause/Resume functionality
 * - Professional driver-focused UI
 * - Real-time pricing breakdown
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated,
    AppState,
    AppStateStatus,
    Dimensions,
    Modal,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// @ts-ignore - No type definitions available
import KeepAwake from 'react-native-keep-awake';
import RideMap from '../../components/RideMap';
import NearbyJobsQueue from '../../components/jobs/NearbyJobsQueue';
import { useAuth } from '../../context/AuthContext';
import { formatCurrency } from '../../config/currency';
import { useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { useShift } from '../../context/ShiftContext';
import { useUnreadDispatcher } from '../../context/UnreadDispatcherContext';
import { calculateDistance } from '../../utils/distance';
import { fetchCompanySettings, MapProvider } from '../../services/companySettingsService';
import httpClient from '../../services/httpClient';
import { getActiveJob } from '../../services/v2/jobService';
import { ensureConnected, emitAppStateChange } from '../../services/driverSocket';
import { openExternalNavigation } from '../../utils/navigationHelper';
import { getWaitingRatePerMinute } from '../../utils/tariffUtils';
import { normalizeMapProvider } from '../Home/utils/homeScreenUtils';
import SOSButton from '../../components/SOSButton';

const { width, height } = Dimensions.get('window');
const SMART_WAIT_DISTANCE_METERS = 8;
const SMART_WAIT_SPEED_KMH = 6;
const SMART_WAIT_DURATION_MS = 3000;

const toSafeNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

interface ActiveRideScreenProps {}

const ActiveRideScreen: React.FC<ActiveRideScreenProps> = () => {
  const navigation = useNavigation<any>();
  const {
    currentJob,
    status,
    timer,
    pricingBreakdown,
    routePoints,
    pauseJob,
    resumeJob,
    resumePendingPayment,
    prepareJobForPayment, // ✅ Use prepare instead of complete
    changeTariff, // ✅ NEW: For changing tariff mid-ride
    updateStatus,
    clearJob,
  } = useJob();
  
  const { location } = useLocation();
  const { selectedTariff, tariffs: driverTariffs } = useShift(); // ✅ FIX: Use 'tariffs' from ShiftContext
  const { driver } = useAuth();
  const { unreadCount: dispatcherUnread } = useUnreadDispatcher();

  const [mapProvider, setMapProvider] = useState<MapProvider>('NATIVE');
  const [mapProviderLoading, setMapProviderLoading] = useState(false);
  const [locationUpdateInterval, setLocationUpdateInterval] = useState<number>(5);
  
  // Animation for pulsing meter
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Speed calculation
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  // ✅ NEW: Movement detection status for real-time debugging
  const [movementStatus, setMovementStatus] = useState<{
    isMoving: boolean;
    speed: number;
    method: string;
    distanceMoved: number;
    lastUpdate: number;
    stationaryDurationMs: number;
    waitingReady: boolean;
  }>({
    isMoving: false,
    speed: 0,
    method: 'unknown',
    distanceMoved: 0,
    lastUpdate: Date.now(),
    stationaryDurationMs: 0,
    waitingReady: false,
  });
  
  const [displayElapsedSeconds, setDisplayElapsedSeconds] = useState(timer?.elapsedSeconds || 0);
  const elapsedBaseRef = useRef(timer?.elapsedSeconds || 0);
  const elapsedSyncRef = useRef(Date.now());

  // ✅ NEW: Tariff change modal
  const [showTariffModal, setShowTariffModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [advancingStop, setAdvancingStop] = useState(false);
  // Guards the "Complete Trip" button against a double-tap that would prepare
  // payment twice and push two PaymentCollection screens.
  const [completing, setCompleting] = useState(false);

  // Multi-stop waypoint state. `stops` come from the dispatch-created job;
  // `currentStopIndex` tracks which one the driver is heading to right now.
  // 0 = stop[0] (or dropoff if no stops). stops.length = final dropoff.
  // The source of truth is `job.requirements.currentStopIndex` on the
  // backend; we hydrate from it + update via POST /jobs/:id/stops/advance.
  const stopsArray: any[] = useMemo(() => {
    const stops =
      (currentJob as any)?.stops ||
      (currentJob as any)?.requirements?.stops ||
      [];
    return Array.isArray(stops) ? stops : [];
  }, [currentJob]);

  const currentStopIndex: number = useMemo(() => {
    const raw = (currentJob as any)?.requirements?.currentStopIndex ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [currentJob]);

  // The ONE waypoint the driver should see right now. Everything else is
  // hidden until the driver taps Continue.
  const activeWaypoint = useMemo(() => {
    if (currentStopIndex < stopsArray.length) {
      const s = stopsArray[currentStopIndex];
      return {
        kind: 'STOP' as const,
        label: `STOP ${s.order || currentStopIndex + 1} OF ${stopsArray.length}`,
        address: s.address || 'Stop location',
        latitude: s.latitude,
        longitude: s.longitude,
      };
    }
    return {
      kind: 'DROPOFF' as const,
      label: 'FINAL DESTINATION',
      address: currentJob?.dropoffAddress || 'Customer will tell you',
      latitude: currentJob?.dropoffLatitude,
      longitude: currentJob?.dropoffLongitude,
    };
  }, [stopsArray, currentStopIndex, currentJob]);

  const hasMoreStops = currentStopIndex < stopsArray.length;

  const handleAdvanceStop = useCallback(async () => {
    if (!currentJob?.id || advancingStop) return;
    setAdvancingStop(true);
    try {
      const jobKey = currentJob.id || (currentJob as any).jobId || '';
      const resp = await httpClient.post(
        `/mobile/driver/jobs/${jobKey}/stops/advance`,
      );
      const data = resp?.data?.data;
      Toast.show({
        type: 'success',
        text1: data?.isFinal ? 'Heading to final destination' : `Heading to next stop`,
        text2: data?.nextWaypoint?.address,
        position: 'top',
        visibilityTime: 2000,
      });
      // Mutate the in-memory job so the UI reflects the advance without
      // waiting for a server re-fetch. The next socket event or refresh
      // will reconcile authoritative state.
      const existingReq = ((currentJob as any)?.requirements || {});
      (currentJob as any).requirements = {
        ...existingReq,
        currentStopIndex: data?.currentStopIndex,
      };
    } catch (err: any) {
      Toast.show({
        type: 'error',
        text1: 'Failed to advance',
        text2: err?.response?.data?.message || err?.message || 'Try again',
      });
    } finally {
      setAdvancingStop(false);
    }
  }, [currentJob, advancingStop]);
  const activeTariff = useMemo(() => {
    const jobTariff = (currentJob as any)?.tariff;
    if (selectedTariff && jobTariff) {
      return {
        ...jobTariff,
        ...selectedTariff,
        baseFare: toSafeNumber(selectedTariff.baseFare) ?? toSafeNumber(jobTariff.baseFare) ?? 0,
        perKmRate: toSafeNumber(selectedTariff.perKmRate) ?? toSafeNumber(jobTariff.perKmRate) ?? 0,
        perMinuteRate: toSafeNumber(selectedTariff.perMinuteRate) ?? toSafeNumber(jobTariff.perMinuteRate) ?? 0,
        minimumFare: toSafeNumber(selectedTariff.minimumFare) ?? toSafeNumber(jobTariff.minimumFare) ?? 0,
      };
    }
    return selectedTariff || jobTariff || null;
  }, [selectedTariff, currentJob]);
  const resolvedBaseFare = useMemo(() => {
    const jobTariffBase = toSafeNumber((currentJob as any)?.tariff?.baseFare);
    const tariffBase = toSafeNumber(activeTariff?.baseFare) ?? jobTariffBase;
    const breakdownBase = pricingBreakdown
      ? toSafeNumber(pricingBreakdown.startingPrice)
      : undefined;

    if (typeof breakdownBase === 'number' && breakdownBase > 0) {
      return breakdownBase;
    }

    if (typeof tariffBase === 'number' && tariffBase > 0) {
      return tariffBase;
    }

    return tariffBase ?? breakdownBase ?? 0;
  }, [activeTariff, currentJob, pricingBreakdown]);

  // ✅ Navigate back to Home when job is cleared (recalled by dispatcher)
  useEffect(() => {
    if (!currentJob) {
      const timer = setTimeout(() => {
        console.log('🔙 ActiveRideScreen: Job cleared, navigating back to Home');
        navigation.navigate('Home');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentJob, navigation]);

  useFocusEffect(
    useCallback(() => {
      if (status === 'PENDING_PAYMENT') {
        resumePendingPayment();
      }
    }, [status, resumePendingPayment])
  );

  // ✅ Company map settings (free-tier map alignment)
  useEffect(() => {
    if (!driver?.companyId) {
      return;
    }

    let cancelled = false;

    const loadSettings = async () => {
      setMapProviderLoading(true);
      try {
        const response = await fetchCompanySettings(driver.companyId);
        if (cancelled) {
          return;
        }
        const provider = normalizeMapProvider(response?.settings?.mapProvider || undefined);
        const interval = response?.settings?.locationUpdateInterval || 5;
        setMapProvider(provider);
        setLocationUpdateInterval(interval);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load company map settings for ActiveRide:', error);
          setMapProvider('NATIVE');
        }
      } finally {
        if (!cancelled) {
          setMapProviderLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      cancelled = true;
    };
  }, [driver?.companyId]);
  
  // 🔍 DEBUG: Log tariffs when modal opens
  useEffect(() => {
    if (showTariffModal) {
      console.log('🔍 Tariff Modal Opened - Available Tariffs:', {
        count: driverTariffs?.length || 0,
        tariffs: driverTariffs?.map(t => ({
          id: t.id,
          name: t.name,
          baseFare: t.baseFare,
          perKm: t.perKmRate,
          perMin: t.perMinuteRate,
        })),
        selectedTariff: selectedTariff?.name,
      });
    }
  }, [showTariffModal, driverTariffs, selectedTariff]);
  
  useEffect(() => {
    // Pulse animation for live fare
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);
  
  // ✅ NEW: Track real-time movement status for debugging waiting time
  const lastLocationRef = useRef<any>(null);
  const stationarySinceRef = useRef<number | null>(null);
  
  useEffect(() => {
    if (!location) {
      stationarySinceRef.current = null;
      setCurrentSpeed(0);
      setMovementStatus(prev => ({
        ...prev,
        isMoving: false,
        speed: 0,
        method: 'no location',
        distanceMoved: 0,
        stationaryDurationMs: 0,
        waitingReady: false,
        lastUpdate: Date.now(),
      }));
      return;
    }
    
    const currentTimestamp = location.timestamp ?? Date.now();
    
    // Calculate distance from last location
    let distanceMoved = 0;
    let timeDeltaSeconds = 0;
    if (lastLocationRef.current) {
      const R = 6371000; // Earth's radius in meters
      const dLat = (location.latitude - lastLocationRef.current.latitude) * Math.PI / 180;
      const dLon = (location.longitude - lastLocationRef.current.longitude) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lastLocationRef.current.latitude * Math.PI / 180) * 
        Math.cos(location.latitude * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceMoved = R * c; // Distance in meters

      const prevTimestamp = lastLocationRef.current.timestamp ?? currentTimestamp;
      timeDeltaSeconds = Math.max((currentTimestamp - prevTimestamp) / 1000, 0.5);
    }
    
    let derivedSpeedKmh =
      distanceMoved > 0 && timeDeltaSeconds > 0
        ? Math.min((distanceMoved / timeDeltaSeconds) * 3.6, 200)
        : 0;

    if (!derivedSpeedKmh && typeof location.speed === 'number') {
      derivedSpeedKmh = Math.max(location.speed * 3.6, 0);
    }
    
    const isMovingByDistance = distanceMoved >= SMART_WAIT_DISTANCE_METERS;
    const isMovingBySpeed = derivedSpeedKmh >= SMART_WAIT_SPEED_KMH;
    
    // Use coordinate-based detection as primary method whenever possible
    const isMoving = lastLocationRef.current ? isMovingByDistance : isMovingBySpeed;
    const method = lastLocationRef.current 
      ? `coords (${distanceMoved.toFixed(1)}m)`
      : `speed (${derivedSpeedKmh.toFixed(1)} km/h)`;

    if (!isMoving) {
      if (!stationarySinceRef.current) {
        stationarySinceRef.current = Date.now();
      }
    } else {
      stationarySinceRef.current = null;
    }

    const stationaryDurationMs = stationarySinceRef.current
      ? Date.now() - stationarySinceRef.current
      : 0;
    const waitingReady = stationaryDurationMs >= SMART_WAIT_DURATION_MS;
    
    setCurrentSpeed(derivedSpeedKmh);
    setMovementStatus({
      isMoving,
      speed: derivedSpeedKmh,
      method,
      distanceMoved,
      lastUpdate: Date.now(),
      stationaryDurationMs,
      waitingReady,
    });
    
    // Store current location for next comparison
    lastLocationRef.current = {
      ...location,
      timestamp: currentTimestamp,
    };
  }, [location?.latitude, location?.longitude, location?.timestamp, location?.speed]);
  
  const isJobRunning = status === 'STARTED' || status === 'ACTIVE';

  useEffect(() => {
    elapsedBaseRef.current = Math.max(0, timer?.elapsedSeconds || 0);
    elapsedSyncRef.current = Date.now();
    setDisplayElapsedSeconds(Math.max(0, Math.round(elapsedBaseRef.current)));
  }, [timer?.elapsedSeconds]);

  useEffect(() => {
    if (!isJobRunning) {
      elapsedBaseRef.current = Math.max(0, timer?.elapsedSeconds || 0);
      elapsedSyncRef.current = Date.now();
      setDisplayElapsedSeconds(Math.max(0, Math.round(elapsedBaseRef.current)));
      return;
    }

    const interval = setInterval(() => {
      const deltaSeconds = Math.floor((Date.now() - elapsedSyncRef.current) / 1000);
      setDisplayElapsedSeconds(elapsedBaseRef.current + Math.max(deltaSeconds, 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [isJobRunning, timer?.elapsedSeconds]);

  useEffect(() => {
    // Drivers routinely jump to Google Maps / Waze mid-trip. When they come
    // back we need to: (a) correct the on-screen meter reading, (b) make sure
    // the socket is still up so status/location updates flow, and (c) re-pull
    // authoritative job state so we don't keep running the meter on a job the
    // dispatcher already cancelled/recalled while the driver was away.
    const handleAppStateChange = async (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        if (nextState === 'background' || nextState === 'inactive') {
          try { emitAppStateChange('BACKGROUND'); } catch {}
        }
        return;
      }

      elapsedSyncRef.current = Date.now();
      setDisplayElapsedSeconds(Math.max(0, Math.round(elapsedBaseRef.current)));

      try { ensureConnected(); } catch {}
      try { emitAppStateChange('ACTIVE'); } catch {}

      const localJobId = currentJob?.id;
      if (!localJobId) return;

      try {
        const serverJob: any = await getActiveJob();

        // Server says: no active job. It was cancelled / recalled / reassigned
        // / completed while the driver was in the background. Clear local
        // state and return to home so the driver doesn't keep a zombie meter.
        if (!serverJob) {
          Toast.show({
            type: 'info',
            text1: 'Job ended',
            text2: 'This job is no longer active. Returning to home.',
            visibilityTime: 3000,
          });
          try { clearJob(); } catch {}
          try { (navigation as any).reset({ index: 0, routes: [{ name: 'Home' }] }); } catch {}
          return;
        }

        // Server has a DIFFERENT active job than we think we're on — treat the
        // old one as gone, bail to home so re-hydration picks up the real one.
        if (serverJob.id && serverJob.id !== localJobId) {
          try { clearJob(); } catch {}
          try { (navigation as any).reset({ index: 0, routes: [{ name: 'Home' }] }); } catch {}
          return;
        }

        // Same job, possibly drifted status — sync if we're out of date.
        if (serverJob.status && serverJob.status !== status) {
          try { updateStatus(serverJob.status as any); } catch {}
        }
      } catch (err) {
        // Soft-fail: if the sync call errors, we keep whatever state we had.
        console.warn('[ActiveRide] foreground re-sync failed', (err as any)?.message);
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [currentJob?.id, status, updateStatus, clearJob, navigation]);
  
  // Calculate coordinates
  const pickupCoord = useMemo(() => {
    if (currentJob?.pickupLatitude && currentJob?.pickupLongitude) {
      return {
        latitude: currentJob.pickupLatitude,
        longitude: currentJob.pickupLongitude,
      };
    }
    return undefined;
  }, [currentJob]);
  
  const dropoffCoord = useMemo(() => {
    if (currentJob?.dropoffLatitude && currentJob?.dropoffLongitude) {
      return {
        latitude: currentJob.dropoffLatitude,
        longitude: currentJob.dropoffLongitude,
      };
    }
    return undefined;
  }, [currentJob]);
  
  const driverCoord = useMemo(() => {
    if (location?.latitude && location?.longitude) {
      const derivedSpeedMs =
        Number.isFinite(currentSpeed) && currentSpeed > 0
          ? currentSpeed / 3.6
          : location.speed || 0;
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        heading: location.heading || 0,
        speed: derivedSpeedMs,
      };
    }
    return undefined;
  }, [location?.latitude, location?.longitude, location?.heading, location?.speed, currentSpeed]);
  
  const routeCoordinates = useMemo(
    () => routePoints.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [routePoints]
  );

  const derivedWaitingSeconds = useMemo(() => {
    const waiting = Math.min(timer?.waitingSeconds || 0, displayElapsedSeconds);
    return Math.max(0, Math.round(waiting));
  }, [timer?.waitingSeconds, displayElapsedSeconds]);

  const mapAnimationInterval = useMemo(
    () => Math.max(locationUpdateInterval, 1) * 1000,
    [locationUpdateInterval]
  );

  const waitingRate = useMemo(
    () => getWaitingRatePerMinute(activeTariff || undefined),
    [activeTariff]
  );
  
  // Format time
  const formatTime = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(safeSeconds / 3600);
    const mins = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const manualFareComponents = useMemo(() => {
    const elapsedSec = Math.max(0, Math.round(displayElapsedSeconds));
    const waitingSec = derivedWaitingSeconds;

    const base = typeof resolvedBaseFare === 'number' ? resolvedBaseFare : 0;
    const perKmRate = Number(activeTariff?.perKmRate) || 0;
    const perMinuteRate = Number(activeTariff?.perMinuteRate) || 0;
    const distance = ((timer?.distanceMeters || 0) / 1000) * perKmRate;
    const time = (elapsedSec / 60) * perMinuteRate;
    const waiting = (waitingSec / 60) * waitingRate;
    const total = base + distance + time + waiting;

    return {
      base,
      distance: Number.isFinite(distance) ? distance : 0,
      time: Number.isFinite(time) ? time : 0,
      waiting: Number.isFinite(waiting) ? waiting : 0,
      total: Number.isFinite(total) ? total : 0,
    };
  }, [
    resolvedBaseFare,
    activeTariff,
    timer?.distanceMeters,
    waitingRate,
    displayElapsedSeconds,
    derivedWaitingSeconds,
  ]);

  // Get fare from pricing breakdown or calculate manually
  const currentFare = useMemo(() => {
    if (pricingBreakdown) {
      const fareFromBreakdown = Number.parseFloat(pricingBreakdown.totalCost || '0');
      if (Number.isFinite(fareFromBreakdown) && fareFromBreakdown > 0) {
        return fareFromBreakdown;
      }
    }

    return manualFareComponents.total;
  }, [pricingBreakdown, manualFareComponents]);
  
  // Fare breakdown
  const fareDetails = useMemo(() => {
    if (pricingBreakdown) {
      const distance = Number.parseFloat(pricingBreakdown.distanceCost || '0');
      const time = Number.parseFloat(pricingBreakdown.durationCost || '0');
      const waiting = Number.parseFloat(pricingBreakdown.waitingCost || '0');
      
      return {
        base: manualFareComponents.base,
        distance: Number.isFinite(distance) ? distance : manualFareComponents.distance,
        time: Number.isFinite(time) ? time : manualFareComponents.time,
        waiting: Number.isFinite(waiting) ? waiting : manualFareComponents.waiting,
      };
    }
    
    return manualFareComponents;
  }, [pricingBreakdown, manualFareComponents]);
  
  // Handlers
  const handlePause = useCallback(async () => {
    try {
      await pauseJob();
      navigation.navigate('JobPaused');
      Toast.show({
        type: 'info',
        text1: 'Ride Paused',
        text2: 'Waiting time will be tracked',
      });
    } catch (error) {
      console.error('Failed to pause job:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Pause',
        text2: 'Please try again',
      });
    }
  }, [pauseJob, navigation]);
  
  const handleComplete = useCallback(async () => {
    if (completing) return; // ignore double-taps
    setCompleting(true);
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💰 COMPLETING JOB - PAYMENT FLOW START');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 Current State:', {
        currentFare: (Number(currentFare) || 0).toFixed(2),
        timerEarnings: timer?.earningsSoFar?.toFixed(2) || 'undefined',
        timerDistance: timer?.distanceMeters?.toFixed(2) || 'undefined',
        timerWaiting: timer?.waitingSeconds?.toFixed(0) || 'undefined',
        timerElapsed: timer?.elapsedSeconds?.toFixed(0) || 'undefined',
        pricingBreakdownTotal: pricingBreakdown?.totalCost || 'undefined',
        selectedTariff: selectedTariff?.name || 'undefined',
      });
      
      const preparedJob = await prepareJobForPayment(); // ✅ Prepare (not complete yet!)
      
      if (!preparedJob) {
        console.error('❌ PreparedJob is null!');
        Toast.show({
          type: 'error',
          text1: 'Failed to Prepare',
          text2: 'No job data available',
        });
        return;
      }

      // ✅ FIX: Use currentFare, but fall back to tariff base fare if 0
      // This ensures minimum charge is always the base/flag-drop fare
      const tariffMinimum = resolvedBaseFare > 0 ? resolvedBaseFare : 0;
      const finalAmount = currentFare > 0 ? currentFare : tariffMinimum;

      console.log('💸 NAVIGATING TO PAYMENT SCREEN:', {
        jobId: preparedJob.id,
        amount: finalAmount.toFixed(2),
        customerId: preparedJob.customer?.id || null,
      });

      // ✅ Navigate with required params
      navigation.navigate('PaymentCollection', {
        jobId: preparedJob.id,
        amount: finalAmount,
        customerId: preparedJob.customer?.id || null,
      });
      
      console.log('✅ Navigation completed - payment screen should show');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      Toast.show({
        type: 'success',
        text1: 'Ride Ended',
        text2: `Collect ${formatCurrency(finalAmount)}`,
      });
    } catch (error) {
      console.error('❌ Failed to prepare job for payment:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Prepare',
        text2: 'Please try again',
      });
    } finally {
      setCompleting(false); // re-enable so a failed attempt can be retried
    }
  }, [completing, prepareJobForPayment, navigation, currentFare, timer, pricingBreakdown, selectedTariff]);
  
  // ✅ NEW: Handle tariff change during active ride
  const handleTariffChange = useCallback(async (newTariff: any) => {
    try {
      // Call changeTariff from JobContext
      await changeTariff(newTariff);
      
      setShowTariffModal(false);
      
      Toast.show({
        type: 'success',
        text1: 'Tariff Changed',
        text2: `Now using: ${newTariff.name}. Pricing recalculated.`,
        position: 'top',
      });
      
      const newWaitingRate = getWaitingRatePerMinute(newTariff);

      console.log('✅ Tariff changed successfully:', {
        from: selectedTariff?.name,
        to: newTariff.name,
        newRates: {
          perKm: newTariff.perKmRate,
          perMin: newTariff.perMinuteRate,
          waiting: newWaitingRate,
        },
      });
    } catch (error) {
      console.error('❌ Failed to change tariff:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Change Tariff',
        text2: 'Please try again',
        position: 'top',
      });
    }
  }, [changeTariff, selectedTariff]);
  
  const handleNavigation = useCallback(() => {
    openExternalNavigation(
      dropoffCoord
        ? {
            latitude: dropoffCoord.latitude,
            longitude: dropoffCoord.longitude,
            label: currentJob?.dropoffAddress || null,
          }
        : null
    );
  }, [currentJob?.dropoffAddress, dropoffCoord]);
  
  const isPaused = status === 'PAUSED';
  
  // ✅ FIX: Don't render if job is PAUSED - JobPausedScreen will handle this
  if (isPaused) {
    return null;
  }
  
  // ✅ FIX: Don't render if no job
  if (!currentJob) {
    return null;
  }
  
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* ✅ KEEP SCREEN AWAKE - Prevent device sleep during active ride */}
      <KeepAwake />
      
      {/* Professional Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>ACTIVE TRIP</Text>
          <Text style={styles.headerJobId}>
            #{(currentJob?.publicJobId || currentJob?.id || '---').slice(0, 6)}
          </Text>
        </View>
        <View style={{flexDirection: 'row'}}>
          {/* 💬 Chat with passenger — opens PassengerChatScreen */}
          {currentJob?.customer?.id && (
            <TouchableOpacity
              style={[styles.navButton, {marginRight: 8, backgroundColor: 'rgba(255,209,102,0.2)'}]}
              onPress={() => navigation.navigate('PassengerChat' as never, {
                jobId: currentJob?.id,
                passengerId: currentJob?.customer?.id,
                passengerName: currentJob?.customer?.name || currentJob?.customer?.firstName,
              } as never)}
              activeOpacity={0.7}
            >
              <Icon name="message-text" size={18} color="#FFD166" />
            </TouchableOpacity>
          )}
          {/* 🎧 Chat with dispatcher — reachable mid-ride for routing
                changes, customer issues, or company comms. Badge shows
                unread count when DispatcherChat screen isn't open. */}
          <TouchableOpacity
            style={[styles.navButton, {marginRight: 8, backgroundColor: 'rgba(96,165,250,0.2)'}]}
            onPress={() => navigation.navigate('DispatcherChat' as never)}
            activeOpacity={0.7}
          >
            <Icon name="headset" size={18} color="#60a5fa" />
            {dispatcherUnread > 0 ? (
              <View style={styles.dispatcherUnreadBadge}>
                <Text style={styles.dispatcherUnreadBadgeText}>
                  {dispatcherUnread > 9 ? '9+' : dispatcherUnread}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, {marginRight: 8}]}
            onPress={handleNavigation}
            activeOpacity={0.7}
          >
            <Icon name="navigation-variant" size={18} color="#fff" />
          </TouchableOpacity>
          {/* 🚨 Emergency SOS — compact icon aligned with chat/nav buttons.
                Hold 2s to confirm + send. Placed here so it's always
                visible without blocking the map/fare display. */}
          <SOSButton compact iconSize={18} buttonStyle={styles.headerSosButton} />
        </View>
      </View>

      {/* Professional Movement Status Bar */}
      <View style={[
        styles.statusBar,
        movementStatus.isMoving ? styles.statusBarMoving : styles.statusBarStopped
      ]}>
        <View style={styles.statusLeft}>
          <View style={[
            styles.statusIndicator,
            movementStatus.isMoving ? styles.statusIndicatorMoving : styles.statusIndicatorStopped
          ]} />
          <Text style={styles.statusText}>
            {movementStatus.isMoving ? 'IN MOTION' : 'STATIONARY'}
          </Text>
          <Text style={[styles.statusDetail, movementStatus.waitingReady && styles.waitingActiveLabel]}>
            {movementStatus.waitingReady ? `WAITING • ${movementStatus.method}` : movementStatus.method}
          </Text>
        </View>
        <View style={styles.statusRight}>
          <Text style={styles.statusSpeed}>{movementStatus.speed.toFixed(0)}</Text>
          <Text style={styles.statusSpeedUnit}>KM/H</Text>
        </View>
      </View>
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Professional Meter Display */}
        <View style={styles.meterSection}>
          {/* Main Fare - Professional Meter Style */}
          <View style={styles.meterDisplay}>
            <View style={styles.meterHeader}>
              <Text style={styles.meterHeaderText}>TAXIMETER</Text>
              <View style={styles.liveIndicator}>
                <View style={[styles.liveDot, isPaused && styles.liveDotPaused]} />
                <Text style={styles.liveText}>{isPaused ? 'PAUSED' : 'RUNNING'}</Text>
              </View>
            </View>
            <Animated.Text style={[styles.meterFare, { transform: [{ scale: pulseAnim }] }]}>
              {formatCurrency(Number(currentFare) || 0)}
            </Animated.Text>
          </View>

          {/* Professional Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{((timer?.distanceMeters || 0) / 1000).toFixed(2)}</Text>
              <Text style={styles.statUnit}>KM</Text>
              <Text style={styles.statCost}>{formatCurrency(fareDetails.distance)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatTime(displayElapsedSeconds)}</Text>
              <Text style={styles.statUnit}>TIME</Text>
              <Text style={styles.statCost}>{formatCurrency(fareDetails.time)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{formatTime(derivedWaitingSeconds)}</Text>
              <Text style={[styles.statUnit, movementStatus.waitingReady && styles.waitingActiveLabel]}>
                {movementStatus.waitingReady ? 'WAITING' : 'WAIT'}
              </Text>
              <Text style={[styles.statCost, movementStatus.waitingReady && styles.waitingActiveCost]}>
                {formatCurrency(fareDetails.waiting)}
              </Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{Math.round(currentSpeed)}</Text>
              <Text style={styles.statUnit}>KM/H</Text>
            </View>
          </View>
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <TouchableOpacity
            style={styles.mapExpandButton}
            activeOpacity={0.85}
            onPress={() => setShowMapModal(true)}
          >
            <Icon name="fullscreen" size={14} color="#fff" />
            <Text style={styles.mapExpandText}>Full Map</Text>
          </TouchableOpacity>
          <RideMap
            pickup={pickupCoord}
            dropoff={dropoffCoord}
            driver={driverCoord}
            stops={currentJob?.stops}
            route={routeCoordinates}
            style={styles.map}
            enable3D={true}
            followDriver={true}
            height={200}
            mapProviderOverride={mapProvider}
            updateInterval={mapAnimationInterval}
          />
          {mapProviderLoading && (
            <View style={styles.mapLoadingOverlay}>
              <ActivityIndicator size="small" color="#fbbf24" />
              <Text style={styles.mapLoadingText}>Syncing map provider…</Text>
            </View>
          )}
        </View>
        
        {/* Nearby Jobs Queue - Only show when within 3km of dropoff */}
        {(() => {
          // Only show nearby jobs if driver is approaching dropoff
          if (!dropoffCoord || !location?.latitude || !location?.longitude) {
            return null; // No dropoff or driver location, don't show
          }
          
          const distanceToDropoff = calculateDistance(
            location.latitude,
            location.longitude,
            dropoffCoord.latitude,
            dropoffCoord.longitude
          );
          
          // Only show nearby jobs when within 3km of dropoff
          if (distanceToDropoff > 3) {
            return null;
          }
          
          return <NearbyJobsQueue />;
        })()}
        
        {/* Trip Info — shows ONE waypoint at a time. Drivers get confused
            when all stops + the final dropoff are listed simultaneously.
            The sequential card + "Continue" button matches how Uber/Careem
            guide drivers through multi-stop trips. */}
        <View style={styles.tripInfo}>
          <View style={styles.tripRow}>
            <Icon
              name={activeWaypoint.kind === 'STOP' ? 'map-marker-path' : 'flag-checkered'}
              size={20}
              color={activeWaypoint.kind === 'STOP' ? '#f59e0b' : '#22c55e'}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.tripLabel}>{activeWaypoint.label}</Text>
              <Text style={styles.tripText} numberOfLines={2}>
                {activeWaypoint.address}
              </Text>
            </View>
          </View>

          {/* Tiny progress strip: "1 of 3" style indicator if multi-stop */}
          {stopsArray.length > 0 && (
            <View style={{ flexDirection: 'row', marginTop: 10, gap: 4 }}>
              {stopsArray.map((_, i) => (
                <View
                  key={`tick-${i}`}
                  style={{
                    flex: 1,
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: i < currentStopIndex ? '#22c55e' : 'rgba(245,158,11,0.4)',
                  }}
                />
              ))}
              <View
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor:
                    currentStopIndex >= stopsArray.length ? '#22c55e' : 'rgba(34,197,94,0.3)',
                }}
              />
            </View>
          )}
        </View>
      </ScrollView>
      
      {/* Action Buttons */}
      <View style={styles.actions}>
        <View style={styles.actionsRow}>
          {/* Change Tariff */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => setShowTariffModal(true)}
            activeOpacity={0.8}
          >
            <Icon name="swap-horizontal" size={16} color="#fff" />
            <Text style={styles.secondaryButtonText}>TARIFF</Text>
          </TouchableOpacity>
          
          {/* Pause */}
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handlePause}
            activeOpacity={0.8}
          >
            <Icon name="pause" size={16} color="#fff" />
            <Text style={styles.secondaryButtonText}>PAUSE</Text>
          </TouchableOpacity>
        </View>
        
        {/* Primary action changes based on whether more stops remain.
            With stops → "Arrived, continue to next stop" (advances the
            currentStopIndex). At final dropoff → "Complete Trip". */}
        {hasMoreStops ? (
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: '#f59e0b' }]}
            onPress={handleAdvanceStop}
            disabled={advancingStop}
            activeOpacity={0.8}
          >
            {advancingStop ? (
              <ActivityIndicator color="#000" />
            ) : (
              <>
                <Icon name="map-marker-check" size={20} color="#000" />
                <Text style={styles.primaryButtonText}>ARRIVED — NEXT STOP</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, completing && { opacity: 0.6 }]}
            onPress={handleComplete}
            activeOpacity={0.8}
            disabled={completing}
          >
            <Icon name="check-bold" size={20} color="#000" />
            <Text style={styles.primaryButtonText}>{completing ? 'COMPLETING…' : 'COMPLETE TRIP'}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {/* Full-Screen Map Modal */}
      <Modal
        visible={showMapModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowMapModal(false)}
      >
        <View style={styles.mapModalOverlay}>
          <View style={styles.mapModalContent}>
            <View style={styles.mapModalHeader}>
              <Text style={styles.mapModalTitle}>Navigation Map</Text>
              <View style={styles.mapModalActions}>
                <TouchableOpacity
                  style={styles.mapModalActionButton}
                  onPress={handleNavigation}
                  activeOpacity={0.85}
                >
                  <Icon name="navigation-variant" size={16} color="#fff" />
                  <Text style={styles.mapModalActionText}>Open Maps</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.mapModalClose}
                  onPress={() => setShowMapModal(false)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.mapModalCloseText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
            <RideMap
              pickup={pickupCoord}
              dropoff={dropoffCoord}
              driver={driverCoord}
              stops={currentJob?.stops}
              route={routeCoordinates}
              style={styles.mapModalMap}
              enable3D
              followDriver
              mapProviderOverride={mapProvider}
              updateInterval={mapAnimationInterval}
            />
          </View>
        </View>
      </Modal>

      {/* ✅ NEW: Tariff Change Modal */}
      <Modal
        visible={showTariffModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTariffModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Tariff</Text>
              <TouchableOpacity
                onPress={() => setShowTariffModal(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              Current: {selectedTariff?.name || 'Unknown'}
            </Text>
            
            <ScrollView style={styles.tariffList}>
              {!driverTariffs || driverTariffs.length === 0 ? (
                <View style={styles.emptyState}>
                  <Icon name="information-outline" size={48} color="#64748b" />
                  <Text style={styles.emptyStateText}>No tariffs available</Text>
                  <Text style={styles.emptyStateSubtext}>
                    Please ensure you have tariffs configured for your zone
                  </Text>
                </View>
              ) : (
                driverTariffs.map((tariff) => {
                  const isSelected = tariff.id === selectedTariff?.id;
                  return (
                    <TouchableOpacity
                      key={tariff.id}
                      style={[
                        styles.tariffOption,
                        isSelected && styles.tariffOptionSelected,
                      ]}
                      onPress={() => handleTariffChange(tariff)}
                      disabled={isSelected}
                      activeOpacity={0.7}
                    >
                      <View style={styles.tariffOptionHeader}>
                        <Text style={styles.tariffOptionName}>{tariff.name}</Text>
                        {isSelected && (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>CURRENT</Text>
                          </View>
                        )}
                      </View>
                      
                      <View style={styles.tariffOptionRates}>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Base Fare:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.baseFare?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Per KM:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.perKmRate?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Per Min:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.perMinuteRate?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowTariffModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: 0,
  },
  // Professional Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 4,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
  },
  headerJobId: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // SOS button sized/shaped to match the 36×36 header icons so it reads as a
  // peer action rather than a giant FAB looming over the ride controls.
  headerSosButton: {
    width: 36,
    height: 36,
    borderRadius: 4,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  // Unread badge on the dispatcher-chat header icon.
  dispatcherUnreadBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1a1a1a',
  },
  dispatcherUnreadBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
  // Professional Status Bar
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  statusBarMoving: {
    backgroundColor: '#1a2e1a',
  },
  statusBarStopped: {
    backgroundColor: '#2e1a1a',
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusIndicatorMoving: {
    backgroundColor: '#22c55e',
  },
  statusIndicatorStopped: {
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  statusDetail: {
    fontSize: 9,
    color: '#666',
    marginLeft: 4,
  },
  statusRight: {
    alignItems: 'flex-end',
  },
  statusSpeed: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    lineHeight: 16,
  },
  statusSpeedUnit: {
    fontSize: 8,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  // Professional Meter Section
  meterSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  meterDisplay: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  meterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  meterHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
  },
  liveDotPaused: {
    backgroundColor: '#ef4444',
  },
  liveText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 0.5,
  },
  meterFare: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    letterSpacing: -1,
    textAlign: 'center',
    alignSelf: 'center',
    width: '100%',
  },
  // Professional Stats Row
  statsRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  statUnit: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  statCost: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fbbf24',
    marginTop: 4,
  },
  waitingActiveLabel: {
    color: '#f97316',
  },
  waitingActiveCost: {
    color: '#f97316',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#333',
    marginHorizontal: 4,
  },
  // Map
  mapContainer: {
    margin: 10,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
    position: 'relative',
  },
  map: {
    width: '100%',
    height: 200,
  },
  mapExpandButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mapExpandText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
    letterSpacing: 0.3,
  },
  mapLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapLoadingText: {
    color: '#fbbf24',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  mapModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  mapModalContent: {
    width: '100%',
    height: '85%',
    backgroundColor: '#0f111a',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#222',
    overflow: 'hidden',
  },
  mapModalHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  mapModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  mapModalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapModalActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  mapModalActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  mapModalClose: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  mapModalCloseText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  mapModalMap: {
    flex: 1,
  },
  // Cover Jobs Section
  coverJobsSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  coverJobsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  coverJobsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
    flex: 1,
  },
  coverJobCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  coverJobLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  coverJobIndex: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    width: 22,
  },
  coverJobDetails: {
    flex: 1,
  },
  coverJobPickup: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
    marginBottom: 2,
  },
  coverJobDropoff: {
    fontSize: 10,
    color: '#888',
  },
  coverJobRight: {
    alignItems: 'flex-end',
  },
  coverJobFare: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  coverJobStatus: {
    fontSize: 8,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  noCoverJobs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  noCoverJobsText: {
    fontSize: 11,
    color: '#666',
  },
  // Trip Info
  tripInfo: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 8,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tripLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 1,
    marginBottom: 4,
  },
  tripText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#22c55e',
    flex: 1,
  },
  tripPhone: {
    fontSize: 10,
    color: '#888',
  },
  // Professional Actions - With safe area padding for navigation bar
  actions: {
    paddingHorizontal: 10,
    paddingBottom: 28, // Extra padding to ensure button doesn't hide under nav bar
    paddingTop: 10,
    gap: 8,
    backgroundColor: '#000',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 4,
    backgroundColor: '#333',
    borderWidth: 1,
    borderColor: '#444',
  },
  secondaryButtonText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 4,
    backgroundColor: '#fbbf24',
  },
  primaryButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 1,
  },
  // Tariff Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 20,
    maxHeight: height * 0.7,
    borderTopWidth: 1,
    borderColor: '#333',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  modalCloseButton: {
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 11,
    color: '#888',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  tariffList: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    minHeight: 120,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  emptyStateText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#888',
    marginTop: 10,
    marginBottom: 4,
  },
  emptyStateSubtext: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  tariffOption: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  tariffOptionSelected: {
    borderColor: '#8b5cf6',
    backgroundColor: '#1a0a2e',
  },
  tariffOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tariffOptionName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  currentBadge: {
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  currentBadgeText: {
    fontSize: 8,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  tariffOptionRates: {
    flexDirection: 'row',
    gap: 10,
  },
  tariffRate: {
    flex: 1,
  },
  tariffRateLabel: {
    fontSize: 9,
    color: '#666',
    marginBottom: 2,
  },
  tariffRateValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  modalCancelButton: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 12,
    backgroundColor: '#333',
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
});

export default ActiveRideScreen;
