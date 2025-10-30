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
import Toast from "react-native-toast-message";
import {
  endDriverShift,
  fetchCompanyTariffs,
  fetchCurrentShift,
  fetchDriverVehicles,
  fetchRideHistory,
  startDriverShift,
} from "../services/driverService";
import {
  notifyShiftEnded,
  notifyShiftStarted,
  registerDriverStateRestoration, // ✅ FIX: For cleanup
  registerShiftRestoration,
  unregisterDriverStateRestoration, // ✅ FIX: For cleanup
} from "../services/driverSocket";
import { ForegroundService } from "../services/foregroundService"; // ✅ NEW: Foreground service
import { RideSummary } from "../types/rides";
import { ActiveShift, StartShiftPayload } from "../types/shift";
import { Tariff } from "../types/tariff";
import { DriverVehicle, DriverVehiclesResponse } from "../types/vehicle";
import { useAuth } from "./AuthContext";

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
  rideHistory: RideSummary[];
  rideHistoryLoading: boolean;
  refreshVehicles: () => Promise<void>;
  selectVehicle: (vehicle: DriverVehicle) => Promise<void>;
  clearSelection: () => Promise<void>;
  refreshTariffs: (companyId?: string) => Promise<Tariff[]>;
  selectTariff: (tariff: Tariff) => Promise<void>;
  clearTariff: () => Promise<void>;
  refreshCurrentShift: () => Promise<void>;
  startShift: (payload: StartShiftPayload) => Promise<void>;
  endShift: () => Promise<void>;
  refreshRideHistory: (limit?: number) => Promise<void>;
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
  rideHistory: [],
  rideHistoryLoading: false,
  refreshVehicles: async () => {},
  selectVehicle: async () => {},
  clearSelection: async () => {},
  refreshTariffs: async () => [],
  selectTariff: async () => {},
  clearTariff: async () => {},
  refreshCurrentShift: async () => {},
  startShift: async () => {},
  endShift: async () => {},
  refreshRideHistory: async () => {},
  resetShiftState: async () => {},
});

const STORAGE_KEYS = {
  selectedVehicle: "selectedVehicle",
  vehicles: "driverVehicles",
  selectedTariff: "selectedTariff",
  tariffs: "driverTariffs",
  activeShift: "activeShift", // ✅ NEW: Persist active shift
};

