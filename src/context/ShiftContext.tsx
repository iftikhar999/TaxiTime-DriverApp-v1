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
import Toast from "react-native-toast-message";
import {
    endDriverShift,
    fetchCompanyTariffs,
    fetchCurrentShift,
    fetchDriverProfile,
    fetchDriverVehicles,
    fetchRecentJobs,
    startDriverShift
} from "../services/driverService";
import {
    notifyShiftEnded,
    notifyShiftStarted,
    registerDriverStateRestoration, // ✅ FIX: For cleanup
    registerShiftRestoration,
    unregisterDriverStateRestoration, // ✅ FIX: For cleanup
} from "../services/driverSocket";
import { ForegroundService } from "../services/foregroundService"; // ✅ NEW: Foreground service
import httpClient from "../services/httpClient";
import { RecentJobSummary } from "../types/recentJob";
import { ActiveShift, StartShiftPayload } from "../types/shift";
import { Tariff } from "../types/tariff";
import { DriverVehicle, DriverVehiclesResponse } from "../types/vehicle";
import { useAuth } from "./AuthContext";

// Debug-only console.log wrapper. All traces in this file are gated by __DEV__
// so production builds stay quiet; warnings/errors still go through console.*.
const debug = (...args: any[]) => {
  // eslint-disable-next-line no-console
  if (__DEV__) console.log(...args);
};

interface ShiftContextValue {
  vehicles: DriverVehicle[];
  vehiclesLoading: boolean;
  vehiclesError: string | null;
  selectedVehicle: DriverVehicle | null;
  selectedTariff: Tariff | null;
  tariffs: Tariff[];
  tariffsLoading: boolean;
  tariffsError: string | null;
  activeShift: ActiveShift | null;
  recentJobs: RecentJobSummary[];
  recentJobsLoading: boolean;
  refreshVehicles: () => Promise<void>;
  selectVehicle: (vehicle: DriverVehicle | null) => Promise<void>;
  clearSelection: () => Promise<void>;
  refreshTariffs: (companyId?: string) => Promise<Tariff[]>;
  selectTariff: (tariff: Tariff) => Promise<void>;
  clearTariff: () => Promise<void>;
  refreshCurrentShift: () => Promise<void>;
  startShift: (payload: StartShiftPayload) => Promise<void>;
  endShift: () => Promise<void>;
  refreshRecentJobs: (limit?: number) => Promise<void>;
  resetShiftState: () => Promise<void>;
}

const ShiftContext = createContext<ShiftContextValue>({
  vehicles: [],
  vehiclesLoading: false,
  vehiclesError: null,
  selectedVehicle: null,
  selectedTariff: null,
  tariffs: [],
  tariffsLoading: false,
  tariffsError: null,
  activeShift: null,
  recentJobs: [],
  recentJobsLoading: false,
  refreshVehicles: async () => {},
  selectVehicle: async () => {},
  clearSelection: async () => {},
  refreshTariffs: async () => [],
  selectTariff: async () => {},
  clearTariff: async () => {},
  refreshCurrentShift: async () => {},
  startShift: async () => {},
  endShift: async () => {},
  refreshRecentJobs: async () => {},
  resetShiftState: async () => {},
});

const STORAGE_KEYS = {
  selectedVehicle: "selectedVehicle",
  vehicles: "driverVehicles",
  selectedTariff: "selectedTariff",
  tariffs: "driverTariffs",
  activeShift: "activeShift", // ✅ NEW: Persist active shift
};

const SHIFT_STATUS_LABELS: Record<string, string> = {
  ONLINE: "Available",
  AVAILABLE: "Available",
  BUSY: "Busy",
  BREAK: "On Break",
  AWAY: "On Break",
  OFFLINE: "Reconnecting",
};

const formatShiftStatusLabel = (status?: string): string => {
  if (!status) {
    return "Available";
  }
  const normalized = status.toUpperCase();
  if (SHIFT_STATUS_LABELS[normalized]) {
    return SHIFT_STATUS_LABELS[normalized];
  }
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
};

const calculateShiftDurationMinutes = (shift: ActiveShift): number => {
  const serverDuration =
    typeof shift.duration === "number" && Number.isFinite(shift.duration)
      ? Math.max(shift.duration, 0)
      : 0;

  if (shift.startTime) {
    const startTimestamp = new Date(shift.startTime).getTime();
    if (!Number.isNaN(startTimestamp)) {
      const elapsedMinutes = Math.max(
        Math.floor((Date.now() - startTimestamp) / 60000),
        0
      );
      return Math.max(serverDuration, elapsedMinutes);
    }
  }

  return serverDuration;
};

