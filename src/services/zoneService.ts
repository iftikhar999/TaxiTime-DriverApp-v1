import AsyncStorage from "@react-native-async-storage/async-storage";
import httpClient from "./httpClient";

export interface Zone {
  id: string;
  name: string;
  description?: string;
  coordinates: Array<{
    lat: number;
    lng: number;
  }>;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  centerPoint?: {
    lat: number;
    lng: number;
  };
  isActive: boolean;
  companyId: string;
}

export interface ZoneTariff {
  id: string;
  zoneId: string;
  tariffId: string;
  zone: Zone;
  tariff: {
    id: string;
    name: string;
    description?: string;
    vehicleType?: string;
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    minimumFare: number;
    waitingFeePerMinute?: number;
    waitingTimeRate?: number;
    isDefault?: boolean;
    isActive: boolean;
  };
}

export interface DriverZoneUpdate {
  driverId: string;
  zoneId: string | null;
  location: {
    latitude: number;
    longitude: number;
  };
  timestamp: string;
}

/**
 * Check if a point is inside a polygon using the ray-casting algorithm
 */
function pointInPolygon(
  point: { lat: number; lng: number },
  polygon: Array<{ lat: number; lng: number }>
): boolean {
  const { lat, lng } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Detect which zone the driver is currently in based on GPS coordinates
 */
export const detectDriverZone = async (
  latitude: number,
  longitude: number,
  companyId: string
): Promise<Zone | null> => {
  try {
    console.log(`🔍 Detecting zone for location: ${latitude}, ${longitude}`);

    // Fetch all company zones
    const response = await httpClient.get<{ success: boolean; data: Zone[] }>(
      `/companies/${companyId}/zones`
    );

    const zones = response.data.data;
    const currentLocation = { lat: latitude, lng: longitude };

    // Check each zone to see if driver is inside
    for (const zone of zones) {
      if (!zone.isActive || !zone.coordinates || zone.coordinates.length < 3) {
        continue;
      }

      if (pointInPolygon(currentLocation, zone.coordinates)) {
        console.log(`✅ Driver is in zone: ${zone.name}`);

        // Store current zone in AsyncStorage
        await AsyncStorage.setItem("currentZone", JSON.stringify(zone));

        return zone;
      }
    }

    console.log("ℹ️ Driver is not in any defined zone");
    await AsyncStorage.removeItem("currentZone");
    return null;
  } catch (error) {
    console.error("❌ Error detecting driver zone:", error);
    return null;
  }
};

/**
 * Get tariffs available for a specific zone
 */
export const getZoneTariffs = async (zoneId: string): Promise<ZoneTariff[]> => {
  try {
    console.log(`📋 Fetching tariffs for zone: ${zoneId}`);

    const response = await httpClient.get<{
      success: boolean;
      data: ZoneTariff[];
    }>(`/mobile/driver/zones/${zoneId}/tariffs`);

    return response.data.data.filter((zt) => zt.tariff.isActive);
  } catch (error) {
    console.error("❌ Error fetching zone tariffs:", error);
    return [];
  }
};

/**
 * Update driver's current zone on the backend (for dispatch portal)
 */
export const updateDriverZone = async (
  driverId: string,
  zoneId: string | null,
  location: { latitude: number; longitude: number }
): Promise<boolean> => {
  if (!driverId) {
    return false;
  }

  // We only sync with the backend when we have an actual zone match.
  // When the driver is outside all zones we rely on location socket updates instead.
  if (!zoneId) {
    return false;
  }

  try {
    const payload: DriverZoneUpdate = {
      driverId,
      zoneId,
      location,
      timestamp: new Date().toISOString(),
    };

    console.log(`📍 Updating driver zone: ${zoneId || "No zone"}`);

    await httpClient.post("/mobile/driver/location/zone-update", {
      ...payload,
      latitude: location.latitude,
      longitude: location.longitude,
    });

    return true;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    if (status === 404) {
      console.warn(
        "⚠️ Driver zone update endpoint not available. Skipping sync."
      );
      return false;
    }
    console.error("❌ Error updating driver zone:", error);
    return false;
  }
};

/**
 * Get driver's current stored zone from AsyncStorage
 */
export const getCurrentZone = async (): Promise<Zone | null> => {
  try {
    const storedZone = await AsyncStorage.getItem("currentZone");
    return storedZone ? JSON.parse(storedZone) : null;
  } catch (error) {
    console.error("❌ Error getting current zone:", error);
    return null;
  }
};

/**
 * Combined zone detection and tariff fetching
 */
export const detectZoneAndGetTariffs = async (
  latitude: number,
  longitude: number,
  companyId: string,
  driverId: string
): Promise<{
  zone: Zone | null;
  tariffs: ZoneTariff[];
}> => {
  try {
    // Detect current zone
    const zone = await detectDriverZone(latitude, longitude, companyId);

    // Update driver zone on backend
    await updateDriverZone(driverId, zone?.id || null, { latitude, longitude });

    // Get tariffs for the zone
    const tariffs = zone ? await getZoneTariffs(zone.id) : [];

    return {
      zone,
      tariffs,
    };
  } catch (error) {
    console.error("❌ Error in detectZoneAndGetTariffs:", error);
    return {
      zone: null,
      tariffs: [],
    };
  }
};
