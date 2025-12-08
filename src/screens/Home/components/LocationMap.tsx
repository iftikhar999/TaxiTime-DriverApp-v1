import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, {
  AnimatedRegion,
  MapStyleElement,
  Marker,
  Polygon,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
} from "react-native-maps";
import Icon from "react-native-vector-icons/Feather";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { LocationUpdate } from "../../../native/locationService";
import { MapProvider } from "../../../services/companySettingsService";
import { DriverVehicle } from "../../../types/vehicle";

const DEFAULT_COORDS = {
  latitude: 25.2854,
  longitude: 51.531,
};

const MIN_DELTA = 0.003;
const MAX_DELTA = 0.12;
const DEFAULT_ACTIVE_DELTA = 0.025;
const DEFAULT_IDLE_DELTA = 0.045;
const ZOOM_FACTOR = 0.65;

// ✅ Custom map style: Hide all POIs, business logos, and unnecessary markers
const MINIMAL_MAP_STYLE: MapStyleElement[] = [
  {
    featureType: "poi",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi.business",
    elementType: "all",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "transit",
    elementType: "labels.icon",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "administrative",
    elementType: "labels",
    stylers: [{ visibility: "simplified" }],
  },
  {
    featureType: "landscape",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
  },
];

interface LocationMapProps {
  location: LocationUpdate | null;
  fallbackLatitude?: number;
  fallbackLongitude?: number;
  vehicle?: DriverVehicle | null;
  zoneName?: string | null;
  zoneLoading?: boolean;
  mapProvider: MapProvider;
  mapProviderLoading?: boolean;
  zoneCoordinates?: Array<{ lat: number; lng: number }> | null;
  lastUpdatedAt?: string | null;
  locationUpdateInterval?: number;
}

