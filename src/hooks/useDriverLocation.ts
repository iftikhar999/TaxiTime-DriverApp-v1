import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import {
  LocationData,
  locationService,
  LocationUpdateCallback,
} from "../services/locationService";
import { Zone, ZoneTariff } from "../services/zoneService";

export interface UseDriverLocationReturn {
  currentLocation: LocationData | null;
  currentZone: Zone | null;
  availableTariffs: ZoneTariff[];
  isTracking: boolean;
  startTracking: () => Promise<boolean>;
  stopTracking: () => void;
  updateLocation: (lat: number, lng: number) => Promise<void>;
  forceZoneCheck: () => Promise<void>;
  error: string | null;
}

export const useDriverLocation = (
  driverId: string,
  companyId: string
): UseDriverLocationReturn => {
  const [currentLocation, setCurrentLocation] = useState<LocationData | null>(
    null
  );
  const [currentZone, setCurrentZone] = useState<Zone | null>(null);
  const [availableTariffs, setAvailableTariffs] = useState<ZoneTariff[]>([]);
  const [isTracking, setIsTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Location update callback
  const locationCallback: LocationUpdateCallback = {
    onLocationUpdate: useCallback((location: LocationData) => {
      console.log("📍 Location updated in hook:", location);
      setCurrentLocation(location);
      setError(null);
    }, []),

    onZoneChange: useCallback((zone: Zone | null, tariffs: ZoneTariff[]) => {
      console.log(
        "🏃‍♂️ Zone changed in hook:",
        zone?.name || "No zone",
        "Tariffs:",
        tariffs.length
      );
      setCurrentZone(zone);
      setAvailableTariffs(tariffs);
      setError(null);
    }, []),

    onError: useCallback((errorMessage: string) => {
      console.error("❌ Location error in hook:", errorMessage);
      setError(errorMessage);
    }, []),
  };

  // Register/unregister callback
  useEffect(() => {
    locationService.addCallback(locationCallback);

    return () => {
      locationService.removeCallback(locationCallback);
    };
  }, [locationCallback]);

  // Initialize with stored data
  useEffect(() => {
    const initializeStoredData = async () => {
      try {
        // Get last known location
        const storedLocation = await AsyncStorage.getItem("lastKnownLocation");
        if (storedLocation) {
          const location = JSON.parse(storedLocation);
          setCurrentLocation(location);
        }

        // Get current zone
        const storedZone = await AsyncStorage.getItem("currentZone");
        if (storedZone) {
          const zone = JSON.parse(storedZone);
          setCurrentZone(zone);
        }

        // Check if already tracking
        setIsTracking(locationService.isCurrentlyTracking());
      } catch (error) {
        console.error("❌ Error initializing stored data:", error);
      }
    };

    initializeStoredData();
  }, []);

  // Start tracking function
  const startTracking = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const success = await locationService.startLocationTracking(
        driverId,
        companyId
      );
      setIsTracking(success);
      return success;
    } catch (error) {
      const errorMessage = `Failed to start tracking: ${(error as Error).message}`;
      setError(errorMessage);
      return false;
    }
  }, [driverId, companyId]);

  // Stop tracking function
  const stopTracking = useCallback((): void => {
    locationService.stopLocationTracking();
    setIsTracking(false);
    setCurrentLocation(null);
    setCurrentZone(null);
    setAvailableTariffs([]);
  }, []);

  // Update location manually
  const updateLocation = useCallback(
    async (lat: number, lng: number): Promise<void> => {
      try {
        setError(null);
        await locationService.updateLocation(lat, lng, driverId, companyId);
      } catch (error) {
        const errorMessage = `Failed to update location: ${(error as Error).message}`;
        setError(errorMessage);
      }
    },
    [driverId, companyId]
  );

  // Force zone check
  const forceZoneCheck = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      await locationService.forceZoneCheck(driverId, companyId);
    } catch (error) {
      const errorMessage = `Failed to check zone: ${(error as Error).message}`;
      setError(errorMessage);
    }
  }, [driverId, companyId]);

  return {
    currentLocation,
    currentZone,
    availableTariffs,
    isTracking,
    startTracking,
    stopTracking,
    updateLocation,
    forceZoneCheck,
    error,
  };
};
