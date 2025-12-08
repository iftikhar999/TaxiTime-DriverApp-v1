import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, ViewStyle } from "react-native";
import MapView, {
  AnimatedRegion,
  Camera,
  Marker,
  Polyline,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { useAuth } from "../context/AuthContext";
import { fetchCompanySettings, MapProvider } from "../services/companySettingsService";
import { Colors } from "../theme/colors";

type CoordinateInput = {
  latitude?: number | null;
  longitude?: number | null;
  heading?: number | null; // ✨ NEW: Driver heading/bearing
  speed?: number | null;    // ✨ NEW: Driver speed for dynamic pitch
};

interface RideMapProps {
  pickup?: CoordinateInput;
  dropoff?: CoordinateInput;
  driver?: CoordinateInput;
  style?: ViewStyle;
  height?: number;
  route?: Array<{ latitude: number; longitude: number }>;
  enable3D?: boolean; // ✨ NEW: Enable 3D camera tracking
  followDriver?: boolean; // ✨ NEW: Keep camera centered on driver
  updateInterval?: number; // ✅ NEW: Animation duration based on company location update interval (ms)
  mapProviderOverride?: MapProvider; // ✅ NEW: Allow parent screens to force free-tier provider
}

const hasValidCoordinate = (point?: CoordinateInput): point is {
  latitude: number;
  longitude: number;
} =>
  !!point &&
  typeof point.latitude === "number" &&
  Number.isFinite(point.latitude) &&
  typeof point.longitude === "number" &&
  Number.isFinite(point.longitude);

const buildRegion = (points: Array<{ latitude: number; longitude: number }>): Region => {
  if (!points.length) {
    return {
      latitude: -36.8485,
      longitude: 174.7633,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }

  if (points.length === 1) {
    const [point] = points;
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      latitudeDelta: 0.03,
      longitudeDelta: 0.03,
    };
  }

  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const latitudeDelta = Math.max((maxLat - minLat) * 1.6, 0.02);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.6, 0.02);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

const RideMap: React.FC<RideMapProps> = ({ 
  pickup, 
  dropoff, 
  driver, 
  route, 
  style, 
  height = 220,
  enable3D = false, // ✨ NEW: Default to 2D for compatibility
  followDriver = false, // ✨ NEW: Default to overview mode
  updateInterval = 5000, // ✅ NEW: Default 5s if not provided (matches default location interval)
  mapProviderOverride,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const previousDriverCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const driverAnimatedPositionRef = useRef<AnimatedRegion | null>(null);
  const { user } = useAuth();
  const [mapProvider, setMapProvider] = useState<MapProvider>(mapProviderOverride || "NATIVE");

  // Fetch company map provider settings
  useEffect(() => {
    if (mapProviderOverride) {
      setMapProvider(mapProviderOverride);
      return;
    }

    let cancelled = false;

    const fetchMapProvider = async () => {
      if (!user?.companyId) return;
      
      try {
        const settings = await fetchCompanySettings(user.companyId);
        const normalizeMapProvider = (value?: string | null): MapProvider => {
          if (!value) return "NATIVE";
          const normalized = value.toUpperCase().replace(/\s+/g, "_");
          if (normalized.includes("NATIVE") || normalized.includes("DEFAULT")) return "NATIVE";
          if (normalized.includes("GOOGLE")) return "GOOGLE_MAPS";
          if (normalized.includes("OPEN") && normalized.includes("MAP")) return "OPENSTREETMAP";
          return "NATIVE";
        };
        const provider = normalizeMapProvider(settings?.mapProvider);
        if (!cancelled) {
          setMapProvider(provider);
          console.log(`🗺️ RideMap provider: ${provider}`);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to fetch map provider:", error);
        }
      }
    };

    fetchMapProvider();

    return () => {
      cancelled = true;
    };
  }, [user?.companyId, mapProviderOverride]);

  const points = useMemo(() => {
    const coords: Array<{ latitude: number; longitude: number }> = [];
    if (hasValidCoordinate(pickup)) {
      coords.push({ latitude: pickup.latitude, longitude: pickup.longitude });
    }
    if (hasValidCoordinate(dropoff)) {
      coords.push({ latitude: dropoff.latitude, longitude: dropoff.longitude });
    }
    if (hasValidCoordinate(driver)) {
      coords.push({ latitude: driver.latitude, longitude: driver.longitude });
    }
    if (Array.isArray(route)) {
      route.forEach((point) => {
        if (
          Number.isFinite(point.latitude) &&
          Number.isFinite(point.longitude)
        ) {
          coords.push({ latitude: point.latitude, longitude: point.longitude });
        }
      });
    }
    return coords;
  }, [pickup, dropoff, driver, route]);

  const region = useMemo(() => buildRegion(points), [points]);

  // Determine fallback coordinate for initializing animations
  const fallbackCoordinate = useMemo(() => {
    if (hasValidCoordinate(driver)) {
      return { latitude: driver.latitude!, longitude: driver.longitude! };
    }
    if (points.length > 0) {
      const { latitude, longitude } = points[points.length - 1];
      return { latitude, longitude };
    }
    return { latitude: region.latitude, longitude: region.longitude };
  }, [driver, points, region.latitude, region.longitude]);

  if (!driverAnimatedPositionRef.current) {
    driverAnimatedPositionRef.current = new AnimatedRegion({
      latitude: fallbackCoordinate.latitude,
      longitude: fallbackCoordinate.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    });
  }

  // ✨ NEW: Calculate dynamic pitch based on speed
  const cameraPitch = useMemo(() => {
    if (!enable3D || !driver?.speed) return 0;
    
    const speed = driver.speed;
    if (speed < 5) return 0; // Flat when stopped/slow
    if (speed < 20) return 30; // Slight angle for city driving
    if (speed < 50) return 45; // Medium angle for normal speed
    return 60; // Maximum tilt for highway speeds
  }, [enable3D, driver?.speed]);

  // ✨ NEW: Calculate dynamic zoom based on speed
  const cameraAltitude = useMemo(() => {
    if (!enable3D || !driver?.speed) return 1500;
    
    const speed = driver.speed;
    if (speed < 5) return 500; // Close when stopped
    if (speed < 20) return 800; // Medium for city
    if (speed < 50) return 1200; // Further for normal speed
    return 1800; // Far for highway
  }, [enable3D, driver?.speed]);

  // ✨ NEW: 3D camera following driver with heading
  useEffect(() => {
    if (!followDriver || !mapRef.current) {
      return;
    }

    if (!hasValidCoordinate(driver)) {
      previousDriverCoordinateRef.current = null;
      return;
    }

    const intervalMs = Math.max(updateInterval, 500);
    const startCoordinate = previousDriverCoordinateRef.current;
    const nextCoordinate = {
      latitude: driver.latitude!,
      longitude: driver.longitude!,
    };

    if (startCoordinate) {
      const latDelta = Math.abs(startCoordinate.latitude - nextCoordinate.latitude);
      const lngDelta = Math.abs(startCoordinate.longitude - nextCoordinate.longitude);
      if (latDelta < 0.000003 && lngDelta < 0.000003) {
        return;
      }
    }

    const isFirstAnimation = !startCoordinate;
    previousDriverCoordinateRef.current = nextCoordinate;
    const rawBuffer = intervalMs * 0.2;
    const animationBufferMs = Math.max(
      300,
      Math.min(rawBuffer, Math.min(1500, intervalMs - 300))
    );
    const cameraAnimationDuration = isFirstAnimation
      ? 800
      : Math.max(intervalMs - animationBufferMs, 800);

    const camera: Camera = {
      center: nextCoordinate,
      pitch: enable3D ? cameraPitch : 0,
      heading: driver.heading || 0,
      altitude: enable3D ? cameraAltitude : 1200,
      zoom: enable3D ? 16 : 15,
    };

    mapRef.current.animateCamera(camera, { duration: cameraAnimationDuration });
  }, [
    enable3D,
    followDriver,
    driver?.latitude,
    driver?.longitude,
    driver?.heading,
    cameraPitch,
    cameraAltitude,
    updateInterval,
  ]);

  const showMap = points.length > 0;

  useEffect(() => {
    if (!driverAnimatedPositionRef.current) return;
    if (!hasValidCoordinate(driver)) {
      driverAnimatedPositionRef.current.stopAnimation();
      return;
    }

    const intervalMs = Math.max(updateInterval, 500);
    const rawBuffer = intervalMs * 0.2;
    const animationBufferMs = Math.max(
      300,
      Math.min(rawBuffer, Math.min(1500, intervalMs - 300))
    );
    const markerDuration = Math.max(intervalMs - animationBufferMs, 300);

    driverAnimatedPositionRef.current.timing({
      latitude: driver.latitude!,
      longitude: driver.longitude!,
      duration: markerDuration,
      useNativeDriver: false,
    }).start();
  }, [driver?.latitude, driver?.longitude, updateInterval]);

  // Convert MapProvider string to react-native-maps provider constant
  const mapProviderConstant =
    mapProvider === "GOOGLE_MAPS" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

  return (
    <View style={[styles.container, { height }, style]}>
      {showMap ? (
        <MapView
          ref={mapRef} // ✨ NEW: Ref for camera control
          provider={mapProviderConstant}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          region={followDriver ? undefined : region} // ✨ Don't force region when following
          pointerEvents="none"
          zoomEnabled={false}
          rotateEnabled={enable3D} // ✨ NEW: Enable rotation for 3D
          pitchEnabled={enable3D} // ✨ NEW: Enable pitch for 3D
          scrollEnabled={false}
          mapType="standard" // ✨ Better for 3D view
        >
          {hasValidCoordinate(pickup) && (
            <Marker
              coordinate={{ latitude: pickup.latitude!, longitude: pickup.longitude! }}
              title="Pickup"
              pinColor="#22c55e"
            >
              <View style={styles.pickupMarker}>
                <MaterialCommunityIcons name="map-marker" size={28} color="#22c55e" />
              </View>
            </Marker>
          )}
          {hasValidCoordinate(dropoff) && (
            <Marker
              coordinate={{ latitude: dropoff.latitude!, longitude: dropoff.longitude! }}
              title="Dropoff"
              pinColor="#ef4444"
            >
              <View style={styles.dropoffMarker}>
                <MaterialCommunityIcons name="flag-checkered" size={24} color="#ef4444" />
              </View>
            </Marker>
          )}
          {driverAnimatedPositionRef.current && hasValidCoordinate(driver) && (
            <Marker.Animated
              coordinate={driverAnimatedPositionRef.current}
              title="Driver"
              rotation={driver.heading || 0}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
            >
              <View
                style={[
                  styles.driverMarker,
                  enable3D && styles.driverMarker3D,
                ]}
              >
                <MaterialCommunityIcons
                  name="navigation"
                  size={enable3D ? 24 : 20}
                  color="#fff"
                />
              </View>
            </Marker.Animated>
          )}
          {Array.isArray(route) && route.length >= 2 && (
            <Polyline
              coordinates={route}
              strokeColor="#38bdf8"
              strokeWidth={enable3D ? 5 : 4} // ✨ Thicker line for 3D
              lineCap="round"
              lineJoin="round"
            />
          )}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <MaterialCommunityIcons name="map-search" size={32} color="#8d95ad" />
          <Text style={styles.placeholderText}>Map preview unavailable</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: Colors.background.elevated,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  driverMarker: {
    backgroundColor: Colors.primary[400],
    borderRadius: 16,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3.5,
    elevation: 5,
  },
  driverMarker3D: {
    // ✨ NEW: Enhanced driver marker for 3D mode
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#3b82f6",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#3b82f6",
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 5,
    elevation: 8,
  },
  pickupMarker: {
    // ✨ NEW: Pickup marker styling
    alignItems: "center",
    justifyContent: "center",
  },
  dropoffMarker: {
    // ✨ NEW: Dropoff marker styling
    alignItems: "center",
    justifyContent: "center",
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  placeholderText: {
    color: "#8d95ad",
    fontSize: 13,
  },
});

export default RideMap;
