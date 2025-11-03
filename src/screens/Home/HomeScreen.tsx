import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    ActivityIndicator,
    Animated,
    FlatList,
    Modal,
    RefreshControl,
    SafeAreaView,
    ScrollView,
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
import Toast from "react-native-toast-message";
import Icon from "react-native-vector-icons/Feather";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";

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

import Typography from "../../components/design/Typography";
import { useAuth } from "../../context/AuthContext";
import { useJob } from "../../context/JobContext";
import { useLocation } from "../../context/LocationContext";
import { useShift } from "../../context/ShiftContext";
import { useZone } from "../../context/ZoneContext";
import { usePreventAppClose } from "../../hooks/usePreventAppClose";
import {
    updateLocationInterval,
    type LocationUpdate,
} from "../../native/locationService";
import { AppStackParamList } from "../../navigation/RootNavigator";
import {
    fetchCompanySettings,
    MapProvider,
} from "../../services/companySettingsService";
import {
    claimUpcomingJob,
    fetchUpcomingJobs,
    updateDriverShiftStatus,
    type DriverShiftStatus,
    type UpcomingJobSummary,
} from "../../services/driverService";
import { getSocket, updateSocketIntervals } from "../../services/driverSocket";
import httpClient from "../../services/httpClient";
import { Colors } from "../../theme/colors";
import { RideSummary } from "../../types/rides";
import { ActiveShift } from "../../types/shift";
import { DriverVehicle } from "../../types/vehicle";
import { calculateDistance, formatDistance } from "../../utils/distance";

const DEFAULT_COORDS = {
  latitude: 25.2854,
  longitude: 51.531,
};

const normalizeMapProvider = (value?: string | null): MapProvider => {
  if (!value) {
    return "NATIVE"; // Default to free native maps
  }
  const normalized = value.toUpperCase().replace(/\s+/g, "_");
  if (normalized.includes("NATIVE") || normalized.includes("DEFAULT")) {
    return "NATIVE";
  }
  if (normalized.includes("GOOGLE")) {
    return "GOOGLE_MAPS";
  }
  if (normalized.includes("OPEN") && normalized.includes("MAP")) {
    return "OPENSTREETMAP";
  }
  return "NATIVE"; // Default fallback to free native maps
};

type DriverAvailability = "AVAILABLE" | "AWAY" | "BUSY";

const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;

const formatDuration = (minutes?: number): string => {
  if (!minutes || minutes <= 0) return "0m";
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [];
  if (hrs > 0) {
    parts.push(`${hrs}h`);
  }
  if (mins > 0) {
    parts.push(`${mins}m`);
  }
  return parts.join(" ") || "0m";
};

const DashboardMetric: React.FC<{
  icon: string;
  label: string;
  value: string;
  color: string;
}> = ({ icon, label, value, color }) => (
  <View style={styles.metricCard}>
    <MCIcon name={icon} size={24} color={color} />
    <Text style={[styles.metricValue, { color }]}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>
);

const RideHistoryCard: React.FC<{ ride: RideSummary }> = ({ ride }) => (
  <View style={styles.rideCard}>
    <View style={styles.rideRow}>
      <MCIcon name="account" size={18} color="#f5b400" />
      <Text style={styles.rideText}>{ride.passenger?.name || "Passenger"}</Text>
      <View style={styles.rideBadge}>
        <Text style={styles.rideBadgeText}>{ride.status}</Text>
      </View>
    </View>
    <View style={styles.rideRow}>
      <MCIcon name="map-marker" size={16} color="#8d95ad" />
      <Text style={styles.rideSubText} numberOfLines={1}>
        {ride.pickupAddress || "Pickup location"}
      </Text>
    </View>
    <View style={styles.rideRow}>
      <MCIcon name="flag-checkered" size={16} color="#8d95ad" />
      <Text style={styles.rideSubText} numberOfLines={1}>
        {ride.dropoffAddress || "Dropoff location"}
      </Text>
    </View>
    <View style={[styles.rideRow, styles.rideFooter]}>
      <Text style={styles.rideFooterText}>
        {formatCurrency(ride.payment?.driverEarnings || 0)}
      </Text>
      <Text style={styles.rideFooterText}>
        {ride.distance ? `${ride.distance.toFixed(1)} km` : "Distance N/A"}
      </Text>
    </View>
  </View>
);

const AnimatedMarker = Animated.createAnimatedComponent(Marker);
const MIN_DELTA = 0.003;
const MAX_DELTA = 0.12;
const DEFAULT_ACTIVE_DELTA = 0.025;
const DEFAULT_IDLE_DELTA = 0.045;
const ZOOM_FACTOR = 0.65;

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
  locationUpdateInterval?: number; // Unified interval for GPS detection, map updates, and socket emissions (milliseconds)
}