export const LocationMap: React.FC<LocationMapProps> = ({
  location,
  fallbackLatitude,
  fallbackLongitude,
  vehicle,
  zoneName,
  zoneLoading,
  mapProvider,
  mapProviderLoading,
  zoneCoordinates,
  lastUpdatedAt,
  locationUpdateInterval,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const previousCoordinateRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const userInteractingRef = useRef(false);
  const hasLiveFix =
    typeof location?.latitude === "number" &&
    typeof location?.longitude === "number";

  const derivedLatitude =
    location?.latitude ?? fallbackLatitude ?? DEFAULT_COORDS.latitude;
  const derivedLongitude =
    location?.longitude ?? fallbackLongitude ?? DEFAULT_COORDS.longitude;

  const heading =
    typeof location?.heading === "number" && !Number.isNaN(location.heading)
      ? location.heading
      : 0;

  const speedKmh =
    location?.speed != null && Number.isFinite(location.speed)
      ? Math.max(location.speed * 3.6, 0)
      : null;

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [mapLoadTimeout, setMapLoadTimeout] = useState(false);
  const [mapKey, setMapKey] = useState(0);
  const [countdown, setCountdown] = useState<number>(locationUpdateInterval || 5);
  const initialDelta = hasLiveFix ? DEFAULT_ACTIVE_DELTA : DEFAULT_IDLE_DELTA;

  // ✅ Animated marker coordinate so the icon glides even when the camera is paused
  const animatedCoordinateRef = useRef(
    new AnimatedRegion({
      latitude: derivedLatitude,
      longitude: derivedLongitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    })
  );
  const animatedCoordinate = animatedCoordinateRef.current;

  const mapProviderConstant =
    mapProvider === "GOOGLE_MAPS" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;
  const isGoogleProvider = mapProvider === "GOOGLE_MAPS";

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!mapReady && !mapError) {
        setMapLoadTimeout(true);
        setMapError("Map loading timeout. Tap to retry.");
      }
    }, 10000);

    if (mapReady) {
      clearTimeout(timeoutId);
      setMapLoadTimeout(false);
    }

    return () => clearTimeout(timeoutId);
  }, [mapReady, mapError]);

  // ✅ Countdown timer - counts down from locationUpdateInterval to 0
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          return locationUpdateInterval || 5; // Reset to company interval
        }
        return next;
      });
    }, 1000); // Update every second

    return () => clearInterval(interval);
  }, [locationUpdateInterval]);

  // Track last camera update to throttle based on locationUpdateInterval
  const lastCameraUpdateRef = useRef(0);

  useEffect(() => {
    if (!mapRef.current || !mapReady || !hasLiveFix) {
      if (!hasLiveFix) {
        previousCoordinateRef.current = null;
      }
      return;
    }

    const now = Date.now();
    const updateIntervalMs = Math.max((locationUpdateInterval || 2) * 1000, 500);
    if (now - lastCameraUpdateRef.current < updateIntervalMs * 0.5) {
      return;
    }
    lastCameraUpdateRef.current = now;

    const nextCoordinate = {
      latitude: derivedLatitude,
      longitude: derivedLongitude,
    };

    // ✅ Animate marker position smoothly with speed-based easing
    const rawBuffer = updateIntervalMs * 0.2; // finish ~20% sooner so it never feels paused
    const animationBufferMs = Math.max(
      300,
      Math.min(rawBuffer, Math.min(1500, updateIntervalMs - 300))
    );
    const markerAnimDuration = Math.max(updateIntervalMs - animationBufferMs, 300);
    const easingFunction = speedKmh && speedKmh > 5 
      ? Easing.linear // Smooth linear for moving
      : Easing.inOut(Easing.ease); // Ease in/out for slow/stationary
    
    animatedCoordinate
      .timing({
        latitude: nextCoordinate.latitude,
        longitude: nextCoordinate.longitude,
        duration: markerAnimDuration,
        easing: easingFunction,
        useNativeDriver: false,
      })
      .start();

    // ✅ Reset countdown when new location arrives
    setCountdown(locationUpdateInterval || 5);

    const isFirstCameraAnimation = !previousCoordinateRef.current;
    previousCoordinateRef.current = nextCoordinate;

    if (isFollowing) {
      // ✅ FORCE constant tilt - always tilted for 3D navigation view
      const targetPitch = 50; // Fixed 50 degree tilt
      const cameraAnimationDuration = isFirstCameraAnimation
        ? 800
        : Math.max(updateIntervalMs - animationBufferMs, 800);

      mapRef.current?.animateCamera(
        {
          center: nextCoordinate,
          pitch: targetPitch,
          heading,
          altitude: 1000,
          zoom: 16.5,
        },
        { duration: cameraAnimationDuration }
      );
    }
  }, [
    animatedCoordinate,
    derivedLatitude,
    derivedLongitude,
    heading,
    mapReady,
    isFollowing,
    hasLiveFix,
    locationUpdateInterval,
  ]);

  const zonePolygon = useMemo(() => {
    if (!zoneCoordinates || zoneCoordinates.length < 3) {
      return null;
    }
    return zoneCoordinates.map((coord) => ({
      latitude: coord.lat,
      longitude: coord.lng,
    }));
  }, [zoneCoordinates]);

  const centerMapOnDriver = useCallback(() => {
    if (!mapRef.current) return;

    const region = {
      latitude: derivedLatitude,
      longitude: derivedLongitude,
      latitudeDelta: DEFAULT_ACTIVE_DELTA,
      longitudeDelta: DEFAULT_ACTIVE_DELTA,
    };

    mapRef.current.animateToRegion(region, 300);
    setIsFollowing(true);
  }, [derivedLatitude, derivedLongitude]);

  const retryMapLoad = useCallback(() => {
    setMapError(null);
    setMapReady(false);
    setMapLoadTimeout(false);
    setMapKey((prev) => prev + 1);
  }, []);

  const renderMapContent = () => {
    if (mapProviderLoading) {
      return (
        <View style={styles.mapPlaceholder}>
          <ActivityIndicator size="large" color="#f5b400" />
          <Text style={styles.mapPlaceholderText}>
            Loading map provider settings…
          </Text>
        </View>
      );
    }

    if (mapError) {
      return (
        <TouchableOpacity
          style={styles.mapPlaceholder}
          onPress={retryMapLoad}
          activeOpacity={0.85}
        >
          <MCIcon name="map-marker-off" size={48} color="#8d95ad" />
          <Text style={styles.mapPlaceholderText}>{mapError}</Text>
          <Text style={styles.mapPlaceholderRetry}>Tap to retry</Text>
        </TouchableOpacity>
      );
    }

    return (
      <>
        <MapView
          key={mapKey}
          ref={mapRef}
          style={styles.map}
          provider={mapProviderConstant}
          customMapStyle={isGoogleProvider ? MINIMAL_MAP_STYLE : undefined}
          initialRegion={{
            latitude: derivedLatitude,
            longitude: derivedLongitude,
            latitudeDelta: initialDelta,
            longitudeDelta: initialDelta,
          }}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
          showsTraffic={false}
          showsBuildings={false}
          showsIndoors={false}
          showsPointsOfInterest={false}
          rotateEnabled={true}
          scrollEnabled={true}
          onMapReady={() => {
            setMapReady(true);
            setMapError(null);
          }}
          onPanDrag={() => {
            userInteractingRef.current = true;
          }}
          onRegionChangeComplete={() => {
            if (userInteractingRef.current) {
              userInteractingRef.current = false;
              setIsFollowing(false);
            }
          }}
        >
          {zonePolygon ? (
            <Polygon
              coordinates={zonePolygon}
              strokeColor="rgba(245, 180, 0, 0.5)"
              fillColor="rgba(245, 180, 0, 0.1)"
              strokeWidth={2}
            />
          ) : null}

          {hasLiveFix ? (
            <Marker.Animated
              coordinate={animatedCoordinate}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              tracksViewChanges={false}
            >
              <View
                style={[
                  styles.carMarker,
                  { transform: [{ rotate: `${heading}deg` }] },
                ]}
              >
                <Icon name="navigation" size={18} color="#fff" />
              </View>
            </Marker.Animated>
          ) : null}
        </MapView>

        {!mapReady && !mapError ? (
          <View style={styles.mapLoadingOverlay}>
            <ActivityIndicator size="large" color="#f5b400" />
            <Text style={styles.mapLoadingText}>
              {mapLoadTimeout ? "Map taking longer than usual…" : "Loading map…"}
            </Text>
          </View>
        ) : null}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        {renderMapContent()}
        
        {/* Fixed navigation arrow that always points up (90°) */}
        <View style={styles.centerMarkerContainer}>
          <View style={styles.navigationMarker}>
            <Icon name="navigation" size={24} color="#fff" 
            style={{ transform: [{ rotate: '315deg' }] }}
             />
          </View>
        </View>
      </View>

      <View style={styles.mapControls} pointerEvents="box-none">
        {/* {speedKmh !== null && (
          <View style={styles.speedBadge}>
            <MCIcon name="speedometer" size={16} color="#fff" />
            <Text style={styles.speedText}>{speedKmh.toFixed(0)} km/h</Text>
          </View>
        )} */}

        <TouchableOpacity
          style={[
            styles.recenterButton,
            isFollowing && styles.recenterButtonActive,
          ]}
          onPress={centerMapOnDriver}
          activeOpacity={0.85}
        >
          <Icon
            name="navigation"
            size={18}
            color={isFollowing ? "#f5b400" : "#fff"}
          />
        </TouchableOpacity>
      </View>

      {/* Small transparent grey info box */}
      <View style={styles.mapInfoBox} pointerEvents="none">
        <View style={styles.infoRow}>
          <MCIcon
            name={mapProvider === "GOOGLE_MAPS" ? "google-maps" : "map"}
            size={10}
            color="#f5b400"
          />
          <Text style={styles.infoText}>
            {mapProvider === "GOOGLE_MAPS" ? "Google" : "Native"}
          </Text>
        </View>

        <View style={styles.infoDivider} />

        <View style={styles.infoRow}>
          <MCIcon 
            name={hasLiveFix ? "crosshairs-gps" : "crosshairs"} 
            size={10} 
            color={hasLiveFix ? "#32d296" : "#8d95ad"} 
          />
          <Text style={[styles.infoText, { color: hasLiveFix ? "#32d296" : "#8d95ad" }]}>
            {hasLiveFix ? "GPS" : "No GPS"}
          </Text>
        </View>

        {speedKmh !== null && (
          <>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <MCIcon name="speedometer" size={10} color="#f5b400" />
              <Text style={styles.infoText}>
                {Math.round(speedKmh)} km/h
              </Text>
            </View>
          </>
        )}

        <View style={styles.infoDivider} />
        <View style={styles.infoRow}>
          <MCIcon name="update" size={10} color={countdown <= 1 ? "#f5b400" : "#8d95ad"} />
          <Text style={[styles.infoText, { color: countdown <= 1 ? "#f5b400" : "#8d95ad" }]}>
            {countdown}s
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom: 12,
  },
  mapContainer: {
    height: 200,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#1a1d29",
    position: "relative",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1d29",
    padding: 20,
  },
  mapPlaceholderText: {
    marginTop: 12,
    fontSize: 14,
    color: "#8d95ad",
    textAlign: "center",
  },
  mapPlaceholderRetry: {
    marginTop: 8,
    fontSize: 13,
    color: "#f5b400",
    fontWeight: "600",
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(26, 29, 41, 0.9)",
  },
  mapLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#8d95ad",
  },
  mapControls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
    padding: 12,
    pointerEvents: "box-none",
  },
  mapInfoBox: {
    position: "absolute",
    top: 12,
    left: 12,
    backgroundColor: "rgba(26, 29, 41, 0.8)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  infoText: {
    fontSize: 9,
    fontWeight: "600",
    color: "#fff",
  },
  infoDivider: {
    width: 1,
    height: 10,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  mapInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1a1d29",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  statusBadgeInactive: {
    backgroundColor: "#1a1d29",
    borderColor: "#2a2f3f",
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  speedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(245, 180, 0, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  speedText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
  intervalBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(59, 130, 246, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
  },
  intervalText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  recenterButton: {
    alignSelf: "flex-end",
    backgroundColor: "rgba(26, 29, 41, 0.85)",
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  recenterButtonActive: {
    borderColor: "#f5b400",
  },
  centerMarkerContainer: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -20,
    marginTop: -20,
    pointerEvents: "none",
    zIndex: 999,
  },
  navigationMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#3b82f6",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  carMarker: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1e2230",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#f5b400",
  },
});