const formatShiftDurationLabel = (shift: ActiveShift): string => {
  const totalMinutes = calculateShiftDurationMinutes(shift);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const formatShiftEarnings = (amount?: number): string => {
  const safeAmount =
    typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `$${safeAmount.toFixed(2)}`;
};

const getTripsCount = (value?: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const parseVehiclesResponse = (
  response: DriverVehiclesResponse | undefined
): DriverVehicle[] => {
  if (!response) {
    return [];
  }
  return response.vehicles ?? [];
};

type ForegroundSnapshot = {
  status: string;
  duration?: string;
  earnings?: string;
  trips?: number;
};

/**
 * Pre-shift compliance gate.
 *
 * Hits the driver profile endpoint and refuses to let a shift start (or
 * auto-resume) if:
 *   • licenseExpiry is in the past
 *   • insuranceExpiry is in the past
 *   • the driver's company status is not ACTIVE
 *
 * Returns null when all checks pass; a user-facing error string otherwise.
 * Errors fetching the profile are NOT treated as a block — we let the caller
 * proceed so a flaky network doesn't lock the driver out.
 */
const checkShiftEligibility = async (): Promise<string | null> => {
  let profile: any;
  try {
    profile = await fetchDriverProfile();
  } catch (error) {
    console.warn("⚠️ Shift eligibility check: profile fetch failed, allowing", error);
    return null;
  }

  const now = Date.now();
  const licenseExpiryRaw = profile?.licenseExpiry ?? profile?.license?.expiryDate;
  const insuranceExpiryRaw =
    profile?.insuranceExpiry ?? profile?.insurance?.expiryDate;

  if (licenseExpiryRaw) {
    const ts = new Date(licenseExpiryRaw).getTime();
    if (Number.isFinite(ts) && ts < now) {
      return "Your driver license has expired. Please upload a valid license before starting a shift.";
    }
  }

  if (insuranceExpiryRaw) {
    const ts = new Date(insuranceExpiryRaw).getTime();
    if (Number.isFinite(ts) && ts < now) {
      return "Your insurance certificate has expired. Please upload a valid insurance document before starting a shift.";
    }
  }

  const companyStatus = (profile?.company?.status ?? "").toString().toUpperCase();
  if (companyStatus && companyStatus !== "ACTIVE") {
    return `Your company account is currently ${companyStatus.toLowerCase()}. Please contact dispatch.`;
  }

  return null;
};

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [vehiclesError, setVehiclesError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<DriverVehicle | null>(
    null
  );
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [tariffsLoading, setTariffsLoading] = useState(false);
  const [tariffsError, setTariffsError] = useState<string | null>(null);
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [activeShift, setActiveShift] = useState<ActiveShift | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJobSummary[]>([]);
  const [recentJobsLoading, setRecentJobsLoading] = useState(false);
  const { driver } = useAuth();
  const driverDisplayName = useMemo(() => {
    if (driver?.firstName && driver?.lastName) {
      return `${driver.firstName} ${driver.lastName}`;
    }
    return driver?.firstName || driver?.lastName || "Driver";
  }, [driver?.firstName, driver?.lastName]);

  const foregroundServiceStartedRef = useRef(false);
  const notificationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startOrUpdateForegroundService = useCallback(
    async (snapshot: ForegroundSnapshot) => {
      if (Platform.OS !== "android") {
        return;
      }

      const payload = {
        driverName: driverDisplayName,
        status: snapshot.status,
        duration: snapshot.duration ?? "0m",
        earnings: snapshot.earnings ?? "$0.00",
        trips: snapshot.trips ?? 0,
      };

      try {
        if (!foregroundServiceStartedRef.current) {
          await ForegroundService.start(payload);
          foregroundServiceStartedRef.current = true;
          return;
        }

        await ForegroundService.update(payload);
      } catch (error) {
        console.warn("⚠️ Foreground notification update failed, restarting service", error);
        try {
          await ForegroundService.start(payload);
          foregroundServiceStartedRef.current = true;
        } catch (startError) {
          console.error("❌ Unable to restart foreground service:", startError);
          foregroundServiceStartedRef.current = false;
        }
      }
    },
    [driverDisplayName]
  );

  // ✅ Persist active shift to AsyncStorage (defined early to avoid hoisting issues)
  const persistActiveShift = useCallback(async (shift: ActiveShift | null) => {
    try {
      if (shift) {
        await AsyncStorage.setItem(STORAGE_KEYS.activeShift, JSON.stringify(shift));
        debug("💾 Persisted active shift:", shift.id);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
        debug("💾 Cleared persisted shift");
      }
    } catch (error) {
      console.error("❌ Failed to persist active shift:", error);
    }
  }, []);

  const loadPersistedState = useCallback(async () => {
    try {
      const [
        storedVehicles,
        storedSelected,
        storedTariffs,
        storedSelectedTariff,
        storedActiveShift,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.vehicles),
        AsyncStorage.getItem(STORAGE_KEYS.selectedVehicle),
        AsyncStorage.getItem(STORAGE_KEYS.tariffs),
        AsyncStorage.getItem(STORAGE_KEYS.selectedTariff),
        AsyncStorage.getItem(STORAGE_KEYS.activeShift),
      ]);

      debug('🔄 Smart Cache: Loading cached state and validating with server...');

      // Load cached vehicle/tariff data immediately for UI
      if (storedVehicles) {
        const parsed: DriverVehicle[] = JSON.parse(storedVehicles);
        setVehicles(parsed);
      }

      if (storedSelected) {
        const parsedSelected: DriverVehicle = JSON.parse(storedSelected);
        setSelectedVehicle(parsedSelected);
      }

      if (storedTariffs) {
        const parsedTariffs: Tariff[] = JSON.parse(storedTariffs);
        setTariffs(parsedTariffs);
      }

      if (storedSelectedTariff) {
        const parsedSelectedTariff: Tariff = JSON.parse(storedSelectedTariff);
        setSelectedTariff(parsedSelectedTariff);
      }

      // 🧠 SMART CACHE: Validate shift with server (company, driver, vehicle context)
      let cachedShift: ActiveShift | null = null;
      if (storedActiveShift) {
        try {
          const parsed = JSON.parse(storedActiveShift) as ActiveShift;
          cachedShift = parsed;
          const shiftAge = Date.now() - new Date(parsed.startTime).getTime();

          debug(`📦 Cached shift found: ${parsed.id}`);
          debug(`   Age: ${Math.floor(shiftAge / 1000 / 60)} minutes`);
          debug(`   Status: ${parsed.status}`);
        } catch (e) {
          console.error('Failed to parse cached shift:', e);
        }
      }

      // 🌐 Always validate with server for accurate state
      debug('🌐 Fetching current shift from server for validation...');
      let serverShift: ActiveShift | null = null;
      let serverQuerySucceeded = false;
      try {
        serverShift = await fetchCurrentShift();
        serverQuerySucceeded = true; // ✅ Query succeeded (even if result is null)
        if (serverShift) {
          debug(`✅ Server shift found: ${serverShift.id}`);
          debug(`   Status: ${serverShift.status}`);
        } else {
          debug('ℹ️ No active shift on server (query succeeded)');
        }
      } catch (error) {
        console.error('❌ Failed to fetch shift from server (network/API error):', error);
        debug('⚠️ Will trust cached data if available');
        serverQuerySucceeded = false; // ❌ Query failed
      }

      // 🚦 Pre-resume compliance gate. If either server or cache says there's
      // an active shift but the driver is no longer eligible (expired docs,
      // suspended company), we refuse to auto-resume and end the shift.
      if (serverShift || cachedShift) {
        const gateError = await checkShiftEligibility();
        if (gateError) {
          console.warn('🚫 Auto-resume blocked by compliance gate:', gateError);
          Toast.show({
            type: 'error',
            text1: 'Shift paused — tap to upload',
            text2: gateError,
            visibilityTime: 7000,
            onPress: () => {
              try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { navigate } = require('../navigation/navigationRef');
                navigate('Documents');
              } catch (_err) {
                /* noop */
              }
            },
          });
          try {
            await endDriverShift(null);
          } catch (endError) {
            console.warn('⚠️ Could not end shift on server after gate block', endError);
          }
          await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
          setActiveShift(null);
          notifyShiftEnded();
          return;
        }
      }

      // 🧠 SMART DECISION: Compare cache vs server
      if (serverShift) {
        // Server has a shift - this is the source of truth
        if (cachedShift && cachedShift.id === serverShift.id) {
          // Same shift - update cache with latest server data
          debug('✅ Smart Cache: Shift validated - updating with server data');
          setActiveShift(serverShift);
          await persistActiveShift(serverShift);
        } else if (cachedShift && cachedShift.id !== serverShift.id) {
          // Different shift - server has newer one
          console.warn('⚠️ Smart Cache: Shift mismatch - server has different shift');
          debug(`   Cached: ${cachedShift.id} | Server: ${serverShift.id}`);
          debug('   Using server shift (source of truth)');
          setActiveShift(serverShift);
          await persistActiveShift(serverShift);
        } else {
          // No cached shift but server has one - restore it
          debug('✅ Smart Cache: No cached shift - restoring from server');
          setActiveShift(serverShift);
          await persistActiveShift(serverShift);
        }
        
        // Notify system that shift is active
        notifyShiftStarted();
        
        await startOrUpdateForegroundService({
          status: "Available",
          duration: "0m",
          earnings: "$0.00",
          trips: 0,
        });
      } else if (cachedShift) {
        // No server shift but have cached one
        // 🔥 CRITICAL FIX: Always use server timestamp for age calculation
        // Don't trust lastShiftStartTime.current after app restart - it's reset
        const shiftAgeFromServerTimestamp = Date.now() - new Date(cachedShift.startTime).getTime();
        
        // 🔥 CRITICAL: If server query FAILED (not just returned null), always trust cache
        if (serverQuerySucceeded) {
          // Server query succeeded but returned no shift - validate age
          // Be lenient on app restart - server might be slow or network issue
          // Use 2 hours for app load (plenty of time), vs 5 min for in-session refresh
          const MAX_SHIFT_AGE_ON_APP_LOAD = 2 * 60 * 60 * 1000; // 2 hours
          
          debug(`🔍 Smart Cache Debug: Shift age on app load`, {
            cachedShiftId: cachedShift.id,
            startTimeFromServer: cachedShift.startTime,
            shiftAgeFromServerTimestamp: Math.floor(shiftAgeFromServerTimestamp / 1000) + 's',
            shiftAgeMinutes: Math.floor(shiftAgeFromServerTimestamp / 1000 / 60) + 'min',
            shiftAgeHours: Math.floor(shiftAgeFromServerTimestamp / 1000 / 60 / 60) + 'h',
            maxAgeAllowed: Math.floor(MAX_SHIFT_AGE_ON_APP_LOAD / 1000 / 60) + 'min',
            serverShiftFound: false,
            serverQuerySucceeded: true,
          });
          
          // 🧠 SMART LOGIC: Only clear cache if truly stale (>2 hours and not on server)
          if (shiftAgeFromServerTimestamp > MAX_SHIFT_AGE_ON_APP_LOAD) {
            // Cached shift is very old and server doesn't have it - was ended
            console.warn(`⚠️ Smart Cache: Cached shift is ${Math.floor(shiftAgeFromServerTimestamp / 1000 / 60)}min (${Math.floor(shiftAgeFromServerTimestamp / 1000 / 60 / 60)}h) old and not on server`);
            debug('   Shift was likely ended by server - clearing cache');
            await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
            setActiveShift(null);
          } else if (shiftAgeFromServerTimestamp < 0) {
            // Invalid timestamp (future date) - corrupted data
            console.error(`❌ Smart Cache: Invalid shift timestamp - clearing corrupted cache`);
            await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
            setActiveShift(null);
          } else {
            // Recent cached shift - trust it! Server might not have synced yet
            debug(`✅ Smart Cache: Shift is ${Math.floor(shiftAgeFromServerTimestamp / 1000 / 60)}min old - trusting cache`);
            debug('   Server will sync when available. Keeping shift active.');
            setActiveShift(cachedShift);
            notifyShiftStarted();
            
            // 🔥 CRITICAL: Update lastShiftStartTime for future refreshes
            // Use server timestamp as source of truth
            lastShiftStartTime.current = new Date(cachedShift.startTime).getTime();
            debug('📍 Restored shift start time tracking from server timestamp:', new Date(cachedShift.startTime).toLocaleString());
            
            // Try to restart foreground service
            await startOrUpdateForegroundService({
              status: "Available",
              duration: "0m",
              earnings: "$0.00",
              trips: 0,
            });
          }
        } else {
          // Server query FAILED - always trust cache regardless of age
          debug(`✅ Smart Cache: Server query failed - trusting cached shift ${cachedShift.id}`);
          debug('   Network/API error - will validate when connection restored');
          setActiveShift(cachedShift);
          notifyShiftStarted();
          
          // 🔥 CRITICAL: Restore shift start time tracking
          if (!lastShiftStartTime.current) {
            lastShiftStartTime.current = new Date(cachedShift.startTime).getTime();
            debug('📍 Restored shift start time tracking from cache');
          }
          
          // Try to restart foreground service
          await startOrUpdateForegroundService({
            status: "Available",
            duration: "0m",
            earnings: "$0.00",
            trips: 0,
          });
        }
      } else {
        // No shift anywhere - clean state
        debug('ℹ️ Smart Cache: No shift found (cache or server) - clean state');
        setActiveShift(null);
      }

    } catch (error) {
      console.error("Failed to load persisted shift state", error);
    }
  }, [persistActiveShift, driver?.firstName, startOrUpdateForegroundService]);

  // ✅ FIXED: Only load persisted state when driver is authenticated
  // This prevents race condition where refreshCurrentShift overwrites persisted state
  useEffect(() => {
    if (driver?.id) {
      loadPersistedState().catch((error) =>
        console.error("Shift bootstrap error", error)
      );
    }
  }, [driver?.id, loadPersistedState]);

  const persistVehicles = useCallback(
    async (vehicleList: DriverVehicle[]) => {
      setVehicles(vehicleList);
      await AsyncStorage.setItem(
        STORAGE_KEYS.vehicles,
        JSON.stringify(vehicleList)
      );

      if (vehicleList.length === 0) {
        setSelectedVehicle(null);
        await AsyncStorage.removeItem(STORAGE_KEYS.selectedVehicle);
      } else if (selectedVehicle) {
        const stillExists = vehicleList.some(
          (vehicle) => vehicle.id === selectedVehicle.id
        );
        if (!stillExists) {
          setSelectedVehicle(null);
          await AsyncStorage.removeItem(STORAGE_KEYS.selectedVehicle);
        }
      }
    },
    [selectedVehicle]
  );

  const persistTariffs = useCallback(
    async (tariffList: Tariff[]) => {
      setTariffs(tariffList);
      await AsyncStorage.setItem(
        STORAGE_KEYS.tariffs,
        JSON.stringify(tariffList)
      );

      if (tariffList.length === 0) {
        setSelectedTariff(null);
        await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
      } else if (selectedTariff) {
        const stillExists = tariffList.some(
          (tariff) => tariff.id === selectedTariff.id
        );
        if (!stillExists) {
          setSelectedTariff(null);
          await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
        }
      }
    },
    [selectedTariff]
  );

  const refreshVehicles = useCallback(async () => {
    try {
      setVehiclesLoading(true);
      setVehiclesError(null);
      const result = await fetchDriverVehicles();
      const mapped = parseVehiclesResponse(result);
      await persistVehicles(mapped);
    } catch (error) {
      console.error("Failed to fetch driver vehicles", error);
      setVehiclesError("Unable to load vehicles right now.");
    } finally {
      setVehiclesLoading(false);
    }
  }, [persistVehicles]);

  const clearSelection = useCallback(async () => {
    setSelectedVehicle(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedVehicle);
    setSelectedTariff(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
  }, []);

  const refreshTariffs = useCallback(
    async (companyId?: string): Promise<Tariff[]> => {
      try {
        setTariffsLoading(true);
        setTariffsError(null);
        
        // 🚨 REMOVED: Vehicle tariff fetching - IT WAS CAUSING INFINITE LOOP
        // The correct flow is: Company → Zone Selection → Zone Tariffs
        // NOT: Vehicle → Vehicle Tariffs (this concept doesn't exist)
        
        // ✅ Fetch company tariffs - user will select zone later
        const driverCompanyId = driver?.companyId || driver?.company?.id;
        const targetCompanyId = companyId || driverCompanyId;
        
        if (!targetCompanyId) {
          console.error("❌ No company ID found for driver:", {
            hasDriver: !!driver,
            directCompanyId: driver?.companyId,
            nestedCompanyId: driver?.company?.id,
            driverObject: driver,
          });
          setTariffsError("No company assigned to this driver. Please contact support.");
          setTariffs([]);
          return [];
        }

        debug(`🔄 Fetching company tariffs: ${targetCompanyId}`);
        const fetched = await fetchCompanyTariffs(targetCompanyId);
        await persistTariffs(fetched);

        // Auto-select default if none selected
        if (!selectedTariff && fetched.length > 0) {
          const defaultTariff = fetched.find((t) => t.isDefault) || fetched[0];
          if (defaultTariff) {
            setSelectedTariff(defaultTariff);
            await AsyncStorage.setItem(
              STORAGE_KEYS.selectedTariff,
              JSON.stringify(defaultTariff)
            );
            debug(`✅ Auto-selected default tariff: ${defaultTariff.name}`);
          }
        }

        debug(`✅ Loaded ${fetched.length} company tariffs`);
        return fetched;
      } catch (error) {
        console.error("Failed to load tariffs", error);
        setTariffsError(
          "Unable to load tariffs. Pull to refresh or contact support."
        );
        return [];
      } finally {
        setTariffsLoading(false);
      }
    },
    [persistTariffs, selectedTariff, driver?.companyId]
  );

  const selectVehicle = useCallback(async (vehicle: DriverVehicle | null) => {
    // Handle clearing vehicle selection
    if (!vehicle) {
      setSelectedVehicle(null);
      await AsyncStorage.removeItem(STORAGE_KEYS.selectedVehicle);
      debug('🔄 Vehicle selection cleared');
      return;
    }
    
    setSelectedVehicle(vehicle);
    await AsyncStorage.setItem(
      STORAGE_KEYS.selectedVehicle,
      JSON.stringify(vehicle)
    );
    
    // ✅ CRITICAL: Sync vehicle selection to backend (DriverPreferences)
    try {
      debug('🔄 Syncing vehicle selection to backend...');
      await httpClient.put('/mobile/driver/preferences', {
        vehicleId: vehicle.id,
      });
      debug('✅ Vehicle selection synced to backend');
    } catch (error) {
      console.warn('⚠️ Failed to sync vehicle to backend:', error);
      // Don't fail the selection if backend sync fails
    }
    
    // ✅ CRITICAL: Clear tariff selection and force refresh from API
    setSelectedTariff(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
    
    // ✅ Force refresh tariffs from API (not cache) when vehicle is selected
    debug('🔄 Vehicle selected - forcing tariff refresh from API');
    await refreshTariffs();
  }, [refreshTariffs]);

  const selectTariff = useCallback(async (tariff: Tariff) => {
    setSelectedTariff(tariff);
    await AsyncStorage.setItem(
      STORAGE_KEYS.selectedTariff,
      JSON.stringify(tariff)
    );
    
    // ✅ CRITICAL: Sync tariff selection to backend (DriverPreferences)
    try {
      debug('🔄 Syncing tariff selection to backend...');
      await httpClient.put('/mobile/driver/preferences', {
        tariffId: tariff.id,
      });
      debug('✅ Tariff selection synced to backend');
    } catch (error) {
      console.warn('⚠️ Failed to sync tariff to backend:', error);
      // Don't fail the selection if backend sync fails
    }
  }, []);

  const clearTariff = useCallback(async () => {
    setSelectedTariff(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
  }, []);

  // ✅ Lock to prevent multiple simultaneous refreshes
  const refreshingShift = useRef(false);
  const lastShiftStartTime = useRef<number>(0); // Track when shift was started
  const autoTariffRefreshInFlight = useRef(false);
  
  const refreshCurrentShift = useCallback(async () => {
    // ✅ CRITICAL FIX: Prevent race conditions from multiple simultaneous calls
    if (refreshingShift.current) {
      debug("⏭️ Skipping refreshCurrentShift - already in progress");
      return;
    }
    
    refreshingShift.current = true;
    
    try {
      debug('🔄 Smart Refresh: Validating shift with server...');
      const serverShift = await fetchCurrentShift();
      const storedShift = await AsyncStorage.getItem(STORAGE_KEYS.activeShift);
      
      let cachedShift: ActiveShift | null = null;
      let timeSinceShiftStart = 0;
      
      if (storedShift) {
        try {
          cachedShift = JSON.parse(storedShift);
          if (cachedShift?.startTime) {
            timeSinceShiftStart = Date.now() - new Date(cachedShift.startTime).getTime();
          }
        } catch (e) {
          console.error('Failed to parse stored shift:', e);
        }
      }

      // 🧠 SMART DECISION: Compare cache vs server
      if (serverShift && cachedShift) {
        if (serverShift.id === cachedShift.id) {
          // Same shift - update cache with latest server data (earnings, trips, etc)
          debug(`✅ Smart Refresh: Shift ${serverShift.id} validated - updating stats`);
          setActiveShift(serverShift);
          await persistActiveShift(serverShift);
          notifyShiftStarted();
        } else {
          // Different shifts - server has newer one
          console.warn(`⚠️ Smart Refresh: Shift mismatch - server has different shift`);
          debug(`   Cached: ${cachedShift.id} | Server: ${serverShift.id}`);
          debug('   Syncing to server shift');
          setActiveShift(serverShift);
          await persistActiveShift(serverShift);
          notifyShiftStarted();
        }
      } else if (serverShift && !cachedShift) {
        // Server has shift but no cache - restore it
        debug(`✅ Smart Refresh: Restoring shift ${serverShift.id} from server`);
        setActiveShift(serverShift);
        await persistActiveShift(serverShift);
        notifyShiftStarted();
      } else if (!serverShift && cachedShift) {
        // No server shift but have cached one
        // 🔥 CRITICAL FIX: Always use server timestamp for age calculation
        // lastShiftStartTime.current can be stale/corrupted after app restart
        const shiftAgeFromServerTimestamp = Date.now() - new Date(cachedShift.startTime).getTime();
        
        // Also check in-memory timestamp if available (for recently started shifts)
        const timeSinceMemoryStart = lastShiftStartTime.current 
          ? Date.now() - lastShiftStartTime.current 
          : null;
        
        debug(`🔍 Smart Refresh Debug: Shift age calculation`, {
          cachedShiftId: cachedShift.id,
          startTimeFromServer: cachedShift.startTime,
          shiftAgeFromServerTimestamp: Math.floor(shiftAgeFromServerTimestamp / 1000) + 's (' + Math.floor(shiftAgeFromServerTimestamp / 1000 / 60) + 'min)',
          lastShiftStartTime: lastShiftStartTime.current,
          timeSinceMemoryStart: timeSinceMemoryStart ? Math.floor(timeSinceMemoryStart / 1000) + 's' : 'not available',
          willUse: 'serverTimestamp (source of truth)',
        });
        
        // 🧠 Use 5 minutes grace period for active session refreshes
        const MAX_SHIFT_AGE_ACTIVE_SESSION = 5 * 60 * 1000; // 5 minutes
        
        if (shiftAgeFromServerTimestamp < MAX_SHIFT_AGE_ACTIVE_SESSION) {
          // Less than 5 minutes old - keep it (server might still be syncing)
          debug(`⏳ Smart Refresh: Recent shift (${Math.floor(shiftAgeFromServerTimestamp / 1000)}s old) not on server yet - keeping cache`);
          debug('   This is normal for newly started shifts - server needs time to propagate');
          // Don't change anything - keep cached shift
        } else {
          // Older than 5 minutes and not on server - was truly ended
          console.warn(`⚠️ Smart Refresh: Cached shift (${Math.floor(shiftAgeFromServerTimestamp / 1000 / 60)}min old) not on server - was ended`);
          debug('   Clearing cache to match server');
          setActiveShift(null);
          await persistActiveShift(null);
          notifyShiftEnded();
          
          Toast.show({
            type: 'info',
            text1: 'Shift Ended',
            text2: 'Your shift was ended. Syncing app state.',
            position: 'top',
          });
        }
      } else {
        // No shift anywhere - clean state
        debug('ℹ️ Smart Refresh: No active shift (cache or server)');
        setActiveShift(null);
        await persistActiveShift(null);
        notifyShiftEnded();
      }
    } catch (error) {
      console.error("Failed to refresh current shift", error);
    } finally {
      refreshingShift.current = false;
    }
  }, [persistActiveShift]);

  const startShift = useCallback(
    async (payload: StartShiftPayload) => {
      debug('🚀 Starting shift with payload:', payload);

      // 🚦 Pre-shift compliance gate: license / insurance / company status.
      const gateError = await checkShiftEligibility();
      if (gateError) {
        console.warn('🚫 Shift blocked by compliance gate:', gateError);
        Toast.show({
          type: 'error',
          text1: 'Cannot start shift — tap to upload',
          text2: gateError,
          visibilityTime: 7000,
          onPress: () => {
            try {
              // Lazy import to avoid a circular dep: navigation → contexts → here
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { navigate } = require('../navigation/navigationRef');
              navigate('Documents');
            } catch (_err) {
              /* noop */
            }
          },
        });
        throw new Error(gateError);
      }

      const response = await startDriverShift(payload);
      
      debug('📦 Shift start response:', {
        hasResponse: !!response,
        hasShift: !!response.shift,
        shiftId: response.shift?.id,
        shiftStatus: response.shift?.status,
        shiftStartTime: response.shift?.startTime,
        hasActiveZones: response.activeZones && response.activeZones.length > 0,
        zonesCount: response.activeZones?.length || 0,
      });
      
      if (!response.shift?.id) {
        console.error('❌ CRITICAL: Shift response missing ID!', response);
        throw new Error('Invalid shift response - missing shift ID');
      }
      
      setActiveShift(response.shift);
      debug('✅ activeShift state set:', {
        id: response.shift.id,
        status: response.shift.status,
        startTime: response.shift.startTime,
      });
      
      // 🔥 CRITICAL: Track when shift was started to prevent premature clearing
      lastShiftStartTime.current = Date.now();
      debug('⏱️ Shift start time recorded:', new Date().toLocaleTimeString());
      
      // ✅ Persist shift immediately when started
      await persistActiveShift(response.shift);
      debug('💾 Shift persisted to AsyncStorage');
      
      // ✅ REMOVED: refreshCurrentShift() - we already have the shift from startDriverShift response
      // Calling refreshCurrentShift might overwrite if server doesn't return the shift immediately

      // Enable heartbeat when shift starts
      notifyShiftStarted();
      debug('💓 Heartbeat notifications enabled');
      
      await startOrUpdateForegroundService({
        status: "Available",
        duration: "0m",
        earnings: "$0.00",
        trips: 0,
      });

      try {
        await ForegroundService.saveDriverData(
          driver?.id || '',
          response.shift.id,
          (await AsyncStorage.getItem('authToken')) || ''
        );
        debug('💓 Driver data saved for native heartbeat');
      } catch (error) {
        console.error('❌ Failed to save driver data for heartbeat:', error);
      }
      
      debug('✅ Shift start complete - returning to caller');
    },
    [persistActiveShift, driver?.firstName, driver?.id, startOrUpdateForegroundService]
  );

  useEffect(() => {
    if (!driver?.companyId) {
      return;
    }
    if (tariffsLoading) {
      return;
    }

    const needsTariffs = tariffs.length === 0;
    const missingSelection = !selectedTariff;

    if (!needsTariffs && !missingSelection) {
      return;
    }

    if (autoTariffRefreshInFlight.current) {
      return;
    }

    autoTariffRefreshInFlight.current = true;
    refreshTariffs(driver.companyId)
      .catch((error) => {
        console.warn("⚠️ Auto tariff refresh failed:", error);
      })
      .finally(() => {
        autoTariffRefreshInFlight.current = false;
      });
  }, [
    driver?.companyId,
    tariffs.length,
    selectedTariff?.id,
    tariffsLoading,
    refreshTariffs,
  ]);

  const endShift = useCallback(async (locationOverride?: { latitude: number; longitude: number; accuracy?: number; heading?: number; speed?: number } | null) => {
    // 🔥 CRITICAL: Check if there's actually an active shift to end
    // This prevents duplicate calls and "No active shift found" errors
    if (!activeShift) {
      debug('⚠️ endShift called but no active shift exists - skipping');
      return;
    }
    
    debug('🛑 endShift called for shift:', activeShift.id, 'with location:', locationOverride ? 'provided' : 'will use fallback');
    
    try {
      await endDriverShift(locationOverride);
      debug('✅ Shift ended successfully on backend');
    } catch (error: any) {
      console.error('❌ Failed to end shift on backend:', error);
      
      // If the shift doesn't exist on backend (already ended), don't throw error
      if (error?.response?.status === 400 && error?.response?.data?.message?.includes('No active shift')) {
        debug('⚠️ Shift already ended on backend, cleaning up local state');
      } else {
        // Re-throw other errors so they can be handled by the caller
        throw error;
      }
    } finally {
      // Always clean up local state, even if backend call fails
      setActiveShift(null);
      
      // ✅ NEW: Clear persisted shift when ended
      await persistActiveShift(null);
      
      // ✅ REMOVED: refreshCurrentShift() - we just ended the shift, no need to fetch again
      // This was causing shift to be cleared multiple times

      // Disable heartbeat when shift ends
      notifyShiftEnded();
      
      // 🔥 CRITICAL: Stop foreground service
      try {
        await ForegroundService.stop();
        debug('✅ Foreground service stopped');
        // 💓 Clear driver data for heartbeat
        await ForegroundService.clearDriverData();
        debug('💓 Driver data cleared');
      } catch (error) {
        console.error('❌ Failed to stop foreground service:', error);
        // Don't fail the shift end if foreground service stop fails
      } finally {
        foregroundServiceStartedRef.current = false;
      }
    }
  }, [persistActiveShift, activeShift]);

  const refreshRecentJobs = useCallback(async (limit = 3) => {
    try {
      setRecentJobsLoading(true);
      const jobs = await fetchRecentJobs(limit);
      setRecentJobs(
        jobs
          .slice()
          .sort((a, b) => {
            const timeA = new Date(a.completedAt || a.createdAt || 0).getTime();
            const timeB = new Date(b.completedAt || b.createdAt || 0).getTime();
            return timeB - timeA;
          })
      );
    } catch (error) {
      console.error("Failed to load recent jobs", error);
    } finally {
      setRecentJobsLoading(false);
    }
  }, []);

  const resetShiftState = useCallback(async () => {
    setVehicles([]);
    setSelectedVehicle(null);
    setVehiclesError(null);
    setSelectedTariff(null);
    setTariffs([]);
    setTariffsError(null);
    setActiveShift(null);
    setRecentJobs([]);
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.selectedVehicle,
      STORAGE_KEYS.vehicles,
      STORAGE_KEYS.selectedTariff,
      STORAGE_KEYS.tariffs,
    ]);
  }, []);

  const updateForegroundMetrics = useCallback(
    async (shift: ActiveShift) => {
      if (Platform.OS !== "android") {
        return;
      }

      const statusLabel = formatShiftStatusLabel(shift.status);
      const durationLabel = formatShiftDurationLabel(shift);
      const earningsLabel = formatShiftEarnings(shift.stats?.totalEarnings);
      const trips = getTripsCount(shift.stats?.totalRides);

      await startOrUpdateForegroundService({
        status: statusLabel,
        duration: durationLabel,
        earnings: earningsLabel,
        trips,
      });
    },
    [startOrUpdateForegroundService]
  );

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    if (!activeShift) {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
        notificationIntervalRef.current = null;
      }
      return;
    }

    const pushUpdate = () => {
      void updateForegroundMetrics(activeShift);
    };

    pushUpdate();

    if (notificationIntervalRef.current) {
      clearInterval(notificationIntervalRef.current);
    }

    notificationIntervalRef.current = setInterval(pushUpdate, 10 * 60 * 1000);

    return () => {
      if (notificationIntervalRef.current) {
        clearInterval(notificationIntervalRef.current);
        notificationIntervalRef.current = null;
      }
    };
  }, [activeShift, updateForegroundMetrics]);

  // Fetch shift data only when driver is authenticated
  useEffect(() => {
    if (!driver?.id) {
      return;
    }
    
    // ✅ REMOVED refreshCurrentShift() call here - it's already called from loadPersistedState
    // This prevents race condition where two calls compete and overwrite each other
    
    refreshRecentJobs(3).catch((error) =>
      console.error("Initial recent jobs fetch failed", error)
    );

    // Register shift restoration callback for socket reconnections
    // This ensures driver stays in shift even if socket disconnects
    registerShiftRestoration(async () => {
      debug("🔄 Shift restoration triggered by socket reconnection");

      // ✅ FIXED: Don't fetch from server on socket reconnect
      // Just re-notify with the current activeShift in state
      // Fetching from server might return null and wipe out the shift

      // Re-read from AsyncStorage to get the most recent shift
      const storedShift = await AsyncStorage.getItem(STORAGE_KEYS.activeShift);
      if (!storedShift) {
        debug("ℹ️ No shift to restore on socket reconnection");
        return;
      }

      // 🚦 Re-run the same compliance gate used on cold-start auto-resume.
      // A driver who was offline while their license expired, their insurance
      // lapsed, or their company was suspended must not silently resume.
      const gateError = await checkShiftEligibility();
      if (gateError) {
        console.warn('🚫 Reconnect resume blocked by compliance gate:', gateError);
        Toast.show({
          type: 'error',
          text1: 'Shift paused — tap to upload',
          text2: gateError,
          visibilityTime: 7000,
          onPress: () => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { navigate } = require('../navigation/navigationRef');
              navigate('Documents');
            } catch (_err) {
              /* noop */
            }
          },
        });
        try {
          await endDriverShift(null);
        } catch (endError) {
          console.warn('⚠️ Could not end shift on server after reconnect gate block', endError);
        }
        await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
        setActiveShift(null);
        notifyShiftEnded();
        return;
      }

      const parsedShift: ActiveShift = JSON.parse(storedShift);
      setActiveShift(parsedShift);
      notifyShiftStarted();
      debug("✅ Shift re-notified after socket reconnection:", parsedShift.id);
    });

    // ✅ NEW: Register listener for complete driver state from server
    // This receives shift, vehicle, tariff in ONE event when driver authenticates
    const handleDriverStateRestoration = (state: any) => {
      debug('🔄 ShiftContext: Received driver state from server');
      
      // Restore shift
      if (state.shift) {
        const serverShift: ActiveShift = {
          id: state.shift.id,
          status: state.shift.status,
          startTime: state.shift.startTime,
        };
        setActiveShift(serverShift);
        persistActiveShift(serverShift);
        debug(`✅ ShiftContext: Shift restored: ${serverShift.id}`);
      }
      
      // Restore vehicle
      if (state.vehicle) {
        const serverVehicle: DriverVehicle = {
          id: state.vehicle.id,
          licensePlate: state.vehicle.plateNumber || state.vehicle.licensePlate,
          make: state.vehicle.make,
          model: state.vehicle.model,
          year: state.vehicle.year,
          color: state.vehicle.color,
          vehicleType: state.vehicle.type,
        };
        setSelectedVehicle(serverVehicle);
        AsyncStorage.setItem(STORAGE_KEYS.selectedVehicle, JSON.stringify(serverVehicle));
        debug(`✅ ShiftContext: Vehicle restored: ${serverVehicle.licensePlate}`);
      }
      
      // Restore tariff
      if (state.tariff) {
        const serverTariff: Tariff = {
          id: state.tariff.id,
          name: state.tariff.name,
          baseFare: state.tariff.baseFare,
          perKmRate: state.tariff.perKmRate,
          perMinuteRate: state.tariff.perMinuteRate,
          minimumFare: state.tariff.minimumFare || 0,
          waitingTimeRate: state.tariff.waitingTimeRate,
        };
        setSelectedTariff(serverTariff);
        AsyncStorage.setItem(STORAGE_KEYS.selectedTariff, JSON.stringify(serverTariff));
        debug(`✅ ShiftContext: Tariff restored: ${serverTariff.name}`);
      }
      
      debug('✅ ShiftContext: Complete state restoration finished');
    };
    
    registerDriverStateRestoration(handleDriverStateRestoration);
    debug('✅ ShiftContext: Registered for driver state restoration');
    
    // ✅ FIX: CLEANUP on unmount to prevent callback accumulation
    return () => {
      unregisterDriverStateRestoration(handleDriverStateRestoration);
      debug('🧹 ShiftContext: State restoration listener unregistered');
    };
  }, [driver?.id, refreshRecentJobs, persistActiveShift]); // ✅ Added persistActiveShift to deps

  const value = useMemo<ShiftContextValue>(
    () => ({
      vehicles,
      vehiclesLoading,
      vehiclesError,
      selectedVehicle,
      selectedTariff,
      tariffs,
      tariffsLoading,
      tariffsError,
      activeShift,
      recentJobs,
      recentJobsLoading,
      refreshVehicles,
      selectVehicle,
      clearSelection,
      refreshTariffs,
      selectTariff,
      clearTariff,
      refreshCurrentShift,
      startShift,
      endShift,
      refreshRecentJobs,
      resetShiftState,
    }),
    [
      vehicles,
      vehiclesLoading,
      vehiclesError,
      selectedVehicle,
      selectedTariff,
      tariffs,
      tariffsLoading,
      tariffsError,
      activeShift,
      recentJobs,
      recentJobsLoading,
      refreshVehicles,
      selectVehicle,
      clearSelection,
      refreshTariffs,
      selectTariff,
      clearTariff,
      refreshCurrentShift,
      startShift,
      endShift,
      refreshRecentJobs,
      resetShiftState,
    ]
  );

  return (
    <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
  );
};

export const useShift = (): ShiftContextValue => useContext(ShiftContext);
