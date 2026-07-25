import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { AppState, AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { registerZoneChangeListener } from "../services/driverSocket";
import {
    getZoneTariffs,
    Zone,
    ZoneTariff,
} from "../services/zoneService";
import { getDriverCompanyId } from "../utils/driverHelpers";
import { useAuth } from "./AuthContext";
import { useShift } from "./ShiftContext";

// Persisted zone snapshot. Lets us re-paint the home/offer screens
// instantly when the app comes back from background instead of going
// blank ("No zone detected") for the second or two it takes the server
// to re-send `driver:zone:changed`.
const ZONE_STORAGE_KEY = "@driver_current_zone_v1";
type PersistedZoneSnapshot = {
  zone: Zone | null;
  tariffs: ZoneTariff[];
  cachedAt: number;
};

// Server now handles zone detection - no client-side checking needed
// Mobile app just listens for zone change events from server

type ZoneContextValue = {
  currentZone: Zone | null;
  zoneTariffs: ZoneTariff[];
  recommendedTariffId: string | null;
  autoSelectedTariffId: string | null;
  manualTariffId: string | null;
  loading: boolean;
  lastUpdatedAt: number | null;
  error: string | null;
  /** true when driver was previously in a zone but has now left it */
  isOutOfZone: boolean;
  /** The name of the zone the driver left (for display) */
  lastKnownZoneName: string | null;
  forceRefresh: () => Promise<void>;
  setManualTariff: (tariffId: string | null) => void;
  dismissOutOfZone: () => void;
};

const defaultZoneContext: ZoneContextValue = {
  currentZone: null,
  zoneTariffs: [],
  recommendedTariffId: null,
  autoSelectedTariffId: null,
  manualTariffId: null,
  loading: false,
  lastUpdatedAt: null,
  error: null,
  isOutOfZone: false,
  lastKnownZoneName: null,
  forceRefresh: async () => {},
  setManualTariff: () => {},
  dismissOutOfZone: () => {},
};

const ZoneContext = createContext<ZoneContextValue>(defaultZoneContext);

export const ZoneProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { driver } = useAuth();
  const { selectedTariff, selectTariff } = useShift();

  const [currentZone, setCurrentZone] = useState<Zone | null>(null);
  const [zoneTariffs, setZoneTariffs] = useState<ZoneTariff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [manualTariffIdState, setManualTariffIdState] = useState<string | null>(
    null
  );
  const [autoSelectedTariffId, setAutoSelectedTariffId] = useState<
    string | null
  >(null);

  const manualTariffIdRef = useRef<string | null>(null);
  // Sentinel: undefined = no zone:change event received yet, null = server
  // confirmed driver is outside all zones, string = current zoneId. We
  // need the three-state distinction so the very first server event,
  // even if it says "null", isn't silenced by the dedup guard below.
  const lastZoneIdRef = useRef<string | null | undefined>(undefined);
  const [isOutOfZone, setIsOutOfZone] = useState(false);
  const [lastKnownZoneName, setLastKnownZoneName] = useState<string | null>(null);
  const hadZoneRef = useRef(false);

  const dismissOutOfZone = useCallback(() => {
    setIsOutOfZone(false);
  }, []);

  const setManualTariff = useCallback((tariffId: string | null) => {
    manualTariffIdRef.current = tariffId;
    setManualTariffIdState(tariffId);
    if (tariffId) {
      setAutoSelectedTariffId(null);
    }
  }, []);

  // Automatically apply recommended tariff when zone/tariffs change
  const applyRecommendedTariff = useCallback(
    async (tariffs: ZoneTariff[]) => {
      const recommended =
        tariffs.find((item) => item.tariff.isDefault) || tariffs[0];
      if (!recommended) {
        setAutoSelectedTariffId(null);
        return;
      }

      if (selectedTariff?.id === recommended.tariff.id) {
        setAutoSelectedTariffId(recommended.tariff.id);
        return;
      }

      try {
        await selectTariff(recommended.tariff);
        setAutoSelectedTariffId(recommended.tariff.id);
        console.log(`✅ Auto-selected tariff: ${recommended.tariff.name}`);
      } catch (selectionError) {
        console.error(
          "Failed to auto-select recommended tariff",
          selectionError
        );
      }
    },
    [selectTariff, selectedTariff?.id]
  );

  // Handle zone changes from server (server-side detection)
  const handleZoneChange = useCallback(
    async (data: { zoneId: string | null; zoneName: string | null }) => {
      const { zoneId, zoneName } = data;
      const previousZoneId = lastZoneIdRef.current;
      
      // ✅ FIX: Check if zone actually changed BEFORE logging to reduce spam
      if (previousZoneId === zoneId) {
        // Silently skip - no log spam
        return;
      }
      
      // Only log when zone ACTUALLY changes
      console.log("📍 Zone change processing:", {
        from: previousZoneId,
        to: zoneId,
        zoneName
      });
      
      lastZoneIdRef.current = zoneId;
      setLastUpdatedAt(Date.now());
      setError(null);
      
      if (zoneId) {
        // Driver entered a zone — clear out-of-zone alert
        hadZoneRef.current = true;
        setIsOutOfZone(false);
        setLastKnownZoneName(zoneName || "Unknown Zone");

        // Driver entered a zone - fetch tariffs
        console.log(`🔄 Fetching tariffs for zone: ${zoneName} (${zoneId})`);
        
        try {
          const tariffs = await getZoneTariffs(zoneId);
          const companyId = getDriverCompanyId(driver);
          
          setCurrentZone({
            id: zoneId,
            name: zoneName || "Unknown Zone",
            coordinates: [],
            isActive: true,
            companyId: companyId || "",
          });
          
          setZoneTariffs(tariffs);
          
          // Reset manual selection on zone change
          setManualTariff(null);
          setAutoSelectedTariffId(null);
          
          // Auto-select tariff if no manual selection
          if (!manualTariffIdRef.current && tariffs.length > 0) {
            await applyRecommendedTariff(tariffs);
          }
          
          console.log(`✅ Zone updated: ${zoneName}, ${tariffs.length} tariffs available`);
        } catch (error: any) {
          // ✅ Handle 404 gracefully - zone might not exist or have tariffs yet
          if (error?.response?.status === 404) {
            console.log(`⚠️ Zone "${zoneName}" (${zoneId}) not found or has no tariffs - using fallback`);
            
            // Still set the zone, but with empty tariffs
            const companyId = getDriverCompanyId(driver);
            setCurrentZone({
              id: zoneId,
              name: zoneName || "Unknown Zone",
              coordinates: [],
              isActive: true,
              companyId: companyId || "",
            });
            setZoneTariffs([]);
            setManualTariff(null);
            setAutoSelectedTariffId(null);
            
            // Don't treat this as a critical error
            setError(null);
          } else {
            // Real network/server error
            console.error("❌ Failed to fetch zone tariffs:", error);
            setError("Failed to load zone tariffs");
          }
        }
      } else {
        // Server confirmed driver is outside every zone. Show the banner
        // unconditionally — the previous "only if they were once inside"
        // gate meant a driver who started up *outside* every zone (e.g.
        // travelling, working from a different country, GPS still warming
        // up) got no warning at all and just silently received no jobs.
        // The dedup at the top of the handler already prevents repeat
        // logs/state churn while the driver stays outside.
        console.log("📍 Driver is outside every zone");
        setIsOutOfZone(true);
        setCurrentZone(null);
        setZoneTariffs([]);
        setManualTariff(null);
        setAutoSelectedTariffId(null);
      }
    },
    [driver, applyRecommendedTariff, setManualTariff]
  );

  // Register zone change listener (listen to server events)
  useEffect(() => {
    if (!driver?.id) {
      return;
    }

    console.log("📍 Registering zone change listener for driver:", driver.id);
    registerZoneChangeListener(handleZoneChange);

    // No cleanup needed - callback is just overwritten on re-register
  }, [driver?.id, handleZoneChange]);

  // Restore the last-known zone from AsyncStorage on mount. Without this,
  // a kill-and-relaunch (or any scenario where the JS bundle was unloaded)
  // shows "No zone detected" until the server re-broadcasts zone:changed —
  // which can take several seconds and looks like the app forgot the
  // driver's location. We hydrate immediately, then a fresh server event
  // overwrites it. lastZoneIdRef is left at `undefined` so the first
  // genuine zone:changed event from the server still fires through the
  // dedup guard.
  const hasHydratedZoneRef = useRef(false);
  useEffect(() => {
    if (hasHydratedZoneRef.current) return;
    hasHydratedZoneRef.current = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ZONE_STORAGE_KEY);
        if (!raw) return;
        const snapshot = JSON.parse(raw) as PersistedZoneSnapshot;
        if (snapshot?.zone?.id) {
          setCurrentZone(snapshot.zone);
          setZoneTariffs(Array.isArray(snapshot.tariffs) ? snapshot.tariffs : []);
          setLastUpdatedAt(snapshot.cachedAt || Date.now());
          setLastKnownZoneName(snapshot.zone.name || null);
          hadZoneRef.current = true;
          console.log(
            `♻️ Hydrated zone from storage: ${snapshot.zone.name} (${(snapshot.tariffs || []).length} tariffs)`
          );
        }
      } catch (err: any) {
        console.warn("[ZoneContext] zone hydration failed:", err?.message);
      }
    })();
  }, []);

  // Persist whenever zone or tariffs change so the next launch / foreground
  // can re-paint without flicker. Best-effort; failures are non-fatal.
  useEffect(() => {
    const snapshot: PersistedZoneSnapshot = {
      zone: currentZone,
      tariffs: zoneTariffs,
      cachedAt: Date.now(),
    };
    AsyncStorage.setItem(ZONE_STORAGE_KEY, JSON.stringify(snapshot)).catch(
      (err) => console.warn("[ZoneContext] zone persist failed:", err?.message)
    );
  }, [currentZone, zoneTariffs]);

  // On app foreground, re-fetch the current zone's tariffs so the driver
  // doesn't act on stale rates after a long background period (owner could
  // have published new tariffs in the meantime). Also asks the server to
  // re-broadcast the current zone so we recover from any missed
  // zone:changed event during the background.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== "active") return;
      if (!driver?.id) return;
      if (currentZone?.id) {
        getZoneTariffs(currentZone.id)
          .then((tariffs) => {
            setZoneTariffs(tariffs);
            setLastUpdatedAt(Date.now());
            console.log(
              `🔁 [foreground] zone tariffs refreshed: ${tariffs.length} for ${currentZone.name}`
            );
          })
          .catch((err) => {
            console.warn("[foreground] zone tariff refresh failed:", err?.message);
          });
      }
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [driver?.id, currentZone?.id, currentZone?.name]);

  const forceRefresh = useCallback(async () => {
    // Force refresh is no longer needed since server handles detection
    // But keep for manual tariff refresh
    console.log("🔄 Manual zone refresh requested - checking current zone");
    
    if (currentZone?.id) {
      setLoading(true);
      try {
        const tariffs = await getZoneTariffs(currentZone.id);
        setZoneTariffs(tariffs);
        setError(null);
        console.log(`✅ Refreshed zone tariffs: ${tariffs.length} available`);
      } catch (error) {
        console.error("❌ Failed to refresh zone tariffs:", error);
        setError("Failed to refresh zone data");
      } finally {
        setLoading(false);
      }
    } else {
      // ✅ Don't set error when no zone - this is normal before shift starts
      console.log("ℹ️ No current zone detected yet - zone will be detected when shift starts");
      setError(null); // Clear any previous errors
    }
  }, [currentZone]);

  const recommendedTariffId = useMemo(() => {
    const preferred =
      zoneTariffs.find((item) => item.tariff.isDefault)?.tariff.id ??
      zoneTariffs[0]?.tariff.id ??
      null;
    return preferred;
  }, [zoneTariffs]);

  const value = useMemo<ZoneContextValue>(
    () => ({
      currentZone,
      zoneTariffs,
      recommendedTariffId,
      autoSelectedTariffId,
      manualTariffId: manualTariffIdState,
      loading,
      lastUpdatedAt,
      error,
      isOutOfZone,
      lastKnownZoneName,
      forceRefresh,
      setManualTariff,
      dismissOutOfZone,
    }),
    [
      autoSelectedTariffId,
      currentZone,
      dismissOutOfZone,
      error,
      forceRefresh,
      isOutOfZone,
      lastKnownZoneName,
      lastUpdatedAt,
      loading,
      manualTariffIdState,
      recommendedTariffId,
      setManualTariff,
      zoneTariffs,
    ]
  );

  return <ZoneContext.Provider value={value}>{children}</ZoneContext.Provider>;
};

export const useZone = (): ZoneContextValue => useContext(ZoneContext);
