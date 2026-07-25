import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from "react-native-maps";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../theme/colors";
import { fetchOsrmRoute } from "../services/osrmRoutingService";

const haversineKm = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type CoordinateInput = {
  latitude?: number | null;
  longitude?: number | null;
};

interface JobOfferMapProps {
  pickup?: CoordinateInput;
  driver?: CoordinateInput;
  style?: ViewStyle;
  height?: number;
  showNavigationButtons?: boolean;
  showAlternateRoute?: boolean;
  onRouteStats?: (stats: { distanceKm: number; durationMin: number }) => void;
  onExpandMap?: () => void;
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

  const latitudeDelta = Math.max((maxLat - minLat) * 1.8, 0.02);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.8, 0.02);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
};

const JobOfferMap: React.FC<JobOfferMapProps> = ({
  pickup,
  driver,
  style,
  height = 280,
  showNavigationButtons = false,
  showAlternateRoute = false,
  onRouteStats,
  onExpandMap,
}) => {
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [osrmPath, setOsrmPath] = useState<Array<{ latitude: number; longitude: number }> | null>(null);

  const showRoute = hasValidCoordinate(driver) && hasValidCoordinate(pickup);
  const routeKey = useMemo(() => {
    if (!showRoute) return null;
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return `${round(driver!.latitude!)},${round(driver!.longitude!)}|${round(pickup!.latitude!)},${round(pickup!.longitude!)}`;
  }, [showRoute, driver, pickup]);

  useEffect(() => {
    if (!routeKey || !showRoute) {
      setOsrmPath(null);
      setRouteDistance(null);
      setRouteDuration(null);
      return;
    }
    const controller = new AbortController();
    const waypoints = [
      { latitude: driver!.latitude!, longitude: driver!.longitude! },
      { latitude: pickup!.latitude!, longitude: pickup!.longitude! },
    ];
    fetchOsrmRoute(waypoints, { signal: controller.signal })
      .then((r) => {
        if (!r) return;
        setOsrmPath(r.coordinates);
        const distanceKm = r.distanceMeters / 1000;
        const durationMin = r.durationSeconds / 60;
        setRouteDistance(distanceKm);
        setRouteDuration(durationMin);
        onRouteStats?.({ distanceKm, durationMin });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        console.warn("OSRM route fetch failed:", err);
        // Fallback to straight-line estimate so UI isn't empty.
        const distanceKm = haversineKm(
          { latitude: driver!.latitude!, longitude: driver!.longitude! },
          { latitude: pickup!.latitude!, longitude: pickup!.longitude! },
        );
        setRouteDistance(distanceKm);
        setRouteDuration(distanceKm * 2); // rough ~30 km/h city avg
        onRouteStats?.({ distanceKm, durationMin: distanceKm * 2 });
      });
    return () => controller.abort();
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const points = useMemo(() => {
    const coords: Array<{ latitude: number; longitude: number }> = [];
    if (hasValidCoordinate(pickup)) {
      coords.push({ latitude: pickup.latitude, longitude: pickup.longitude });
    }
    if (hasValidCoordinate(driver)) {
      coords.push({ latitude: driver.latitude, longitude: driver.longitude });
    }
    return coords;
  }, [pickup, driver]);

  const region = useMemo(() => buildRegion(points), [points]);

  const showMap = hasValidCoordinate(pickup); // Show map if at least pickup is available

  // Imperatively re-fit the map whenever the relevant coords change.
  // `initialRegion` only applies on first mount, so the previous code
  // could leave the map stuck on the default Auckland region if pickup/
  // driver arrived after mount. Using fitToCoordinates with explicit
  // padding gives the Uber-style "both pins visible with the route
  // arcing between them" framing the user wants.
  const mapRef = useRef<MapView | null>(null);
  useEffect(() => {
    if (!mapRef.current) return;
    if (!showMap) return;

    // Build the set we want to be visible: driver + pickup + every node
    // along the OSRM polyline (so the curve isn't cropped).
    const fitCoords: Array<{ latitude: number; longitude: number }> = [];
    if (hasValidCoordinate(pickup)) {
      fitCoords.push({ latitude: pickup.latitude, longitude: pickup.longitude });
    }
    if (hasValidCoordinate(driver)) {
      fitCoords.push({ latitude: driver.latitude, longitude: driver.longitude });
    }
    if (osrmPath && osrmPath.length >= 2) {
      for (const c of osrmPath) fitCoords.push(c);
    }
    if (fitCoords.length === 0) return;

    if (fitCoords.length === 1) {
      mapRef.current.animateToRegion(
        {
          latitude: fitCoords[0].latitude,
          longitude: fitCoords[0].longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        300
      );
      return;
    }

    // Slight delay so the MapView has finished its first layout pass on
    // Android — fitToCoordinates before layout is a no-op on some devices.
    const id = setTimeout(() => {
      mapRef.current?.fitToCoordinates(fitCoords, {
        edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
        animated: true,
      });
    }, 120);
    return () => clearTimeout(id);
  }, [
    showMap,
    pickup?.latitude,
    pickup?.longitude,
    driver?.latitude,
    driver?.longitude,
    osrmPath,
  ]);

  const alternateRoute = useMemo(() => {
    if (!showAlternateRoute || !hasValidCoordinate(pickup) || !hasValidCoordinate(driver)) {
      return null;
    }

    const midLat = (pickup.latitude! + driver.latitude!) / 2;
    const midLng = (pickup.longitude! + driver.longitude!) / 2;
    const offsetLat = (pickup.latitude! - driver.latitude!) * 0.1;
    const offsetLng = (pickup.longitude! - driver.longitude!) * -0.1;

    return [
      { latitude: driver.latitude!, longitude: driver.longitude! },
      { latitude: midLat + offsetLat, longitude: midLng + offsetLng },
      { latitude: pickup.latitude!, longitude: pickup.longitude! },
    ];
  }, [pickup, driver, showAlternateRoute]);

  const handleNavigationSelection = () => {
    if (!hasValidCoordinate(pickup)) {
      Alert.alert("Error", "Pickup location not available");
      return;
    }

    // Use native device navigation app chooser
    // This will show all installed navigation apps (Google Maps, Waze, Apple Maps, etc.)
    const lat = pickup.latitude;
    const lng = pickup.longitude;
    
    // Universal geo URI that triggers native app picker
    const geoUri = Platform.OS === 'ios' 
      ? `maps:0,0?q=${lat},${lng}` // iOS format
      : `geo:0,0?q=${lat},${lng}`; // Android format
    
    Linking.openURL(geoUri).catch(() => {
      // Fallback to Google Maps web if no navigation app installed
      const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      Linking.openURL(fallbackUrl);
    });
  };

  return (
    <View style={[styles.container, { height }, style]}>
      {showMap ? (
        <>
          {onExpandMap && (
            <TouchableOpacity
              style={styles.expandButton}
              activeOpacity={0.85}
              onPress={onExpandMap}
            >
              <MaterialCommunityIcons name="fullscreen" size={14} color="#fff" />
              <Text style={styles.expandButtonText}>Maximize</Text>
            </TouchableOpacity>
          )}
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            scrollEnabled={false}
            showsUserLocation={false}
            showsMyLocationButton={false}
            showsCompass={false}
            showsTraffic={false}
            // Re-fit once the map has actually finished laying out on Android.
            // Without this, the very first fit attempt can fire before the
            // tile surface is ready and silently no-op.
            onMapReady={() => {
              if (!mapRef.current) return;
              const coords: Array<{ latitude: number; longitude: number }> = [];
              if (hasValidCoordinate(pickup)) {
                coords.push({ latitude: pickup.latitude, longitude: pickup.longitude });
              }
              if (hasValidCoordinate(driver)) {
                coords.push({ latitude: driver.latitude, longitude: driver.longitude });
              }
              if (coords.length >= 2) {
                mapRef.current.fitToCoordinates(coords, {
                  edgePadding: { top: 70, right: 50, bottom: 70, left: 50 },
                  animated: false,
                });
              }
            }}
          >
            {/* Driver Marker - Only show when driver location is available */}
            {hasValidCoordinate(driver) && (
              <Marker 
                coordinate={{ latitude: driver.latitude!, longitude: driver.longitude! }} 
                title="Your Location"
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.driverMarker}>
                  <MaterialCommunityIcons name="navigation-variant" size={20} color="#fff" />
                </View>
              </Marker>
            )}

            {/* Pickup Marker */}
            {hasValidCoordinate(pickup) && (
              <Marker
                coordinate={{ latitude: pickup.latitude!, longitude: pickup.longitude! }}
                title="Customer Location"
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={styles.pickupMarker}>
                  <MaterialCommunityIcons name="account-circle" size={32} color="#22c55e" />
                </View>
              </Marker>
            )}

            {/* Road-following route via free OSRM. Uber-style stroked look. */}
            {showRoute && osrmPath && osrmPath.length >= 2 && (
              <>
                <Polyline
                  coordinates={osrmPath}
                  strokeColor="#1e3a8a"
                  strokeWidth={9}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={1}
                />
                <Polyline
                  coordinates={osrmPath}
                  strokeColor="#3b82f6"
                  strokeWidth={6}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={2}
                />
              </>
            )}

            {alternateRoute && (
              <Polyline
                coordinates={alternateRoute}
                strokeColor="#cbd5f5"
                strokeWidth={3}
                lineDashPattern={[6, 6]}
              />
            )}
          </MapView>

          {/* Route Info Overlay */}
          {(routeDistance !== null || routeDuration !== null) && (
            <View style={styles.routeInfoOverlay}>
              {routeDistance !== null && (
                <View style={styles.routeInfoChip}>
                  <MaterialCommunityIcons name="map-marker-distance" size={14} color="#3b82f6" />
                  <Text style={styles.routeInfoText}>{routeDistance.toFixed(1)} km</Text>
                </View>
              )}
              {routeDuration !== null && (
                <View style={styles.routeInfoChip}>
                  <MaterialCommunityIcons name="clock-outline" size={14} color="#3b82f6" />
                  <Text style={styles.routeInfoText}>{Math.round(routeDuration)} min</Text>
                </View>
              )}
            </View>
          )}

          {/* Navigation Buttons */}
          {showNavigationButtons && (
            <View style={styles.navigationButtons}>
              <TouchableOpacity
                style={styles.navButton}
                onPress={handleNavigationSelection}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="directions" size={18} color="#fff" />
                <Text style={styles.navButtonText}>Navigation Apps</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          <MaterialCommunityIcons name="map-search" size={32} color="#8d95ad" />
          <Text style={styles.placeholderText}>Waiting for location data...</Text>
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
  expandButton: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  expandButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  driverMarker: {
    backgroundColor: "#f5b400",
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 3,
    borderColor: "#fff",
  },
  pickupMarker: {
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
  routeInfoOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    gap: 8,
  },
  routeInfoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
  routeInfoText: {
    color: "#1e293b",
    fontSize: 12,
    fontWeight: "600",
  },
  navigationButtons: {
    position: "absolute",
    bottom: 12,
    right: 12,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.75)",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 5,
  },
  navButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});

export default JobOfferMap;