const LocationMap: React.FC<LocationMapProps> = ({
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
  const initialDelta = hasLiveFix ? DEFAULT_ACTIVE_DELTA : DEFAULT_IDLE_DELTA;
  const [latitudeDelta, setLatitudeDelta] = useState(initialDelta);
  const [markerTracksChanges, setMarkerTracksChanges] = useState(true);

  const animatedCoordinate = useRef(
    new AnimatedRegion({
      latitude: derivedLatitude,
      longitude: derivedLongitude,
      latitudeDelta: initialDelta,
      longitudeDelta: initialDelta,
    })
  ).current;

  // Convert MapProvider string to react-native-maps provider constant
  const mapProviderConstant =
    mapProvider === "GOOGLE_MAPS" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;
  const isGoogleProvider = mapProvider === "GOOGLE_MAPS";

  // ✅ DISABLED: Too noisy - only log on critical state changes
  // useEffect(() => {
  //   console.log("🗺️ LocationMap Debug:", {
  //     hasLocation: !!location,
  //     mapReady,
  //     mapError,
  //   });
  // }, [location, mapReady, mapError]);

  // Map load timeout detection
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!mapReady && !mapError) {
        console.log("🗺️ Map loading timeout - showing fallback");
        setMapLoadTimeout(true);
        setMapError("Map loading timeout. Tap to retry.");
      }
    }, 10000); // 10 second timeout

    if (mapReady) {
      clearTimeout(timeoutId);
      setMapLoadTimeout(false);
    }

    return () => clearTimeout(timeoutId);
  }, [mapReady, mapError]);

  const zonePolygon = useMemo(() => {
    if (!zoneCoordinates || zoneCoordinates.length < 3) {
      return null;
    }

    return zoneCoordinates.map((coord) => ({
      latitude: coord.lat,
      longitude: coord.lng,
    }));
  }, [zoneCoordinates]);

  // ✅ Disable marker view tracking after initial render for performance
  useEffect(() => {
    const timer = setTimeout(() => {
      console.log("🎯 Disabling marker tracksViewChanges for performance");
      setMarkerTracksChanges(false);
    }, 3000); // Wait 3 seconds after mount
    return () => clearTimeout(timer);
  }, []);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdatedAt) return null;
    const parsed = new Date(lastUpdatedAt);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    const diffMs = Date.now() - parsed.getTime();
    if (diffMs < 0) return null;
    if (diffMs < 30_000) {
      return "Updated just now";
    }
    if (diffMs < 60_000) {
      return "Updated <1 min ago";
    }
    if (diffMs < 60 * 60_000) {
      const mins = Math.round(diffMs / 60_000);
      return `Updated ${mins} min ago`;
    }
    return `Updated ${parsed.toLocaleTimeString()}`;
  }, [lastUpdatedAt]);

  const deltaToZoom = useCallback((delta: number) => {
    const safeDelta = Math.max(delta, MIN_DELTA);
    const zoom = Math.log2(360 / safeDelta);
    return Math.max(2, Math.min(20, zoom));
  }, []);

  const animateCamera = useCallback(
    (duration = 600) => {
      if (!mapRef.current || !mapReady || !isFollowing) {
        return;
      }

      const center = { latitude: derivedLatitude, longitude: derivedLongitude };

      // EXACT WORKING CONFIG FROM JobTrackingScreen.js
      mapRef.current.animateCamera(
        {
          center,
          heading: parseInt(heading.toString()), 
          pitch: 60,
          zoom: 17,
          altitude: 500,
        },
        { duration: 500 }
      );
    },
    [
      derivedLatitude,
      derivedLongitude,
      heading,
      isFollowing,
      mapReady,
    ]
  );

  useEffect(() => {
    if (!hasLiveFix) {
      animatedCoordinate.stopAnimation(() => {});
      animatedCoordinate.setValue({
        latitude: derivedLatitude,
        longitude: derivedLongitude,
        latitudeDelta,
        longitudeDelta: latitudeDelta,
      });
      
      // ✅ DEBUG: Log marker position
      console.log('🎯 Marker position (no GPS fix):', {
        lat: derivedLatitude.toFixed(6),
        lng: derivedLongitude.toFixed(6),
        usingFallback: true
      });
      return;
    }

    // ✅ DEBUG: Log marker position updates
    console.log('🎯 Marker position (GPS):', {
      lat: derivedLatitude.toFixed(6),
      lng: derivedLongitude.toFixed(6),
      heading: heading.toFixed(1),
      speed: speedKmh?.toFixed(1) || '0'
    });

    animatedCoordinate
      .timing({
        latitude: derivedLatitude,
        longitude: derivedLongitude,
        duration: 100, // Reduced from 650ms to 100ms for faster animation
        useNativeDriver: false,
        toValue: 0,
        latitudeDelta: 0,
        longitudeDelta: 0,
      })
      .start();

    if (isFollowing && mapReady) {
      animateCamera(500);
    }
  }, [
    hasLiveFix,
    derivedLatitude,
    derivedLongitude,
    animatedCoordinate,
    isFollowing,
    mapReady,
    animateCamera,
    latitudeDelta,
    heading, // ✨ NEW: Re-animate when heading changes to rotate map
  ]);

  useEffect(() => {
    if (!mapReady || !isFollowing) {
      return;
    }
    animateCamera(450);
  }, [latitudeDelta, animateCamera, mapReady, isFollowing]);

  useEffect(() => {
    const targetDelta = hasLiveFix ? DEFAULT_ACTIVE_DELTA : DEFAULT_IDLE_DELTA;
    if (!isFollowing) {
      return;
    }
    setLatitudeDelta((current) => {
      const blended = Math.min(Math.max(targetDelta, MIN_DELTA), MAX_DELTA);
      return Math.abs(current - blended) < 0.0005 ? current : blended;
    });
  }, [hasLiveFix, isFollowing]);

  const handleZoomIn = useCallback(() => {
    setLatitudeDelta((prev) => Math.max(MIN_DELTA, prev * ZOOM_FACTOR));
    setIsFollowing(true);
  }, []);

  const handleZoomOut = useCallback(() => {
    setLatitudeDelta((prev) => Math.min(MAX_DELTA, prev / ZOOM_FACTOR));
    setIsFollowing(true);
  }, []);

  const handleUserGesture = useCallback(() => {
    if (isFollowing) {
      setIsFollowing(false);
    }
  }, [isFollowing]);

  const recenter = useCallback(() => {
    setIsFollowing(true);
    animateCamera(400);
  }, [animateCamera]);

  const retryMapLoad = useCallback(() => {
    console.log("🗺️ Retrying map load...");
    setMapReady(false);
    setMapError(null);
    setMapLoadTimeout(false);
    setMapKey((prev) => prev + 1); // Force re-render
  }, []);

  const motionStateLabel =
    speedKmh != null && speedKmh >= 2 ? "Moving" : "Stationary";
  const motionStateColor =
    speedKmh != null && speedKmh >= 2 ? "#22c55e" : "rgba(148,163,184,0.45)";

  return (
    <View style={styles.mapWrapper}>
      <View style={styles.mapHeader}>
        <Typography variant="titleSmall" color={Colors.text.inverse}>
          Live Location
        </Typography>
        {vehicle ? (
          <View style={styles.vehicleBadge}>
            <MCIcon name="car-side" size={16} color="#0f172a" />
            <Text style={styles.vehicleBadgeText} numberOfLines={1}>
              {vehicle.make} {vehicle.model} · {vehicle.licensePlate}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.mapContainer}>
        {/* Debug info */}
        <View
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            backgroundColor: "rgba(0,0,0,0.7)",
            padding: 8,
            borderRadius: 4,
            zIndex: 1000,
          }}
        >
          <Text style={{ color: "white", fontSize: 10 }}>
            Provider: GOOGLE{"\n"}
            Lat: {derivedLatitude.toFixed(4)}
            {"\n"}
            Lng: {derivedLongitude.toFixed(4)}
            {"\n"}
            Ready: {mapReady ? "Yes" : "No"}
            {"\n"}
            Interval:{" "}
            {locationUpdateInterval
              ? `${(locationUpdateInterval / 1000).toFixed(1)}s`
              : "N/A"}
            {"\n"}
            Updated:{" "}
            {location?.timestamp
              ? new Date(location.timestamp).toLocaleTimeString()
              : "N/A"}
          </Text>
        </View>

        <MapView
          ref={mapRef}
          style={styles.map}
          provider={mapProviderConstant}
          customMapStyle={isGoogleProvider ? MINIMAL_MAP_STYLE : undefined}
          initialRegion={{
            latitude: derivedLatitude,
            longitude: derivedLongitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation={false}
          showsMyLocationButton={true}
          showsCompass={false}
          scrollEnabled={true}
          zoomEnabled={true}
          followsUserLocation={false}
          showsTraffic={false}
          pitchEnabled={true}
          rotateEnabled={true}
          showsBuildings={false}
          mapType="standard"
          userLocationUpdateInterval={locationUpdateInterval || 2000}
          onMapReady={() => {
            console.log(`🗺️ Map ready (Provider: ${mapProvider})`);
            setMapReady(true);
          }}
        >
          {zonePolygon ? (
            <Polygon
              coordinates={zonePolygon}
              strokeColor="rgba(63, 131, 248, 0.9)"
              fillColor="rgba(63, 131, 248, 0.18)"
              strokeWidth={2}
            />
          ) : null}

          {/* ✅ DRIVER MARKER - Same design as ActiveRideScreen */}
          <AnimatedMarker
            coordinate={{
              latitude: animatedCoordinate.latitude,
              longitude: animatedCoordinate.longitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={true}
            tracksViewChanges={markerTracksChanges}
            zIndex={1000}
            opacity={1}
            rotation={heading}
          >
            <View
              style={styles.vehicleMarker}
              pointerEvents="none"
            >
              <MCIcon name="navigation" size={24} color="#fff" />
            </View>
          </AnimatedMarker>

          {/* 🔥 FALLBACK: Regular marker to ensure something shows */}
          <Marker
            coordinate={{
              latitude: derivedLatitude,
              longitude: derivedLongitude,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            flat={true}
            zIndex={999}
            opacity={1}
          >
            <View
              style={[styles.vehicleMarker, { backgroundColor: '#ef4444' }]}
              pointerEvents="none"
            >
              <MCIcon name="car" size={20} color="#fff" />
            </View>
          </Marker>
          
          {/* ✅ DEBUG: Static marker at default location for testing */}
          {!hasLiveFix && (
            <Marker
              coordinate={{
                latitude: derivedLatitude,
                longitude: derivedLongitude,
              }}
              title="Fallback Position"
              description="Waiting for GPS fix..."
              pinColor="#FF6B6B"
            />
          )}
        </MapView>

        {!mapReady && !mapError && !mapLoadTimeout ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color="#f5b400" />
            <Text style={styles.mapLoadingText}>Loading map…</Text>
          </View>
        ) : null}

        {mapLoadTimeout && !mapError && !mapReady ? (
          <View style={styles.mapFallback}>
            <MCIcon name="map-outline" size={48} color="#6b7280" />
            <Text style={styles.mapFallbackTitle}>Map Unavailable</Text>
            <Text style={styles.mapFallbackText}>
              Location: {derivedLatitude.toFixed(4)},{" "}
              {derivedLongitude.toFixed(4)}
            </Text>
            <TouchableOpacity
              style={styles.mapFallbackButton}
              onPress={retryMapLoad}
              activeOpacity={0.8}
            >
              <MCIcon name="refresh" size={16} color="#fff" />
              <Text style={styles.mapFallbackButtonText}>Retry Map</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {mapError ? (
          <TouchableOpacity
            style={styles.mapError}
            onPress={retryMapLoad}
            activeOpacity={0.8}
          >
            <MCIcon name="alert-circle" size={16} color="#f97316" />
            <View style={styles.mapErrorContent}>
              <Text style={styles.mapErrorText} numberOfLines={2}>
                {mapError}
              </Text>
              <Text style={styles.mapErrorRetry}>Tap to retry</Text>
            </View>
          </TouchableOpacity>
        ) : null}

        <View style={styles.mapControls}>
          <TouchableOpacity
            style={styles.mapControlButton}
            onPress={handleZoomIn}
            activeOpacity={0.85}
          >
            <MCIcon name="plus" size={18} color="#f8fafc" />
          </TouchableOpacity>
          <View style={styles.mapControlDivider} />
          <TouchableOpacity
            style={styles.mapControlButton}
            onPress={handleZoomOut}
            activeOpacity={0.85}
          >
            <MCIcon name="minus" size={18} color="#f8fafc" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.mapRecenterButton}
          onPress={recenter}
          activeOpacity={0.85}
        >
          <MCIcon
            name={isFollowing ? "crosshairs" : "crosshairs-gps"}
            size={16}
            color="#f8fafc"
          />
          <Text style={styles.mapRecenterText}>
            {isFollowing ? "Following" : "Recenter"}
          </Text>
        </TouchableOpacity>

        {mapReady && !mapError ? (
          <View style={styles.mapOverlay}>
            {/* Consolidated Inline Status Row - All badges in one line */}
            <View style={styles.mapStatusInline}>
              {/* Following/Manual Badge */}
              <View style={styles.mapStatusBadge}>
                <MCIcon
                  name={isFollowing ? "crosshairs-gps" : "gesture-tap"}
                  size={12}
                  color="#38bdf8"
                />
                <Text style={styles.mapStatusTextCompact}>
                  {isFollowing ? "Following" : "Manual"}
                </Text>
              </View>

              {/* Zone Info */}
              {zoneName && (
                <View style={styles.mapStatusBadge}>
                  <MCIcon name="map-marker" size={12} color="#f5b400" />
                  <Text style={styles.mapStatusTextCompact}>{zoneName}</Text>
                </View>
              )}

              {/* Motion State */}
              <View
                style={[
                  styles.mapMotionBadgeCompact,
                  { backgroundColor: motionStateColor },
                ]}
              >
                <Text style={styles.mapMotionTextCompact}>{motionStateLabel}</Text>
              </View>

              {/* Speed */}
              <View style={styles.mapStatusBadge}>
                <MCIcon name="speedometer" size={12} color="#f5b400" />
                <Text style={styles.mapStatusTextCompact}>
                  {speedKmh != null ? `${speedKmh.toFixed(0)} km/h` : "N/A"}
                </Text>
              </View>

              {/* Updated Time */}
              {lastUpdatedLabel && (
                <View style={styles.mapStatusBadge}>
                  <MCIcon name="clock-outline" size={12} color="#f5b400" />
                  <Text style={styles.mapStatusTextCompact}>{lastUpdatedLabel}</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
};

// ✅ NEW: Today's Stats Component
const TodayStatsSection: React.FC<{ onStatsLoaded?: (todayJobs: number) => void }> = ({ onStatsLoaded }) => {
  const [stats, setStats] = useState<{ todayJobs: number; todayEarnings: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTodayStats = async () => {
      try {
        const response = await httpClient.get('/mobile/driver/jobs/stats/today');
        if (response?.success && response?.stats) {
          setStats(response.stats);
          // ✅ FIX: Notify parent component of today's job count for ride history sync
          if (onStatsLoaded && typeof response.stats.todayJobs === 'number') {
            onStatsLoaded(response.stats.todayJobs);
          }
        } else if (response?.data?.success && response?.data?.stats) {
          // ✅ FIX: Handle wrapped response format
          setStats(response.data.stats);
          if (onStatsLoaded && typeof response.data.stats.todayJobs === 'number') {
            onStatsLoaded(response.data.stats.todayJobs);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch today stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTodayStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchTodayStats, 30000);
    return () => clearInterval(interval);
  }, [onStatsLoaded]);

  if (loading) {
    return null; // Don't show anything while loading initially
  }

  if (!stats) {
    return null; // Don't show if no stats
  }

  return (
    <View style={styles.todayStatsContainer}>
      <Text style={styles.todayStatsTitle}>Today's Performance</Text>
      <View style={styles.todayStatsSingleCard}>
        <View style={styles.todayStatRow}>
          <MCIcon name="briefcase-check" size={28} color="#10b981" />
          <View style={styles.todayStatTextContainer}>
            <Text style={styles.todayStatValue}>{stats.todayJobs} Trips</Text>
            <Text style={styles.todayStatLabel}>Jobs Completed</Text>
          </View>
        </View>
        <View style={styles.todayStatDivider} />
        <View style={styles.todayStatRow}>
          <MCIcon name="cash-multiple" size={28} color="#3b82f6" />
          <View style={styles.todayStatTextContainer}>
            <Text style={styles.todayStatValue}>${stats.todayEarnings}</Text>
            <Text style={styles.todayStatLabel}>Total Earnings</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

interface DashboardProps {
  driverName?: string;
  companyName?: string;
  shift: ActiveShift;
  tariffName?: string;
  tariff?: {
    baseFare: number;
    perKmRate: number;
    perMinuteRate: number;
    waitingTimeRate?: number;
  } | null;
  onEndShift: () => void;
  rideHistory: RideSummary[];
  rideHistoryLoading: boolean;
  onRefreshShift: () => Promise<void>;
  onRefreshHistory: () => Promise<void>;
  jobStatusMessage: string;
  onStartWalkInJob?: () => void;
  creatingWalkInJob?: boolean;
  location: LocationUpdate | null;
  vehicle?: DriverVehicle | null;
  onChangeTariff: () => void;
  onPressStatus: () => void;
  driverStatus: DriverAvailability;
  zoneName?: string | null;
  zoneLoading?: boolean;
  zoneError?: string | null;
  onRetryZone?: () => Promise<void> | void;
  mapProvider: MapProvider;
  mapProviderLoading: boolean;
  zoneCoordinates?: Array<{ lat: number; lng: number }> | null;
  locationUpdateInterval?: number; // Unified interval for GPS, map, and socket
  shouldShowUpcomingJobs: boolean;
  upcomingJobs: UpcomingJobSummary[];
  upcomingJobsLoading: boolean;
  upcomingJobsError: string | null;
  onClaimUpcomingJob: (jobId: string) => void;
  claimingJobId: string | null;
  hasPendingAction: boolean;
  onStatsLoaded?: (todayJobs: number) => void; // ✅ NEW: Callback for stats sync
}

const DashboardView: React.FC<DashboardProps> = ({
  driverName,
  companyName,
  shift,
  tariffName,
  tariff,
  onEndShift,
  rideHistory,
  rideHistoryLoading,
  onRefreshShift,
  onRefreshHistory,
  jobStatusMessage,
  onStartWalkInJob,
  creatingWalkInJob,
  location,
  vehicle,
  onChangeTariff,
  onPressStatus,
  driverStatus,
  zoneName,
  zoneLoading,
  zoneError,
  onRetryZone,
  mapProvider,
  mapProviderLoading,
  zoneCoordinates,
  locationUpdateInterval,
  shouldShowUpcomingJobs,
  upcomingJobs,
  upcomingJobsLoading,
  upcomingJobsError,
  onClaimUpcomingJob,
  claimingJobId,
  hasPendingAction,
  onStatsLoaded, // ✅ NEW: Callback for stats sync
}) => {
  const [refreshing, setRefreshing] = useState(false);

  const statusMeta = useMemo(() => {
    switch (driverStatus) {
      case "AWAY":
        return { label: "Away", color: "#f97316" };
      case "BUSY":
        return { label: "On a job", color: "#38bdf8" };
      case "AVAILABLE":
      default:
        return { label: "Online", color: "#4ade80" };
    }
  }, [driverStatus]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([onRefreshShift(), onRefreshHistory()]);
    setRefreshing(false);
  }, [onRefreshHistory, onRefreshShift]);

  const totalEarnings = shift.stats?.totalEarnings ?? 0;
  const totalRides = shift.stats?.totalRides ?? 0;
  const durationLabel = formatDuration(shift.duration);

  return (
    <View style={styles.dashboardContainer}>
      {/* Sticky Header */}
      <View style={styles.stickyHeader}>
        <View style={styles.headerContent}>
          <View style={styles.driverInfo}>
            <View style={styles.avatarCircle}>
              <MCIcon name="account" size={26} color="#f5b400" />
            </View>
            <View style={styles.driverDetails}>
              <Text style={styles.driverName} numberOfLines={1}>
                {driverName || "Driver"}
              </Text>
              <TouchableOpacity
                style={styles.statusRow}
                onPress={onPressStatus}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: statusMeta.color },
                  ]}
                />
                <Text style={[styles.statusText, { color: statusMeta.color }]}>
                  {statusMeta.label}
                </Text>
              </TouchableOpacity>
              {zoneName ? (
                <View style={styles.zonePill}>
                  <MCIcon
                    name="map-marker-radius"
                    size={12}
                    color={Colors.accent.highlight}
                  />
                  <Text style={styles.zonePillText} numberOfLines={1}>
                    {zoneName}
                  </Text>
                </View>
              ) : zoneLoading ? (
                <View style={styles.zonePillMuted}>
                  <MCIcon name="crosshairs" size={12} color="#8d95ad" />
                  <Text style={styles.zonePillText} numberOfLines={1}>
                    Detecting zone…
                  </Text>
                </View>
              ) : (
                <Text style={styles.companyLabel}>
                  {companyName || "Fleet"}
                </Text>
              )}
              {zoneError ? (
                <TouchableOpacity
                  style={styles.zoneRetryPill}
                  onPress={() => void onRetryZone?.()}
                  disabled={zoneLoading}
                  activeOpacity={0.85}
                >
                  <MCIcon name="alert-circle" size={12} color={Colors.danger} />
                  <Text style={styles.zoneRetryPillText} numberOfLines={1}>
                    {zoneLoading ? "Retrying zone detection…" : zoneError}
                  </Text>
                  {!zoneLoading ? (
                    <Text style={styles.zoneRetryPillCta}>Retry</Text>
                  ) : null}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          <TouchableOpacity
            style={styles.endShiftButton}
            onPress={onEndShift}
            activeOpacity={0.85}
          >
            <MCIcon name="power" size={18} color="#fff" />
            <Text style={styles.endShiftText}>End</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Scrollable Content */}
      <ScrollView
        style={styles.dashboardScroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#fff"
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.tariffCard}
          onPress={onChangeTariff}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <View style={styles.tariffHeaderRow}>
            <Text style={styles.tariffTitle}>
              Tariff: {tariffName || "Not selected"}
            </Text>
            <MCIcon name="chart-line" size={20} color="#32d296" />
          </View>
          {tariff ? (
            <View style={styles.tariffRatesRow}>
              <Text style={styles.tariffRate}>
                S: {formatCurrency(tariff.baseFare)}
              </Text>
              <Text style={styles.tariffRate}>
                D: {formatCurrency(tariff.perKmRate)}/km
              </Text>
              <Text style={styles.tariffRate}>
                T: {formatCurrency(tariff.perMinuteRate)}/min
              </Text>
              <Text style={styles.tariffRate}>
                W: {formatCurrency(tariff.waitingTimeRate ?? 1)}/min
              </Text>
            </View>
          ) : (
            <Text style={styles.tariffRate}>Tariff details unavailable.</Text>
          )}
        </TouchableOpacity>

        <LocationMap
          location={location}
          fallbackLatitude={shift.startLocation?.latitude}
          fallbackLongitude={shift.startLocation?.longitude}
          vehicle={vehicle}
          zoneName={zoneName}
          zoneLoading={zoneLoading}
          mapProvider={mapProvider}
          mapProviderLoading={mapProviderLoading}
          zoneCoordinates={zoneCoordinates ?? null}
          lastUpdatedAt={
            location?.timestamp
              ? new Date(location.timestamp).toISOString()
              : null
          }
          locationUpdateInterval={locationUpdateInterval}
        />

        <View style={styles.overviewSection}>
          <Text style={styles.sectionTitle}>Today's Overview</Text>
          <View style={styles.metricRow}>
            <DashboardMetric
              icon="cash"
              label="Earnings"
              value={formatCurrency(totalEarnings)}
              color="#f5b400"
            />
            <DashboardMetric
              icon="check-circle"
              label="Trips"
              value={`${totalRides}`}
              color="#32d296"
            />
            <DashboardMetric
              icon="clock-outline"
              label="Online Time"
              value={durationLabel}
              color="#60a5fa"
            />
          </View>
        </View>

        <View style={styles.jobStatusCard}>
          <MCIcon name="information-outline" size={20} color="#ff7849" />
          <Text style={styles.jobStatusText}>{jobStatusMessage}</Text>
        </View>

        {shouldShowUpcomingJobs ? (
          <View style={styles.upcomingSection}>
            <View style={styles.upcomingHeader}>
              <Text style={styles.sectionTitle}>Available Jobs Nearby</Text>
              {upcomingJobsLoading ? (
                <ActivityIndicator size="small" color={Colors.accent.highlight} />
              ) : null}
            </View>
            {upcomingJobsError ? (
              <Text style={styles.upcomingError}>{upcomingJobsError}</Text>
            ) : upcomingJobs.length === 0 && !upcomingJobsLoading ? (
              <Text style={styles.upcomingEmpty}>No late or imminent jobs in your zone.</Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.upcomingScroll}
                contentContainerStyle={styles.upcomingScrollContent}
              >
                {upcomingJobs.map((job) => {
                  const etaLabel = job.isLate
                    ? job.minutesToPickup < 0
                      ? `Late by ${Math.abs(job.minutesToPickup)} min`
                      : 'Pickup overdue'
                    : job.minutesToPickup > 0
                    ? `Pickup in ${job.minutesToPickup} min`
                    : 'Pickup ASAP';

                  const distance = job.distanceToPickup || job.estimatedDistance;

                  return (
                    <View key={job.id} style={styles.upcomingCard}>
                      <View style={styles.upcomingHeaderRow}>
                        <Text style={styles.upcomingTitle} numberOfLines={2}>
                          {job.pickup.address || 'Pickup location'}
                        </Text>
                        {distance != null ? (
                          <View style={styles.distanceBadge}>
                            <MCIcon name="map-marker-distance" size={14} color="#fff" />
                            <Text style={styles.distanceBadgeText}>{formatDistance(distance)}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.upcomingSubtitle} numberOfLines={2}>
                        → {job.dropoff.address || 'Dropoff location'}
                      </Text>
                      <View style={styles.upcomingMetaRow}>
                        <MCIcon name="clock-outline" size={14} color="#8d95ad" />
                        <Text style={styles.upcomingMeta}>{etaLabel}</Text>
                      </View>
                      {typeof job.estimatedFare === 'number' ? (
                        <View style={styles.upcomingMetaRow}>
                          <MCIcon name="cash" size={14} color="#32d296" />
                          <Text style={styles.upcomingMeta}>
                            {formatCurrency(job.estimatedFare)}
                          </Text>
                        </View>
                      ) : null}
                      <TouchableOpacity
                        style={styles.upcomingButton}
                        onPress={() => onClaimUpcomingJob(job.id)}
                        disabled={claimingJobId === job.id || hasPendingAction}
                        activeOpacity={0.85}
                      >
                        {claimingJobId === job.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.upcomingButtonText}>Start Ride</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}

        {onStartWalkInJob && driverStatus === 'AVAILABLE' && (
          <TouchableOpacity
            style={[styles.walkInButton, creatingWalkInJob && styles.walkInButtonDisabled]}
            onPress={onStartWalkInJob}
            activeOpacity={0.85}
            disabled={creatingWalkInJob}
          >
            {creatingWalkInJob ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MCIcon name="play-circle" size={20} color="#fff" />
                <Text style={styles.walkInButtonText}>Start Walk-In Job</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Today's Stats Section */}
        <TodayStatsSection onStatsLoaded={onStatsLoaded} />

        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Previous Trips</Text>
          {rideHistoryLoading && rideHistory.length === 0 ? (
            <View style={styles.loaderInline}>
              <ActivityIndicator color={Colors.accent.highlight} />
              <Text style={styles.loaderText}>Loading trip history…</Text>
            </View>
          ) : rideHistory.length === 0 ? (
            <Text style={styles.emptyState}>No trips completed yet.</Text>
          ) : (
            rideHistory.map((ride) => (
              <RideHistoryCard key={ride.id} ride={ride} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const VehicleItem: React.FC<{
  vehicle: DriverVehicle;
  isSelected: boolean;
  onPress: () => void;
}> = ({ vehicle, isSelected, onPress }) => (
  <TouchableOpacity
    style={[styles.vehicleCard, isSelected && styles.vehicleCardSelected]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    <View style={styles.vehicleIconWrap}>
      <MCIcon
        name={isSelected ? "car-check" : "car-info"}
        size={26}
        color={isSelected ? Colors.accent.highlight : "#6f778d"}
      />
    </View>
    <View style={styles.vehicleDetails}>
      <Text
        style={[styles.vehicleTitle, isSelected && styles.vehicleTitleSelected]}
      >
        {vehicle.make} {vehicle.model}
      </Text>
      <Text style={styles.vehicleSubtitle}>
        {vehicle.vehicleType || "Vehicle"} · {vehicle.licensePlate}
      </Text>
    </View>
    {isSelected ? (
      <MCIcon name="check-circle" size={22} color={Colors.success} />
    ) : null}
  </TouchableOpacity>
);

const VehicleSelectionView: React.FC<{
  driverName?: string;
  companyName?: string;
  vehicles: DriverVehicle[];
  vehiclesLoading: boolean;
  vehiclesError: string | null;
  selectedVehicle: DriverVehicle | null;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onSelectVehicle: (vehicle: DriverVehicle) => Promise<void>;
  onClearSelection: () => Promise<void>;
  onProceed: () => void;
  currentZoneName?: string | null;
  zoneLoading?: boolean;
  zoneError?: string | null;
  onRetryZone?: () => Promise<void> | void;
}> = ({
  driverName,
  companyName,
  vehicles,
  vehiclesLoading,
  vehiclesError,
  selectedVehicle,
  onLogout,
  onRefresh,
  onSelectVehicle,
  onClearSelection,
  onProceed,
  currentZoneName,
  zoneLoading,
  zoneError,
  onRetryZone,
}) => {
  const headerActionLabel = useMemo(
    () => (selectedVehicle ? "Change Vehicle" : "Select Vehicle"),
    [selectedVehicle]
  );

  const handlePrimaryAction = useCallback(async () => {
    if (selectedVehicle) {
      await onClearSelection();
    } else {
      await onRefresh();
    }
  }, [onClearSelection, onRefresh, selectedVehicle]);

  const renderVehicle = useCallback(
    ({ item }: { item: DriverVehicle }) => (
      <VehicleItem
        vehicle={item}
        isSelected={selectedVehicle?.id === item.id}
        onPress={() => onSelectVehicle(item)}
      />
    ),
    [onSelectVehicle, selectedVehicle?.id]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerRow}>
          <View>
            <Typography variant="titleLarge" color={Colors.text.inverse}>
              Start Your Shift
            </Typography>
            <Text style={styles.driverGreeting}>
              Hi {driverName || "there"} • {companyName || "Fleet"}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={onLogout}
            activeOpacity={0.85}
          >
            <Icon name="log-out" size={18} color={Colors.accent.logout} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.primaryLinkButton}
          onPress={handlePrimaryAction}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryLinkText}>{headerActionLabel}</Text>
          <Icon
            name={selectedVehicle ? "refresh-ccw" : "download"}
            size={16}
            color={Colors.accent.highlight}
          />
        </TouchableOpacity>

        <View style={styles.sectionHeader}>
          <Typography variant="titleSmall" color={Colors.text.inverse}>
            Choose Your Vehicle
          </Typography>
          {vehiclesLoading ? (
            <ActivityIndicator color={Colors.accent.highlight} size="small" />
          ) : null}
        </View>

        {vehiclesError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{vehiclesError}</Text>
            <TouchableOpacity onPress={onRefresh}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {currentZoneName ? (
          <View style={styles.vehicleZoneBanner}>
            <MCIcon
              name="map-marker-radius"
              size={16}
              color={Colors.accent.highlight}
            />
            <Text style={styles.vehicleZoneText} numberOfLines={1}>
              Zone detected: {currentZoneName}
            </Text>
          </View>
        ) : zoneLoading ? (
          <View style={styles.vehicleZoneBannerMuted}>
            <MCIcon name="crosshairs" size={16} color="#8d95ad" />
            <Text style={styles.vehicleZoneText} numberOfLines={1}>
              Detecting current zone…
            </Text>
          </View>
        ) : null}

        {/* ✅ Don't show zone error on vehicle selection - zone detection requires active shift */}
        {/* Zone will be detected automatically when shift starts and location tracking begins */}

        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          renderItem={renderVehicle}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          contentContainerStyle={
            vehicles.length === 0 ? styles.emptyList : undefined
          }
          ListEmptyComponent={
            !vehiclesLoading ? (
              <Text style={styles.emptyText}>
                No vehicles assigned yet. Please contact your fleet manager.
              </Text>
            ) : null
          }
          showsVerticalScrollIndicator={false}
        />

        <TouchableOpacity
          style={[
            styles.goOnlineButton,
            !selectedVehicle && styles.goOnlineButtonDisabled,
          ]}
          onPress={onProceed}
          disabled={!selectedVehicle}
          activeOpacity={0.9}
        >
          <MCIcon
            name="car"
            size={20}
            color={Colors.text.inverse}
            style={styles.goOnlineIcon}
          />
          <Text style={styles.goOnlineText}>Choose Vehicle</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const HomeScreen: React.FC = () => {
  const { logout, driver } = useAuth();
  const {
    vehicles,
    vehiclesLoading,
    vehiclesError,
    selectedVehicle,
    selectedTariff,
    tariffsLoading,
    activeShift,
    rideHistory,
    rideHistoryLoading,
    refreshVehicles,
    selectVehicle,
    clearSelection,
    refreshTariffs,
    refreshCurrentShift,
    refreshRideHistory,
    resetShiftState,
    endShift,
  } = useShift();
  const {
    status: jobStatus,
    currentJob,
    setIncomingJob,
    startWalkInJob, // ✅ NEW: For walk-in jobs (bypasses accept/reject)
    acceptJob,
    rejectJob,
    pendingAction,
    updateStatus, // ✅ NEW: For walk-in job flow
  } = useJob();
  const { stopTracking, startTracking, tracking, location } = useLocation();
  const {
    currentZone,
    loading: zoneLoading,
    error: zoneError,
    forceRefresh: retryZoneDetection,
  } = useZone();
  const [mapProvider, setMapProvider] = useState<MapProvider>("NATIVE");
  const [mapProviderLoading, setMapProviderLoading] = useState(false);
  const [locationUpdateInterval, setLocationUpdateInterval] =
    useState<number>(2000); // Default 2 seconds - unified interval for GPS, map, and socket
  const navigation =
    useNavigation<NativeStackNavigationProp<AppStackParamList, "Home">>();
  const [initialised, setInitialised] = useState(false);
  const [manualStatus, setManualStatus] =
    useState<Exclude<DriverAvailability, "BUSY">>("AVAILABLE");
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [awayReminderVisible, setAwayReminderVisible] = useState(false);
  const awayReminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJobSummary[]>([]);
  const [upcomingJobsLoading, setUpcomingJobsLoading] = useState(false);
  const [upcomingJobsError, setUpcomingJobsError] = useState<string | null>(
    null
  );
  const [claimingJobId, setClaimingJobId] = useState<string | null>(null);
  const [todayJobsCount, setTodayJobsCount] = useState<number>(0); // ✅ NEW: Track today's job count

  // ✅ FIX: Sync ride history with today's stats - fetch more history if needed
  const handleStatsLoaded = useCallback((todayJobs: number) => {
    setTodayJobsCount(todayJobs);
    
    // If today has more jobs than what's showing in ride history, fetch more
    if (todayJobs > rideHistory.length && todayJobs > 0) {
      console.log(`📊 Today has ${todayJobs} jobs but only showing ${rideHistory.length}, fetching more history`);
      refreshRideHistory(Math.max(todayJobs, 5)); // Fetch at least 5 or today's count
    }
  }, [rideHistory.length, refreshRideHistory]);
  const lastSyncedStatus = useRef<DriverShiftStatus | null>(null);
  const clearAwayReminder = useCallback(() => {
    if (awayReminderTimerRef.current) {
      clearTimeout(awayReminderTimerRef.current);
      awayReminderTimerRef.current = null;
    }
  }, []);
  const scheduleAwayReminder = useCallback(() => {
    clearAwayReminder();
    awayReminderTimerRef.current = setTimeout(() => {
      setAwayReminderVisible(true);
    }, 10000);
  }, [clearAwayReminder]);
  const syncStatus = useCallback(
    async (status: DriverShiftStatus) => {
      if (!activeShift?.id) {
        return;
      }
      if (lastSyncedStatus.current === status) {
        return;
      }
      try {
        await updateDriverShiftStatus(status);
        lastSyncedStatus.current = status;
      } catch (error) {
        console.error("Driver status sync failed", error);
      }
    },
    [activeShift?.id]
  );
  const jobStatusMessage = useMemo(() => {
    if (!currentJob) {
      return "No active jobs. Stay online to receive new requests!";
    }

    switch (jobStatus) {
      case "INCOMING":
        return "Incoming request — review and respond.";
      case "ASSIGNED":
      case "ACCEPTED":
        return "Head to the pickup location.";
      case "ON_THE_WAY":
        return "Proceeding to pickup.";
      case "ARRIVED":
        return "Arrived at pickup — notify rider.";
      case "STARTED":
        return "Ride in progress — meter running.";
      default:
        return "Job status: " + jobStatus;
    }
  }, [currentJob, jobStatus]);
  const isBusy = useMemo(
    () =>
      [
        "INCOMING",
        "ASSIGNED",
        "ACCEPTED",
        "ON_THE_WAY",
        "ARRIVED",
        "STARTED",
      ].includes(
        jobStatus
      ),
    [jobStatus]
  );
  const derivedStatus: DriverAvailability = useMemo(
    () => (isBusy ? "BUSY" : manualStatus),
    [isBusy, manualStatus]
  );
  const shouldShowUpcomingJobs = useMemo(() => {
    const result = !isBusy && !currentJob && Boolean(currentZone?.id) && Boolean(activeShift?.id);
    
    console.log('🔍 shouldShowUpcomingJobs calculation:', {
      result,
      isBusy,
      currentJob: !!currentJob,
      currentJobId: currentJob?.id,
      hasZone: Boolean(currentZone?.id),
      zoneId: currentZone?.id,
      zoneName: currentZone?.name,
      hasActiveShift: Boolean(activeShift?.id),
      activeShiftId: activeShift?.id,
      jobStatus,
    });
    
    return result;
  }, [isBusy, currentJob, currentZone?.id, currentZone?.name, activeShift?.id, jobStatus]);

  useEffect(() => {
    console.log("👤 DRIVER INFO:", {
      companyId: driver?.company?.id,
      driverId: driver?.id,
    });

    if (!driver?.company?.id) {
      console.warn("⚠️ No company ID found for driver, using default settings");
      setMapProvider("OPENSTREETMAP");
      setMapProviderLoading(false);
      const defaultInterval = 2; // 2 seconds - matches database default
      setLocationUpdateInterval(defaultInterval * 1000);
      // ✅ Initialize socket throttle with default
      updateSocketIntervals(defaultInterval, defaultInterval);
      console.log(`⚠️ Using DEFAULT intervals: ${defaultInterval}s (no company ID)`);
      return;
    }

    let active = true;
    setMapProviderLoading(true);

    console.log(`📡 Fetching company settings for companyId: ${driver?.company?.id}`);

    fetchCompanySettings(driver?.company?.id)
      .then(async (payload) => {
        console.log("🏢 RAW Company Settings Payload:", JSON.stringify(payload, null, 2));
        
        if (!active) {
          console.log("⏭️ Component unmounted, skipping settings update");
          return;
        }

        if (!payload) {
          console.error("❌ Company settings payload is null/undefined");
          throw new Error("Empty payload received from fetchCompanySettings");
        }

        if (!payload.settings) {
          console.error("❌ Company settings.settings is null/undefined:", payload);
          throw new Error("Settings object missing from payload");
        }

        console.log(
          "🚀 FETCHED COMPANY SETTINGS:",
          JSON.stringify(payload, null, 2)
        );

        // Set map provider
        const provider = normalizeMapProvider(
          (payload?.settings?.mapProvider as string | null) ?? null
        );
        setMapProvider(provider);

        // ✅ UNIFIED INTERVAL: Use company location update interval for GPS, map, and socket
        const intervalSeconds = payload?.settings?.locationUpdateInterval ?? 2; // Default 2s if not set
        const intervalMs = intervalSeconds * 1000;
        
        console.log("🔧 UNIFIED LOCATION INTERVAL CONFIG:", {
          intervalSeconds,
          intervalMs,
          source: payload?.settings?.locationUpdateInterval ? 'company_settings' : 'default',
          rawValue: payload?.settings?.locationUpdateInterval,
          usage: 'GPS detection + Map updates + Socket emissions',
          companyId: driver?.company?.id,
          companyName: driver?.company?.name,
        });
        
        setLocationUpdateInterval(intervalMs);
        console.log(`✅ Unified interval set to ${intervalMs}ms (${intervalSeconds}s) for GPS, map, and socket`);

        // Update native location service interval
        try {
          console.log(
            `🔄 Updating native GPS interval to ${intervalSeconds}s...`
          );
          await updateLocationInterval(intervalSeconds);
          console.log(
            `✅ GPS INTERVAL UPDATED: ${intervalSeconds}s (earliest detection at this rate)`
          );
        } catch (error) {
          console.error("❌ FAILED to update GPS interval:", error);
          console.error("   This means GPS is using default (2s) instead of company setting");
        }

        // ✅ CRITICAL: Use heartbeat from database, fallback to location interval if not set
        // Socket throttle MUST match location interval for unified control
        try {
          const companyHeartbeat = payload?.settings?.heartbeatInterval as number | undefined;
          // ✅ FIX: Don't calculate - use DB value or default to location interval
          const heartbeatSeconds = companyHeartbeat ?? intervalSeconds;
          
          console.log("💓 SOCKET CONFIG (DATABASE CONTROLLED):", {
            locationIntervalFromDB: intervalSeconds,
            heartbeatIntervalFromDB: companyHeartbeat,
            heartbeatUsed: heartbeatSeconds,
            heartbeatSource: companyHeartbeat ? 'database' : 'fallback_to_location_interval',
            note: '⚠️ Socket throttle = location interval (unified control)',
          });
          
          // ✅ CRITICAL: Both intervals controlled by database
          updateSocketIntervals(intervalSeconds, heartbeatSeconds);
          console.log(
            `✅ Socket configured from DATABASE - Location throttle: ${intervalSeconds}s, Heartbeat: ${heartbeatSeconds}s`
          );
        } catch (error) {
          console.error("❌ FAILED to update socket intervals:", error);
        }
      })
      .catch((error) => {
        if (active) {
          console.error("❌ Company settings load failed:", error);
          console.error("   Error details:", {
            message: error?.message,
            response: error?.response?.data,
            status: error?.response?.status,
            companyId: driver?.company?.id,
          });
          const fallbackInterval = 2; // 2 seconds default
          setMapProvider("GOOGLE_MAPS");
          setLocationUpdateInterval(fallbackInterval * 1000);
          // ✅ Initialize socket throttle with fallback
          updateSocketIntervals(fallbackInterval, fallbackInterval);
          console.log(`⚠️ Using FALLBACK intervals: ${fallbackInterval}s (settings load failed)`);
        }
      })
      .finally(() => {
        if (active) {
          setMapProviderLoading(false);
          console.log("✅ Company settings fetch complete");
        }
      });

    return () => {
      active = false;
    };
  }, [driver?.company?.id]);

  useEffect(() => {
    if (manualStatus === "AWAY" && !isBusy && !awayReminderVisible) {
      scheduleAwayReminder();
    } else {
      clearAwayReminder();
    }
  }, [
    manualStatus,
    isBusy,
    awayReminderVisible,
    scheduleAwayReminder,
    clearAwayReminder,
  ]);
  useEffect(() => {
    return () => {
      clearAwayReminder();
    };
  }, [clearAwayReminder]);
  useEffect(() => {
    if (!activeShift) {
      setStatusModalVisible(false);
      setManualStatus("AVAILABLE");
      setAwayReminderVisible(false);
      clearAwayReminder();
      lastSyncedStatus.current = null;
    }
  }, [activeShift, clearAwayReminder]);
  useEffect(() => {
    if (isBusy) {
      setStatusModalVisible(false);
      setAwayReminderVisible(false);
      clearAwayReminder();
    }
  }, [isBusy, clearAwayReminder]);

  useEffect(() => {
    if (!activeShift?.id) {
      return;
    }
    const targetStatus: DriverShiftStatus = isBusy
      ? "BUSY"
      : manualStatus === "AWAY"
        ? "AWAY"
        : "AVAILABLE";
    syncStatus(targetStatus);
  }, [activeShift?.id, isBusy, manualStatus, syncStatus]);

  useEffect(() => {
    if (!initialised && driver?.id) {
      // ✅ FIX: Refresh shift stats on mount to get latest earnings/trips data
      // We need to call this even though ShiftContext loads from storage, 
      // because storage might have stale stats
      
      // ⏱️ Wait 3 seconds before refreshing shift to allow server propagation after shift start
      const refreshTimer = setTimeout(() => {
        Promise.all([
          refreshCurrentShift(), // ✅ Get latest shift stats from server
          refreshVehicles(),
          refreshRideHistory(3),
        ])
          .catch((error) => console.error("Initial data load failed", error))
          .finally(() => setInitialised(true));
      }, 3000);

      return () => clearTimeout(refreshTimer);
    }
  }, [
    initialised,
    driver?.id,
    refreshCurrentShift, // ✅ Added to dependencies
    refreshRideHistory,
    refreshVehicles,
  ]);

  // Debounced focus refresh - only refresh if data is stale (> 30 seconds)
  const lastFocusRefresh = useRef(0);
  const FOCUS_REFRESH_DEBOUNCE = 30000; // 30 seconds

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const timeSinceLastRefresh = now - lastFocusRefresh.current;

      if (driver?.id && timeSinceLastRefresh > FOCUS_REFRESH_DEBOUNCE) {
        console.log("🔄 Refreshing shift stats and ride history (after 10s delay)");
        lastFocusRefresh.current = now;
        
        // ⏱️ Wait 10 seconds before refreshing to allow server propagation after shift start
        // 🔥 FIX: Changed from 3s to 10s to prevent premature shift validation that clears new shifts
        setTimeout(() => {
          // ✅ FIX: Refresh shift stats to get latest earnings/trips from server
          Promise.all([
            refreshCurrentShift(), // ✅ Get latest shift stats
            refreshRideHistory(3),
          ]).catch((error) =>
            console.error("Focus refresh failed", error)
          );
        }, 10000);
      } else {
        console.log("⏭️ Skipping refresh - data is fresh");
      }
    }, [driver?.id, refreshCurrentShift, refreshRideHistory])
  );

  // Helper function to calculate distances for jobs (doesn't trigger refetch)
  const calculateJobDistances = useCallback((jobs: UpcomingJobSummary[]) => {
    if (!location?.latitude || !location?.longitude) {
      return jobs;
    }

    const jobsWithDistance = jobs.map(job => {
      if (job.pickup?.latitude && job.pickup?.longitude) {
        const distanceToPickup = calculateDistance(
          location.latitude,
          location.longitude,
          job.pickup.latitude,
          job.pickup.longitude
        );
        return { ...job, distanceToPickup };
      }
      return job;
    });

    // Sort by distance (nearest first)
    return jobsWithDistance.sort((a, b) => {
      const distA = a.distanceToPickup || a.estimatedDistance || 999;
      const distB = b.distanceToPickup || b.estimatedDistance || 999;
      return distA - distB;
    });
  }, [location]);

  const refreshUpcomingJobs = useCallback(async () => {
    console.log('🔍 refreshUpcomingJobs CALLED:', {
      shouldShowUpcomingJobs,
      isBusy,
      hasCurrentJob: !!currentJob,
      hasZone: !!currentZone?.id,
      zoneName: currentZone?.name,
      hasActiveShift: !!activeShift?.id,
      shiftId: activeShift?.id,
    });

    if (!shouldShowUpcomingJobs) {
      console.log('⏭️ Skipping job fetch - conditions not met');
      setUpcomingJobs([]);
      setUpcomingJobsError(null);
      setUpcomingJobsLoading(false);
      return;
    }

    setUpcomingJobsLoading(true);
    setUpcomingJobsError(null);

    try {
      console.log('📡 Fetching upcoming jobs...', {
        zoneId: currentZone?.id,
        zoneName: currentZone?.name,
        driverId: driver?.id,
        companyId: driver?.company?.id,
      });
      
      const jobs = await fetchUpcomingJobs({ zoneId: currentZone?.id ?? null });
      
      console.log('✅ Upcoming jobs received:', {
        count: jobs?.length || 0,
        jobIds: jobs?.map(j => j.id) || [],
        firstJob: jobs?.[0] ? {
          id: jobs[0].id,
          pickup: jobs[0].pickup?.address,
          status: jobs[0].status,
        } : null,
      });
      
      // Just set jobs - don't calculate distances here
      setUpcomingJobs(jobs);
    } catch (error: any) {
      console.error('❌ Failed to load upcoming jobs:', {
        error: error.message,
        status: error?.response?.status,
        data: error?.response?.data,
      });
      const message =
        error?.response?.data?.message ||
        error?.message ||
        'Unable to load upcoming jobs.';
      setUpcomingJobsError(message);
      setUpcomingJobs([]);
    } finally {
      setUpcomingJobsLoading(false);
    }
  }, [shouldShowUpcomingJobs, currentZone?.id, currentZone?.name, driver?.id, driver?.company?.id, isBusy, currentJob, activeShift?.id]); // ✅ Added all dependencies for logging

  // Fetch jobs only when zone changes or feature is enabled
  useEffect(() => {
    console.log('🔄 Zone or feature changed, fetching jobs...');
    refreshUpcomingJobs();
  }, [refreshUpcomingJobs]);

  // ✅ OPTIMIZATION: Periodic refresh every 30 seconds (instead of on every location update)
  useEffect(() => {
    if (!shouldShowUpcomingJobs) return;
    
    console.log('⏰ Setting up 30-second periodic job refresh');
    const interval = setInterval(() => {
      console.log('🔄 Periodic jobs refresh (30s interval)');
      refreshUpcomingJobs();
    }, 30000); // 30 seconds
    
    return () => {
      console.log('🛑 Clearing periodic job refresh');
      clearInterval(interval);
    };
  }, [shouldShowUpcomingJobs, refreshUpcomingJobs]);

  // ✅ Recalculate distances when location updates (NO API CALL - just re-sort)
  useEffect(() => {
    if (upcomingJobs.length > 0 && location) {
      const sortedJobs = calculateJobDistances(upcomingJobs);
      setUpcomingJobs(sortedJobs);
    }
  }, [location]); // ✅ FIXED: Only location, removed calculateJobDistances from deps

  // Real-time socket listener for new nearby jobs
  useEffect(() => {
    const socket = getSocket();
    
    if (!socket || !shouldShowUpcomingJobs) {
      return;
    }

    const handleNewNearbyJob = (jobPayload: any) => {
      console.log('📡 [REAL-TIME] New nearby job received:', jobPayload);
      
      try {
        // ✅ FIX: Use locationRef.current to get latest location without causing re-renders
        const currentLocation = locationRef.current;
        
        // Calculate distance if driver location is available
        let distanceToPickup = jobPayload.distanceToPickup;
        
        if (
          currentLocation?.latitude &&
          currentLocation?.longitude &&
          jobPayload.pickup?.latitude &&
          jobPayload.pickup?.longitude
        ) {
          distanceToPickup = calculateDistance(
            currentLocation.latitude,
            currentLocation.longitude,
            jobPayload.pickup.latitude,
            jobPayload.pickup.longitude
          );
        }

        // Convert payload to UpcomingJobSummary format
        const newJob: UpcomingJobSummary = {
          id: jobPayload.id || jobPayload.jobId,
          jobId: jobPayload.jobId || jobPayload.id,
          status: jobPayload.status || 'UNASSIGNED',
          pickup: {
            address: jobPayload.pickup?.address || null,
            latitude: jobPayload.pickup?.latitude || null,
            longitude: jobPayload.pickup?.longitude || null,
          },
          dropoff: {
            address: jobPayload.dropoff?.address || null,
            latitude: jobPayload.dropoff?.latitude || null,
            longitude: jobPayload.dropoff?.longitude || null,
          },
          scheduledAt: jobPayload.scheduledAt || null,
          estimatedFare: jobPayload.estimatedFare || null,
          estimatedDistance: jobPayload.estimatedDistance || distanceToPickup || null,
          estimatedDuration: jobPayload.estimatedDuration || null,
          isLate: jobPayload.isLate || false,
          minutesToPickup: jobPayload.minutesToPickup || 0,
          customer: jobPayload.customer || null,
          zone: jobPayload.zone || null,
          distanceToPickup, // Add calculated distance
        };

        // Add job to the list if it doesn't already exist
        setUpcomingJobs((prevJobs) => {
          const exists = prevJobs.some(job => job.id === newJob.id);
          if (exists) {
            console.log('📡 [REAL-TIME] Job already exists, skipping');
            return prevJobs;
          }

          console.log('📡 [REAL-TIME] Adding new job to list');
          
          // Add job and sort by distance
          const updatedJobs = [...prevJobs, newJob];
          
          return updatedJobs.sort((a, b) => {
            const distA = a.distanceToPickup || a.estimatedDistance || 999;
            const distB = b.distanceToPickup || b.estimatedDistance || 999;
            return distA - distB;
          });
        });

        // Show toast notification
        Toast.show({
          type: 'info',
          text1: 'New Job Available!',
          text2: `${formatDistance(distanceToPickup || 0)} away - ${jobPayload.pickup?.address || 'Nearby'}`,
          position: 'top',
          visibilityTime: 4000,
        });
      } catch (error) {
        console.error('📡 [REAL-TIME] Error processing new job:', error);
      }
    };

    socket.on('job:available:nearby', handleNewNearbyJob);
    // ✅ Reduced logging noise
    // console.log('📡 [REAL-TIME] Socket listener registered for nearby jobs');

    return () => {
      socket.off('job:available:nearby', handleNewNearbyJob);
      // console.log('📡 [REAL-TIME] Socket listener unregistered');
    };
  }, [shouldShowUpcomingJobs]); // ✅ FIX: Removed location - using locationRef instead

  const hasNavigatedRef = useRef<string | null>(null);
  
  // ✅ FIX: Use ref to store location to avoid re-registering socket listener
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  // ✅ CRITICAL: Auto-navigate to active job screen on app restart
  useEffect(() => {
    if (!currentJob) {
      hasNavigatedRef.current = null;
      return;
    }

    const jobKey = `${currentJob.id}_${jobStatus}`;
    
    console.log('🔍 HomeScreen Navigation Check:', {
      jobId: currentJob.id,
      jobStatus,
      jobKey,
      hasNavigatedRef: hasNavigatedRef.current,
      shouldNavigate: hasNavigatedRef.current !== jobKey
    });
    
    // ✅ FIX: Reset navigation ref for PENDING_PAYMENT and STARTED to ensure navigation happens on app reopen
    // This prevents the app from getting stuck on Home screen with an active job
    if (jobStatus === "PENDING_PAYMENT" || jobStatus === "STARTED" || jobStatus === "ACTIVE") {
      console.log('🔄 Resetting navigation ref for critical status:', jobStatus);
      hasNavigatedRef.current = null;
    }
    
    // Prevent navigating to the same job/status combination repeatedly
    if (hasNavigatedRef.current === jobKey) {
      console.log('⏭️ Already navigated to this job, skipping');
      return;
    }

    // ✅ FIX: Safety check - ensure navigator is ready before navigating
    try {
      console.log('🚀 Attempting navigation for job status:', jobStatus);
      
      if (jobStatus === "INCOMING") {
        hasNavigatedRef.current = jobKey;
        console.log('➡️ Navigating to JobOffer');
        navigation.navigate("JobOffer", { job: currentJob as RideSummary });
      } else if (
        [
          "ASSIGNED",
          "ACCEPTED",
          "ON_THE_WAY",
          "ARRIVED",
        ].includes(jobStatus)
      ) {
        // ✅ FIX: For accepted/on_the_way/arrived → Show status screen (not full tracking)
        hasNavigatedRef.current = jobKey;
        console.log('➡️ Navigating to EnhancedJobTracking');
        navigation.navigate("EnhancedJobTracking");
      } else if (
        [
          "STARTED", // ✅ ONLY show full tracking when job is STARTED
          "ACTIVE",
          "REACHED",
        ].includes(jobStatus)
      ) {
        // ✅ FIX: For started/active/reached → Show ActiveRide with meter
        hasNavigatedRef.current = jobKey;
        console.log('➡️ Navigating to ActiveRide');
        navigation.navigate("ActiveRide");
      } else if (jobStatus === "PAUSED") {
        hasNavigatedRef.current = jobKey;
        console.log('➡️ Navigating to JobPaused');
        navigation.navigate("JobPaused");
      } else if (jobStatus === "PENDING_PAYMENT") {
        hasNavigatedRef.current = jobKey;
        console.log('➡️ Navigating to PaymentCollection');
        navigation.navigate("PaymentCollection", {
          jobId: currentJob.id,
          amount: Number(currentJob.earningsSoFar) || 0,
          customerId: currentJob.customer?.id || null,
        });
      } else {
        console.log('⚠️ Unknown job status, no navigation:', jobStatus);
      }
    } catch (navError) {
      // Navigation not ready yet - will retry on next render
      console.error('❌ Navigation failed, will retry:', navError);
      hasNavigatedRef.current = null; // Reset so it will retry
    }
  }, [currentJob, jobStatus, navigation]);

  // ✅ CRITICAL FIX: Fallback check when screen gains focus (for app restart scenarios)
  useFocusEffect(
    useCallback(() => {
      // Only run this check after a short delay to let state settle
      const timer = setTimeout(() => {
        if (currentJob && jobStatus) {
          console.log('🔍 Focus Effect - Checking for active job:', {
            jobId: currentJob.id,
            jobStatus,
            hasNavigated: hasNavigatedRef.current
          });
          
          // If there's an active job and we haven't navigated yet, trigger the check
          const jobKey = `${currentJob.id}_${jobStatus}`;
          if (hasNavigatedRef.current !== jobKey) {
            console.log('⚡ Focus Effect - Triggering navigation check by clearing ref');
            // Force the useEffect above to run by clearing the ref
            hasNavigatedRef.current = null;
          }
        }
      }, 300);

      return () => clearTimeout(timer);
    }, [currentJob, jobStatus])
  );

  const handleSelectVehicle = useCallback(
    async (vehicle: DriverVehicle) => {
      await selectVehicle(vehicle);
    },
    [selectVehicle]
  );

  // ✅ NEW: Create a real walk-in job (street hail)
  const [creatingWalkInJob, setCreatingWalkInJob] = useState(false);

  const handleStartWalkInJob = useCallback(async () => {
    if (!driver?.id || !activeShift) {
      Toast.show({
        type: 'error',
        text1: 'Cannot Start Job',
        text2: 'Please ensure you have an active shift',
      });
      return;
    }

    if (derivedStatus === 'BUSY') {
      Toast.show({
        type: 'error',
        text1: 'Already Busy',
        text2: 'You already have an active job',
      });
      return;
    }

    setCreatingWalkInJob(true);
    console.log('🚶 Starting walk-in job creation...');

    try {
      // Call the walk-in job creation API
      const response = await httpClient.post('/mobile/driver/jobs/walk-in/create');
      
      console.log('✅ Walk-in job created:', response);

      // ✅ FIX: httpClient wraps response in 'data' property
      const { success, job: walkInJob } = response.data || response;

      if (success && walkInJob) {

        // Build job data for JobContext

        // ✅ FIX: Use startWalkInJob to bypass accept/reject screen
        // This sets job to STARTED immediately and starts the meter
        startWalkInJob({
          id: walkInJob.id,
          status: 'STARTED',
          pickupAddress: walkInJob.pickupLocation?.address || 'Current Location',
          pickupLatitude: walkInJob.pickupLocation?.latitude,
          pickupLongitude: walkInJob.pickupLocation?.longitude,
          dropoffAddress: walkInJob.dropoffLocation?.address || 'Destination - To be set',
          dropoffLatitude: walkInJob.dropoffLocation?.latitude,
          dropoffLongitude: walkInJob.dropoffLocation?.longitude,
          estimatedFare: walkInJob.estimatedFare || 0,
          createdAt: walkInJob.createdAt,
          customer: null,
          passenger: {
            id: null,
            name: "",
            phone: ""
          }
        });
        
        Toast.show({
          type: 'success',
          text1: 'Job Started',
          text2: 'Meter is now running',
        });

        // ✅ FIX: Navigate to ActiveRide (JobProgress archived)
        setTimeout(() => {
          try {
            navigation.navigate('ActiveRide' as never);
          } catch (navError) {
            console.warn('⚠️ Walk-in job navigation failed, will retry:', navError);
          }
        }, 500);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (error: any) {
      console.error('❌ Failed to create walk-in job:', error);
      console.error('📋 Error details:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      Toast.show({
        type: 'error',
        text1: 'Job Creation Failed',
        text2: error.response?.data?.error || error.message || 'Please try again',
      });
    } finally {
      setCreatingWalkInJob(false);
    }
  }, [driver, activeShift, derivedStatus, startWalkInJob, navigation]); // ✅ FIX: Use startWalkInJob, not setIncomingJob
  const handleClaimUpcomingJob = useCallback(
    async (jobId: string) => {
      console.log('🎯 [CLAIM JOB] Step 1: Starting claim process', { jobId });
      setClaimingJobId(jobId);
      try {
        console.log('🎯 [CLAIM JOB] Step 2: Calling claimUpcomingJob API');
        const result = await claimUpcomingJob(jobId);
        console.log('🎯 [CLAIM JOB] Step 3: API response received', { 
          hasResult: !!result, 
          hasJob: !!(result?.job),
          resultKeys: result ? Object.keys(result) : []
        });
        
        const payload = result?.job ?? result;
        console.log('🎯 [CLAIM JOB] Step 4: Extracted payload', {
          hasPayload: !!payload,
          payloadKeys: payload ? Object.keys(payload) : []
        });

        if (payload) {
          const pickup = payload.pickup || {};
          const dropoff = payload.dropoff || {};
          const internalId =
            payload.internalJobId || payload.legacyJobId || payload.id || payload.jobId;

          console.log('🎯 [CLAIM JOB] Step 5: Building incoming job object', {
            internalId,
            hasCustomer: !!payload.customer,
            hasPickup: !!payload.pickup,
            hasDropoff: !!payload.dropoff
          });

          setIncomingJob({
            id: String(internalId || `job_${Date.now()}`),
            internalJobId: payload.internalJobId || null,
            legacyJobId: payload.legacyJobId || null,
            publicJobId: payload.jobId || null,
            jobId: payload.jobId || internalId,
            status: "INCOMING",
            createdAt: payload.createdAt || new Date().toISOString(),
            pickupAddress: payload.pickupAddress || pickup.address || "Unknown pickup",
            pickupLatitude: payload.pickupLatitude ?? pickup.latitude ?? null,
            pickupLongitude: payload.pickupLongitude ?? pickup.longitude ?? null,
            dropoffAddress: payload.dropoffAddress || dropoff.address || "Unknown dropoff",
            dropoffLatitude: payload.dropoffLatitude ?? dropoff.latitude ?? null,
            dropoffLongitude: payload.dropoffLongitude ?? dropoff.longitude ?? null,
            estimatedFare: payload.estimatedPrice ?? payload.estimatedFare ?? payload.fare ?? null,
            actualFare: payload.fare ?? null,
            distance: payload.distance ?? payload.estimatedDistance ?? null,
            estimatedDuration: payload.estimatedDuration ?? null,
            vehicleType: payload.vehicleType ?? null,
            passenger: payload.customer
              ? {
                id: payload.customer.id,
                name: [payload.customer.firstName, payload.customer.lastName]
                  .filter(Boolean)
                  .join(" ")
                  .trim() ||
                  payload.customer.firstName ||
                  "Passenger",
                phone: payload.customer.phone || "",
              }
              : currentJob?.passenger || {
                id: null,
                name: "Unknown",
                phone: "",
              },
            expiresAt: payload.expiresAt || null,
            countdownMs: payload.expiresAt
              ? Math.max(0, new Date(payload.expiresAt).getTime() - Date.now())
              : undefined,
            assignmentId: payload.assignmentId || null,
            offerId: payload.offerId || null,
            tariffName: payload.tariff?.name || currentJob?.tariffName || null,
            customer: undefined
          });

          console.log('✅ [CLAIM JOB] Step 6: Incoming job set successfully');
        }

        Toast.show({
          type: "success",
          text1: "Job claimed",
          text2: "Opening job details...",
        });
      } catch (error: any) {
        console.error("❌ [CLAIM JOB] ERROR CAUGHT:", {
          message: error?.message,
          response: error?.response,
          responseData: error?.response?.data,
          responseStatus: error?.response?.status,
          config: error?.config ? {
            url: error.config.url,
            method: error.config.method,
            headers: error.config.headers
          } : null,
          stack: error?.stack
        });
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Unable to claim job.";
        Toast.show({
          type: "error",
          text1: "Job claim failed",
          text2: message,
        });
      } finally {
        console.log('🎯 [CLAIM JOB] Step 7: Cleanup - refreshing jobs');
        setClaimingJobId(null);
        refreshUpcomingJobs();
      }
    },
    [currentJob?.passenger, currentJob?.tariffName, refreshUpcomingJobs, setIncomingJob]
  );

  const handleStatusPress = useCallback(() => {
    if (isBusy) {
      Toast.show({
        type: "info",
        text1: "Busy",
        text2: "Complete your current job to change status.",
      });
      return;
    }
    setStatusModalVisible(true);
  }, [isBusy]);
  const handleSetAvailable = useCallback(() => {
    setStatusModalVisible(false);
    setManualStatus("AVAILABLE");
    setAwayReminderVisible(false);
    clearAwayReminder();
    Toast.show({
      type: "success",
      text1: "Available",
      text2: "You can now receive new jobs.",
    });
  }, [clearAwayReminder]);
  const handleGoAway = useCallback(() => {
    if (isBusy) {
      Toast.show({
        type: "info",
        text1: "Busy",
        text2: "Status will unlock once the job ends.",
      });
      return;
    }
    setStatusModalVisible(false);
    setManualStatus("AWAY");
    setAwayReminderVisible(false);
    scheduleAwayReminder();
    Toast.show({
      type: "info",
      text1: "Away",
      text2: "We'll remind you to come back online soon.",
    });
  }, [isBusy, scheduleAwayReminder]);
  const handleReminderConfirm = useCallback(() => {
    setManualStatus("AVAILABLE");
    setAwayReminderVisible(false);
    clearAwayReminder();
    Toast.show({
      type: "success",
      text1: "Back online",
      text2: "You will start receiving new jobs.",
    });
  }, [clearAwayReminder]);
  const handleReminderSnooze = useCallback(() => {
    setAwayReminderVisible(false);
    scheduleAwayReminder();
  }, [scheduleAwayReminder]);

  const handleProceed = useCallback(async () => {
    if (!selectedVehicle) {
      Toast.show({
        type: "info",
        text1: "Vehicle required",
        text2: "Please choose a vehicle before starting your shift.",
      });
      return;
    }
    const permissionsOk = await startTracking();
    if (!permissionsOk && !tracking) {
      Toast.show({
        type: "error",
        text1: "Permissions required",
        text2: "Please grant all requested permissions to proceed.",
      });
      return;
    }
    navigation.navigate("TariffSelection", { vehicleId: selectedVehicle.id });
  }, [navigation, selectedVehicle, startTracking, tracking]);

  const handleChangeTariff = useCallback(() => {
    if (!selectedVehicle) {
      Toast.show({
        type: "info",
        text1: "Vehicle required",
        text2: "Select a vehicle before changing the tariff.",
      });
      return;
    }

    navigation.navigate("TariffSelection", {
      vehicleId: selectedVehicle.id,
      mode: activeShift ? "change" : "start",
    });
  }, [activeShift, navigation, selectedVehicle]);

  const handleLogout = useCallback(async () => {
    await logout();
    await stopTracking();
    await resetShiftState();
  }, [logout, resetShiftState, stopTracking]);

  const handleEndShift = useCallback(async () => {
    Toast.show({
      type: "info",
      text1: "Ending shift",
      text2: "Shift will end shortly.",
    });
    
    // 🔥 FIX: Pass current location to endShift to avoid using stale/default location
    const currentLocation = location ? {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      heading: location.heading || 0,
      speed: location.speed || 0,
    } : null;
    
    console.log('🛑 Ending shift with current location:', currentLocation ? 'using GPS location' : 'will use fallback');
    
    endShift(currentLocation)
      .then(stopTracking)
      // ✅ REMOVED: refreshCurrentShift() - endShift already clears the shift state
      // No need to fetch again after ending, this was causing 400 errors
      .catch((error) => {
        console.error("End shift error", error);
        
        // Show more detailed error message
        const errorMessage = error?.response?.data?.message || error?.message || "Unable to end shift.";
        console.error("End shift detailed error:", {
          status: error?.response?.status,
          message: errorMessage,
          data: error?.response?.data,
        });
        
        Toast.show({
          type: "error",
          text1: "Shift Error",
          text2: errorMessage,
        });
      });
  }, [endShift, stopTracking, location]);

  // ✅ NEW: Prevent app closure when shift is active
  usePreventAppClose({
    activeShift,
    onEndShift: handleEndShift,
    onLogout: handleLogout,
  });

  // ✅ CRITICAL FIX: No early return - use conditional render to prevent hooks violation
  // The old `if (activeShift) return (...)` caused "Rendered fewer hooks" errors
  // 🔥 FIX FOR VEHICLE/TARIFF LOOP: Dashboard should ONLY show if:
  //    1. Active shift exists
  //    2. Vehicle AND tariff are both selected
  //    3. No active job that requires a different screen
  // If shift exists but vehicle/tariff missing → show vehicle selection (not dashboard)
  const shouldShowDashboard = Boolean(
    activeShift && 
    selectedVehicle && 
    selectedTariff && 
    !currentJob
  );
  
  // ✅ FIX: Only log when rendering decision CHANGES (prevent spam)
  const lastDecisionRef = useRef<{
    shouldShowDashboard: boolean;
    hasCurrentJob: boolean;
    activeShiftId?: string;
  } | null>(null);
  
  const currentDecision = {
    shouldShowDashboard,
    hasCurrentJob: !!currentJob,
    activeShiftId: activeShift?.id,
  };
  
  if (
    !lastDecisionRef.current ||
    lastDecisionRef.current.shouldShowDashboard !== currentDecision.shouldShowDashboard ||
    lastDecisionRef.current.hasCurrentJob !== currentDecision.hasCurrentJob ||
    lastDecisionRef.current.activeShiftId !== currentDecision.activeShiftId
  ) {
    console.log('🔍 HomeScreen rendering decision CHANGED:', {
      shouldShowDashboard,
      hasActiveShift: !!activeShift,
      hasSelectedVehicle: !!selectedVehicle,
      hasSelectedTariff: !!selectedTariff,
      hasCurrentJob: !!currentJob,
      activeShiftId: activeShift?.id,
    });
    lastDecisionRef.current = currentDecision;
  }
  
  return shouldShowDashboard ? (
      <>
        <SafeAreaView style={styles.safeArea}>
          <DashboardView
            driverName={driver?.firstName ?? undefined}
            companyName={driver?.company?.name ?? undefined}
            shift={activeShift!}
            tariffName={selectedTariff?.name}
            tariff={
              selectedTariff
                ? {
                    baseFare: selectedTariff.baseFare,
                    perKmRate: selectedTariff.perKmRate,
                    perMinuteRate: selectedTariff.perMinuteRate,
                    waitingTimeRate: selectedTariff.waitingTimeRate,
                  }
                : null
            }
            onEndShift={handleEndShift}
            rideHistory={rideHistory}
            rideHistoryLoading={rideHistoryLoading}
            onRefreshShift={refreshCurrentShift}
            onRefreshHistory={() => refreshRideHistory(3)}
            jobStatusMessage={jobStatusMessage}
            onStartWalkInJob={handleStartWalkInJob}
            creatingWalkInJob={creatingWalkInJob}
            location={location}
            vehicle={selectedVehicle ?? null}
            onChangeTariff={handleChangeTariff}
            onPressStatus={handleStatusPress}
            driverStatus={derivedStatus}
            zoneName={currentZone?.name}
            zoneLoading={zoneLoading}
            zoneError={zoneError}
            onRetryZone={retryZoneDetection}
            mapProvider={mapProvider}
            mapProviderLoading={mapProviderLoading}
            zoneCoordinates={currentZone?.coordinates ?? null}
            locationUpdateInterval={locationUpdateInterval}
            shouldShowUpcomingJobs={shouldShowUpcomingJobs}
            upcomingJobs={upcomingJobs}
            upcomingJobsLoading={upcomingJobsLoading}
            upcomingJobsError={upcomingJobsError}
            onClaimUpcomingJob={handleClaimUpcomingJob}
            claimingJobId={claimingJobId}
            hasPendingAction={Boolean(pendingAction)}
            onStatsLoaded={handleStatsLoaded} // ✅ NEW: Pass stats callback
          />
        </SafeAreaView>
        <Modal
          transparent
          visible={statusModalVisible}
          animationType="fade"
          onRequestClose={() => setStatusModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Driver status</Text>
              <Text style={styles.modalSubtitle}>
                Update your availability for dispatch.
              </Text>
              <TouchableOpacity
                style={[
                  styles.statusOption,
                  manualStatus === "AVAILABLE" && styles.statusOptionActive,
                ]}
                onPress={handleSetAvailable}
                disabled={manualStatus === "AVAILABLE"}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.statusOptionDot,
                    { backgroundColor: "#4ade80" },
                  ]}
                />
                <View style={styles.statusOptionCopy}>
                  <Text style={styles.statusOptionTitle}>Available</Text>
                  <Text style={styles.statusOptionSubtitle}>
                    Receive new jobs immediately
                  </Text>
                </View>
                {manualStatus === "AVAILABLE" ? (
                  <MCIcon
                    name="check-circle"
                    size={20}
                    color={Colors.success}
                  />
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusOption,
                  manualStatus === "AWAY" &&
                    !isBusy &&
                    styles.statusOptionActive,
                  isBusy && styles.statusOptionDisabled,
                ]}
                onPress={handleGoAway}
                disabled={isBusy}
                activeOpacity={0.85}
              >
                <View
                  style={[
                    styles.statusOptionDot,
                    { backgroundColor: "#f97316" },
                  ]}
                />
                <View style={styles.statusOptionCopy}>
                  <Text style={styles.statusOptionTitle}>Away</Text>
                  <Text style={styles.statusOptionSubtitle}>
                    Pause new jobs while you're busy
                  </Text>
                  {isBusy ? (
                    <Text style={styles.statusOptionHint}>
                      Finish the active job to switch
                    </Text>
                  ) : null}
                </View>
                {manualStatus === "AWAY" && !isBusy ? (
                  <MCIcon name="check-circle" size={20} color={"#f97316"} />
                ) : null}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setStatusModalVisible(false)}
                style={styles.modalDismiss}
                activeOpacity={0.85}
              >
                <Text style={styles.modalDismissText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <Modal
          transparent
          visible={awayReminderVisible}
          animationType="fade"
          onRequestClose={handleReminderSnooze}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.reminderCard}>
              <MCIcon name="alarm" size={28} color="#f5b400" />
              <Text style={styles.modalTitle}>Still away?</Text>
              <Text style={styles.modalSubtitle}>
                Let us know if you're ready to go back online.
              </Text>
              <View style={styles.reminderActions}>
                <TouchableOpacity
                  style={styles.reminderSecondary}
                  onPress={handleReminderSnooze}
                  activeOpacity={0.85}
                >
                  <Text style={styles.reminderSecondaryText}>Still away</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reminderPrimary}
                  onPress={handleReminderConfirm}
                  activeOpacity={0.9}
                >
                  <Text style={styles.reminderPrimaryText}>Yes, I'm ready</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Job Acceptance Modal - DISABLED: Using full-screen JobOfferScreen instead */}
        {/* <JobAcceptanceModal
          visible={jobStatus === "INCOMING" && currentJob !== null}
          job={currentJob}
          onAccept={() => {
            acceptJob();
            navigation.navigate("JobProgress");
          }}
          onReject={rejectJob}
          isAccepting={pendingAction?.type === "ACCEPT"}
          isRejecting={pendingAction?.type === "REJECT"}
        /> */}
      </>
    ) : (
    // ✅ Show vehicle selection screen when no active shift
    <VehicleSelectionView
      driverName={driver?.firstName ?? undefined}
      companyName={driver?.company?.name ?? undefined}
      vehicles={vehicles}
      vehiclesLoading={vehiclesLoading || tariffsLoading}
      vehiclesError={vehiclesError}
      selectedVehicle={selectedVehicle}
      onLogout={handleLogout}
      onRefresh={refreshVehicles}
      onSelectVehicle={handleSelectVehicle}
      onClearSelection={clearSelection}
      onProceed={handleProceed}
      currentZoneName={currentZone?.name}
      zoneLoading={zoneLoading}
      zoneError={zoneError}
      onRetryZone={retryZoneDetection}
    />
  ); // ✅ Close ternary operator
};


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.base,
    paddingTop: 40, // Add top padding to prevent overlap with status bar
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  dashboardContainer: {
    flex: 1,
    backgroundColor: Colors.background.base,
  },
  stickyHeader: {
    backgroundColor: Colors.background.elevated,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(99, 102, 241, 0.1)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 1000,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 80,
  },
  driverDetails: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
    minWidth: 0, // Allow text to wrap
  },
  dashboardScroll: {
    flex: 1,
    backgroundColor: Colors.background.base,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 0,
  },
  dashboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  driverInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    minWidth: 0, // Allow content to shrink
  },
  avatarCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: "rgba(245,180,0,0.15)",
    borderWidth: 2,
    borderColor: "rgba(245,180,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#f5b400",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
    flexShrink: 0, // Don't allow avatar to shrink
  },
  driverName: {
    color: Colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
    flexShrink: 1, // Allow text to shrink if needed
  },
  companyLabel: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontSize: 12,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4ade80",
  },
  statusText: {
    color: "#4ade80",
    fontWeight: "600",
  },
  statusHint: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontSize: 11,
    marginTop: 2,
  },
  zonePill: {
    marginTop: 6,
    backgroundColor: "rgba(99, 102, 241, 0.15)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.2)",
  },
  zonePillMuted: {
    marginTop: 6,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  zonePillText: {
    color: "#cbd5f5",
    fontSize: 11,
    maxWidth: 120,
    flexShrink: 1,
  },
  zoneRetryPill: {
    marginTop: 6,
    backgroundColor: "rgba(255, 77, 97, 0.15)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  zoneRetryPillText: {
    color: Colors.danger,
    fontSize: 11,
    flexShrink: 1,
    maxWidth: 160,
  },
  zoneRetryPillCta: {
    color: Colors.danger,
    fontWeight: "600",
    fontSize: 11,
  },
  zoneErrorBanner: {
    backgroundColor: "rgba(255, 77, 97, 0.12)",
    borderColor: "rgba(255, 77, 97, 0.4)",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  zoneErrorContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  zoneErrorText: {
    color: Colors.danger,
    fontSize: 12,
    flex: 1,
  },
  zoneRetryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "rgba(255, 77, 97, 0.14)",
  },
  zoneRetryText: {
    color: Colors.danger,
    fontWeight: "600",
    fontSize: 12,
  },
  zoneRetryTextDisabled: {
    color: "rgba(255, 77, 97, 0.6)",
  },
  endShiftButton: {
    backgroundColor: "#ff5c33",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    shadowColor: "#ff5c33",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
    flexShrink: 0, // Don't allow button to shrink
    minWidth: 60, // Ensure minimum button width
  },
  endShiftText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  tariffCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    marginBottom: 16,
  },
  tariffHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tariffTitle: {
    color: "#f5b400",
    fontWeight: "700",
    fontSize: 16,
  },
  tariffRatesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  tariffRate: {
    color: "#dfe3f3",
    fontSize: 13,
  },
  mapWrapper: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    marginBottom: 20,
    overflow: "hidden",
  },
  mapHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  vehicleBadge: {
    backgroundColor: "rgba(245,180,0,0.18)",
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  vehicleBadgeText: {
    color: "#0f172a",
    fontWeight: "600",
    fontSize: 12,
    maxWidth: 180,
  },
  mapContainer: {
    height: 400, // Increased from 250 to 400 for better visibility
    backgroundColor: "#f0f0f0", // Add background color to debug
  },
  map: {
    flex: 1,
  },
  mapOverlay: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    gap: 8,
  },
  mapLoading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.25)",
    gap: 8,
  },
  mapLoadingText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "600",
  },
  mapError: {
    position: "absolute",
    top: 16,
    right: 16,
    left: 16,
    backgroundColor: "rgba(255,120,73,0.18)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mapErrorText: {
    color: "#fb923c",
    fontSize: 12,
    flex: 1,
    fontWeight: "600",
  },
  mapErrorContent: {
    flex: 1,
  },
  mapErrorRetry: {
    color: "#fb923c",
    fontSize: 10,
    marginTop: 2,
    fontWeight: "500",
    opacity: 0.8,
  },
  mapFallback: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15,23,42,0.95)",
    padding: 20,
    gap: 12,
  },
  mapFallbackTitle: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  mapFallbackText: {
    color: "#94a3b8",
    fontSize: 12,
    textAlign: "center",
    maxWidth: 200,
  },
  mapFallbackButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
  },
  mapFallbackButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  mapFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "nowrap",
    backgroundColor: "rgba(15,23,42,0.78)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  mapFooterSegment: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mapFooterText: {
    color: "#dfe3f3",
    fontSize: 12,
    fontWeight: "600",
  },
  mapFooterSecondary: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "600",
  },
  mapControls: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 42,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.82)",
  },
  mapControlButton: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  mapControlDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(148,163,184,0.35)",
    width: "60%",
    alignSelf: "center",
  },
  mapRecenterButton: {
    position: "absolute",
    right: 16,
    bottom: 76,
    backgroundColor: "rgba(15,23,42,0.88)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  mapRecenterText: {
    color: "#dbeafe",
    fontSize: 12,
    fontWeight: "700",
  },
  mapStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  mapStatusInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
    paddingHorizontal: 4,
  },
  mapStatusBadge: {
    backgroundColor: "rgba(15,23,42,0.82)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mapStatusText: {
    color: "#dbeafe",
    fontSize: 11,
    fontWeight: "600",
  },
  mapStatusTextCompact: {
    color: "#dbeafe",
    fontSize: 10,
    fontWeight: "600",
  },
  mapMotionBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: "auto",
  },
  mapMotionBadgeCompact: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  mapMotionText: {
    color: "#0f172a",
    fontSize: 11,
    fontWeight: "700",
  },
  mapMotionTextCompact: {
    color: "#0f172a",
    fontSize: 10,
    fontWeight: "700",
  },
  vehicleMarkerWrapper: {
    alignItems: "center",
    justifyContent: "center",
    width: 50,
    height: 50,
  },
  vehicleMarkerGlow: {
    position: "absolute",
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(245,180,0,0.4)", // Changed to yellow glow for better visibility
    shadowColor: "#f5b400",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 10,
  },
  vehicleMarker: {
    // ✅ UPDATED: Match RideMap driver marker design (blue circular with navigation icon)
    backgroundColor: "#3b82f6", // Blue color like active ride screen
    borderRadius: 20,
    width: 40,
    height: 40,
    borderWidth: 3,
    borderColor: "#fff", // White border for contrast
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3b82f6",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: Colors.background.elevated,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    gap: 16,
  },
  modalTitle: {
    color: Colors.text.inverse,
    fontSize: 18,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontSize: 13,
  },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    borderRadius: 16,
    padding: 16,
    backgroundColor: Colors.background.base,
  },
  statusOptionActive: {
    borderColor: Colors.accent.highlight,
    backgroundColor: "rgba(245,180,0,0.08)",
  },
  statusOptionDisabled: {
    opacity: 0.5,
  },
  statusOptionDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusOptionCopy: {
    flex: 1,
    gap: 2,
  },
  statusOptionTitle: {
    color: Colors.text.inverse,
    fontWeight: "600",
  },
  statusOptionSubtitle: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontSize: 12,
  },
  statusOptionHint: {
    color: "#f97316",
    fontSize: 11,
    marginTop: 4,
  },
  modalDismiss: {
    alignSelf: "flex-end",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  modalDismissText: {
    color: Colors.accent.highlight,
    fontWeight: "600",
  },
  reminderCard: {
    width: "100%",
    backgroundColor: Colors.background.elevated,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  reminderActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 12,
  },
  reminderPrimary: {
    flex: 1,
    backgroundColor: Colors.accent.highlight,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
  },
  reminderPrimaryText: {
    color: Colors.text.inverse,
    fontWeight: "700",
  },
  reminderSecondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
  },
  reminderSecondaryText: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontWeight: "600",
  },
  overviewSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: Colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 12,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: Colors.background.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    padding: 16,
    alignItems: "flex-start",
    gap: 6,
  },
  metricValue: {
    fontWeight: "700",
    fontSize: 18,
  },
  metricLabel: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    fontSize: 13,
  },
  jobStatusCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,120,73,0.45)",
    padding: 16,
    backgroundColor: "rgba(255,120,73,0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  jobStatusText: {
    color: "#ff7849",
    flex: 1,
  },
  historySection: {
    gap: 12,
    marginBottom: 40,
  },
  loaderInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loaderText: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
  },
  emptyState: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
  },
  rideCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    padding: 16,
    gap: 10,
  },
  rideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rideText: {
    color: Colors.text.inverse,
    fontWeight: "600",
    flex: 1,
  },
  rideSubText: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    flex: 1,
  },
  rideBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(50,210,150,0.12)",
  },
  rideBadgeText: {
    color: "#32d296",
    fontWeight: "600",
    fontSize: 12,
  },
  rideFooter: {
    justifyContent: "space-between",
  },
  rideFooterText: {
    color: "#dfe3f3",
    fontWeight: "600",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  driverGreeting: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    marginTop: 4,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.accent.logout,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "rgba(255, 92, 51, 0.08)",
    gap: 8,
  },
  logoutText: {
    color: Colors.accent.logout,
    fontWeight: "600",
  },
  primaryLinkButton: {
    marginTop: 24,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  primaryLinkText: {
    color: Colors.accent.highlight,
    fontWeight: "600",
    fontSize: 15,
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorBanner: {
    backgroundColor: "rgba(255, 77, 97, 0.12)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,77,97,0.25)",
    marginBottom: 12,
  },
  errorText: {
    color: "#ff9aa4",
    marginBottom: 8,
  },
  retryText: {
    color: Colors.accent.highlight,
    fontWeight: "600",
  },
  vehicleZoneBanner: {
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.accent.highlight,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  vehicleZoneBannerMuted: {
    marginTop: 12,
    marginBottom: 12,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.4)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  vehicleZoneText: {
    color: "#e0e7ff", // ✅ Brighter - was #cbd5f5
    flex: 1,
    fontSize: 13,
  },
  vehicleCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  vehicleCardSelected: {
    borderColor: Colors.accent.highlight,
    shadowColor: Colors.accent.highlight,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  vehicleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleDetails: {
    flex: 1,
  },
  vehicleTitle: {
    color: "#d9deed",
    fontSize: 16,
    fontWeight: "600",
  },
  vehicleTitleSelected: {
    color: Colors.accent.highlight,
  },
  vehicleSubtitle: {
    color: "#c5cde0", // ✅ Brighter - was #8d95ad
    marginTop: 4,
    fontSize: 13,
  },
  itemSeparator: {
    height: 12,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyText: {
    textAlign: "center",
    color: "#717a92",
  },
  goOnlineButton: {
    marginTop: 24,
    backgroundColor: Colors.success,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  goOnlineButtonDisabled: {
    backgroundColor: "#2d3342",
  },
  goOnlineText: {
    color: Colors.text.inverse,
    fontSize: 16,
    fontWeight: "700",
  },
  goOnlineIcon: {
    marginRight: 8,
  },
  upcomingSection: {
    marginTop: 12,
  },
  upcomingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  upcomingScroll: {
    marginBottom: 12,
  },
  upcomingScrollContent: {
    paddingRight: 16,
  },
  upcomingCard: {
    width: 240,
    padding: 16,
    borderRadius: 18,
    backgroundColor: Colors.background.elevated,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  upcomingHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  upcomingTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text.primary,
    paddingRight: 8,
  },
  distanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5b400',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  distanceBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  upcomingSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#8891a7',
  },
  upcomingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  upcomingMeta: {
    fontSize: 12,
    color: '#cbd2e7',
  },
  upcomingButton: {
    marginTop: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: Colors.accent.highlight,
  },
  upcomingButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  upcomingEmpty: {
    color: '#8d95ad',
    fontSize: 13,
    marginBottom: 4,
  },
  upcomingError: {
    color: '#ff9aa4',
    fontSize: 13,
    marginBottom: 6,
  },
  walkInButton: {
    marginVertical: 16,
    backgroundColor: "#10b981", // Green for "start"
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  walkInButtonDisabled: {
    backgroundColor: "#9ca3af",
    elevation: 0,
  },
  walkInButtonText: {
    color: Colors.text.inverse,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  todayStatsContainer: {
    marginVertical: 16,
    backgroundColor: Colors.background.elevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  todayStatsTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.primary,
    marginBottom: 12,
  },
  todayStatsRow: {
    flexDirection: "row",
    gap: 12,
  },
  todayStatCard: {
    flex: 1,
    backgroundColor: Colors.background.elevated,
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  todayStatValue: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  todayStatLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: Colors.text.secondary,
    textAlign: "center",
  },
  // ✅ NEW: Single combined card styles
  todayStatsSingleCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  todayStatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  todayStatTextContainer: {
    flex: 1,
  },
  todayStatDivider: {
    height: 1,
    backgroundColor: Colors.accent.border,
    marginVertical: 12,
  },
});

export default HomeScreen;
