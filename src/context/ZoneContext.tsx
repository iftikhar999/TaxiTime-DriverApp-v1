import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { registerZoneChangeListener } from "../services/driverSocket";
import {
    getZoneTariffs,
    Zone,
    ZoneTariff,
} from "../services/zoneService";
import { getDriverCompanyId } from "../utils/driverHelpers";
import { useAuth } from "./AuthContext";
import { useShift } from "./ShiftContext";

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
  forceRefresh: () => Promise<void>;
  setManualTariff: (tariffId: string | null) => void;
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
  forceRefresh: async () => {},
  setManualTariff: () => {},
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
  const lastZoneIdRef = useRef<string | null>(null);

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
        // Driver left all zones
        console.log("📍 Driver left all zones");
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
      forceRefresh,
      setManualTariff,
    }),
    [
      autoSelectedTariffId,
      currentZone,
      error,
      forceRefresh,
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