const parseVehiclesResponse = (
  response: DriverVehiclesResponse | undefined
): DriverVehicle[] => {
  if (!response) {
    return [];
  }
  return response.vehicles ?? [];
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
  const [rideHistory, setRideHistory] = useState<RideSummary[]>([]);
  const [rideHistoryLoading, setRideHistoryLoading] = useState(false);
  const { driver } = useAuth();

  // ✅ Persist active shift to AsyncStorage (defined early to avoid hoisting issues)
  const persistActiveShift = useCallback(async (shift: ActiveShift | null) => {
    try {
      if (shift) {
        await AsyncStorage.setItem(STORAGE_KEYS.activeShift, JSON.stringify(shift));
        console.log("💾 Persisted active shift:", shift.id);
      } else {
        await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
        console.log("💾 Cleared persisted shift");
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
        storedActiveShift, // ✅ NEW: Load persisted shift
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.vehicles),
        AsyncStorage.getItem(STORAGE_KEYS.selectedVehicle),
        AsyncStorage.getItem(STORAGE_KEYS.tariffs),
        AsyncStorage.getItem(STORAGE_KEYS.selectedTariff),
        AsyncStorage.getItem(STORAGE_KEYS.activeShift), // ✅ NEW
      ]);

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

      // ✅ NEW: Restore active shift from storage ONLY if vehicle and tariff are also selected
      if (storedActiveShift && storedSelected && storedSelectedTariff) {
        const parsedShift: ActiveShift = JSON.parse(storedActiveShift);
        setActiveShift(parsedShift);
        console.log("✅ Restored active shift from storage:", parsedShift.id);
        
        // ✅ FIXED: Just notify shift started, don't call refreshCurrentShift
        // Calling refreshCurrentShift would overwrite the restored shift if server returns null
        // The socket connection will keep driver online and sync state
        notifyShiftStarted();
        
        console.log("📡 Shift restored and socket notified - driver is online");
        
        // 🔥 CRITICAL: Restart foreground service when shift is restored
        // This ensures the app stays alive even after being killed
        try {
          await ForegroundService.start({
            driverName: driver?.firstName || 'Driver',
            status: 'Available',
            duration: '0h 0m', // Will be updated with actual stats
            earnings: '$0.00',
            trips: 0,
          });
          console.log('✅ Foreground service restarted - app will stay alive!');
        } catch (error) {
          console.error('❌ Failed to restart foreground service:', error);
        }
      } else if (storedActiveShift && (!storedSelected || !storedSelectedTariff)) {
        // 🔥 NEW FIX: If shift exists but vehicle/tariff not selected, clear the shift
        // User must go through vehicle/tariff selection first
        console.log("⚠️ Shift found but vehicle/tariff not selected - clearing shift");
        await AsyncStorage.removeItem(STORAGE_KEYS.activeShift);
        setActiveShift(null);
      } else {
        // ✅ Only fetch from server if we don't have a persisted shift
        console.log("ℹ️ No persisted shift found - checking server");
        try {
          const serverShift = await fetchCurrentShift();
          
          // 🔥 NEW FIX: Only restore shift from server if vehicle/tariff are selected
          if (serverShift && storedSelected && storedSelectedTariff) {
            setActiveShift(serverShift);
            await persistActiveShift(serverShift);
            notifyShiftStarted();
            console.log("✅ Shift fetched from server and restored");
          } else if (serverShift && (!storedSelected || !storedSelectedTariff)) {
            // Server has shift but no vehicle/tariff selected - user must select first
            console.log("⚠️ Server has shift but vehicle/tariff not selected - user must select first");
            // Don't set the shift, let user go through selection flow
          } else {
            console.log("ℹ️ No active shift on server");
          }
        } catch (error) {
          console.error("Failed to fetch shift from server", error);
        }
      }
    } catch (error) {
      console.error("Failed to load persisted shift state", error);
    }
  }, [persistActiveShift, driver?.firstName]);

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

  const selectVehicle = useCallback(async (vehicle: DriverVehicle) => {
    setSelectedVehicle(vehicle);
    await AsyncStorage.setItem(
      STORAGE_KEYS.selectedVehicle,
      JSON.stringify(vehicle)
    );
    setSelectedTariff(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
  }, []);

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
        
        // Get company ID from driver (handle both companyId and company.id)
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

        console.log(`🔄 Fetching tariffs for company: ${targetCompanyId}`);
        const fetched = await fetchCompanyTariffs(targetCompanyId);
        await persistTariffs(fetched);

        // Auto-select default if none selected
        if (!selectedTariff) {
          const defaultTariff = fetched.find((t) => t.isDefault) || fetched[0];
          if (defaultTariff) {
            setSelectedTariff(defaultTariff);
            await AsyncStorage.setItem(
              STORAGE_KEYS.selectedTariff,
              JSON.stringify(defaultTariff)
            );
          }
        }

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

  const selectTariff = useCallback(async (tariff: Tariff) => {
    setSelectedTariff(tariff);
    await AsyncStorage.setItem(
      STORAGE_KEYS.selectedTariff,
      JSON.stringify(tariff)
    );
  }, []);

  const clearTariff = useCallback(async () => {
    setSelectedTariff(null);
    await AsyncStorage.removeItem(STORAGE_KEYS.selectedTariff);
  }, []);

  // ✅ Lock to prevent multiple simultaneous refreshes
  const refreshingShift = useRef(false);
  
  const refreshCurrentShift = useCallback(async () => {
    // ✅ CRITICAL FIX: Prevent race conditions from multiple simultaneous calls
    if (refreshingShift.current) {
      console.log("⏭️ Skipping refreshCurrentShift - already in progress");
      return;
    }
    
    refreshingShift.current = true;
    
    try {
      const shift = await fetchCurrentShift();
      
      // ✅ CRITICAL FIX: Don't overwrite persisted shift with null from server
      // Server might not have shift cached, but AsyncStorage does
      // Only update if we got a valid shift, or if there's no persisted shift
      const storedShift = await AsyncStorage.getItem(STORAGE_KEYS.activeShift);
      
      if (shift) {
        // Got shift from server - update everything
        setActiveShift(shift);
        await persistActiveShift(shift);
        notifyShiftStarted();
        console.log("✅ Shift fetched from server and persisted:", shift.id);
      } else if (!storedShift) {
        // No shift from server AND no persisted shift - clear state
        setActiveShift(null);
        await persistActiveShift(null);
        notifyShiftEnded();
        console.log("ℹ️ No shift on server or in storage - cleared state");
      } else {
        // ❌ SYNC ISSUE: Mobile has shift, server doesn't
        console.warn("⚠️ SHIFT SYNC MISMATCH:");
        console.warn(`   📱 Mobile cached shift: ${storedShift?.id} (status: ${storedShift?.status})`);
        console.warn(`   🖥️  Server says: No active shift found`);
        console.warn(`   🔍 Reason: Shift was ended on server, but mobile didn't get notification`);
        console.warn(`   ✅ Fix: Syncing mobile to match server (server is source of truth)`);
        
        // ✅ FIX: Sync mobile state to match server
        setActiveShift(null);
        await persistActiveShift(null);
        
        // Stop location tracking since shift ended
        console.log("🛑 Stopping location tracking (shift ended)");
        
        Toast.show({
          type: 'info',
          text1: 'Shift Ended',
          text2: 'Your shift was ended. Syncing app state.',
          position: 'top',
        });
        
        console.log("✅ Mobile state synced - shift cleared to match server");
      }
    } catch (error) {
      console.error("Failed to load current shift", error);
    } finally {
      refreshingShift.current = false;
    }
  }, [persistActiveShift]);

  const startShift = useCallback(
    async (payload: StartShiftPayload) => {
      const response = await startDriverShift(payload);
      setActiveShift(response.shift);
      
      // ✅ NEW: Persist shift immediately when started
      await persistActiveShift(response.shift);
      
      // ✅ REMOVED: refreshCurrentShift() - we already have the shift from startDriverShift response
      // Calling refreshCurrentShift might overwrite if server doesn't return the shift immediately

      // Enable heartbeat when shift starts
      notifyShiftStarted();
      
      // 🔥 CRITICAL: Start foreground service to keep app alive
      try {
        await ForegroundService.start({
          driverName: driver?.firstName || 'Driver',
          status: 'Available',
          duration: '0h 0m',
          earnings: '$0.00',
          trips: 0,
        });
        console.log('✅ Foreground service started - app will stay alive!');
        
        // 💓 CRITICAL: Save driver data for native heartbeat
        await ForegroundService.saveDriverData(
          driver?.id || '',
          response.shift.id, // ✅ FIX: Use response.shift, not shift
          await AsyncStorage.getItem('authToken') || ''
        );
        console.log('💓 Driver data saved for native heartbeat');
      } catch (error) {
        console.error('❌ Failed to start foreground service:', error);
        // Don't fail the shift start if foreground service fails
      }
    },
    [persistActiveShift, driver?.firstName]
  );

  const endShift = useCallback(async () => {
    try {
      await endDriverShift();
    } finally {
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
        console.log('✅ Foreground service stopped');
        
        // 💓 Clear driver data for heartbeat
        await ForegroundService.clearDriverData();
        console.log('💓 Driver data cleared');
      } catch (error) {
        console.error('❌ Failed to stop foreground service:', error);
        // Don't fail the shift end if foreground service stop fails
      }
    }
  }, [persistActiveShift]);

  const refreshRideHistory = useCallback(async (limit = 3) => {
    try {
      setRideHistoryLoading(true);
      const history = await fetchRideHistory(limit);
      setRideHistory(history);
    } catch (error) {
      console.error("Failed to load ride history", error);
    } finally {
      setRideHistoryLoading(false);
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
    setRideHistory([]);
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.selectedVehicle,
      STORAGE_KEYS.vehicles,
      STORAGE_KEYS.selectedTariff,
      STORAGE_KEYS.tariffs,
    ]);
  }, []);

  // Fetch shift data only when driver is authenticated
  useEffect(() => {
    if (!driver?.id) {
      return;
    }
    
    // ✅ REMOVED refreshCurrentShift() call here - it's already called from loadPersistedState
    // This prevents race condition where two calls compete and overwrite each other
    
    refreshRideHistory(3).catch((error) =>
      console.error("Initial ride history fetch failed", error)
    );

    // Register shift restoration callback for socket reconnections
    // This ensures driver stays in shift even if socket disconnects
    registerShiftRestoration(async () => {
      console.log("🔄 Shift restoration triggered by socket reconnection");
      
      // ✅ FIXED: Don't fetch from server on socket reconnect
      // Just re-notify with the current activeShift in state
      // Fetching from server might return null and wipe out the shift
      
      // Re-read from AsyncStorage to get the most recent shift
      const storedShift = await AsyncStorage.getItem(STORAGE_KEYS.activeShift);
      if (storedShift) {
        const parsedShift: ActiveShift = JSON.parse(storedShift);
        setActiveShift(parsedShift);
        notifyShiftStarted();
        console.log("✅ Shift re-notified after socket reconnection:", parsedShift.id);
      } else {
        console.log("ℹ️ No shift to restore on socket reconnection");
      }
    });

    // ✅ NEW: Register listener for complete driver state from server
    // This receives shift, vehicle, tariff in ONE event when driver authenticates
    const handleDriverStateRestoration = (state: any) => {
      console.log('🔄 ShiftContext: Received driver state from server');
      
      // Restore shift
      if (state.shift) {
        const serverShift: ActiveShift = {
          id: state.shift.id,
          status: state.shift.status,
          startTime: state.shift.startTime,
        };
        setActiveShift(serverShift);
        persistActiveShift(serverShift);
        console.log(`✅ ShiftContext: Shift restored: ${serverShift.id}`);
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
        console.log(`✅ ShiftContext: Vehicle restored: ${serverVehicle.licensePlate}`);
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
        console.log(`✅ ShiftContext: Tariff restored: ${serverTariff.name}`);
      }
      
      console.log('✅ ShiftContext: Complete state restoration finished');
    };
    
    registerDriverStateRestoration(handleDriverStateRestoration);
    console.log('✅ ShiftContext: Registered for driver state restoration');
    
    // ✅ FIX: CLEANUP on unmount to prevent callback accumulation
    return () => {
      unregisterDriverStateRestoration(handleDriverStateRestoration);
      console.log('🧹 ShiftContext: State restoration listener unregistered');
    };
  }, [driver?.id, refreshRideHistory, persistActiveShift]); // ✅ Added persistActiveShift to deps

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
      rideHistory,
      rideHistoryLoading,
      refreshVehicles,
      selectVehicle,
      clearSelection,
      refreshTariffs,
      selectTariff,
      clearTariff,
      refreshCurrentShift,
      startShift,
      endShift,
      refreshRideHistory,
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
      rideHistory,
      rideHistoryLoading,
      refreshVehicles,
      selectVehicle,
      clearSelection,
      refreshTariffs,
      selectTariff,
      clearTariff,
      refreshCurrentShift,
      startShift,
      endShift,
      refreshRideHistory,
      resetShiftState,
    ]
  );

  return (
    <ShiftContext.Provider value={value}>{children}</ShiftContext.Provider>
  );
};

export const useShift = (): ShiftContextValue => useContext(ShiftContext);
