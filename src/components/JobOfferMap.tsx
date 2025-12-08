import React, { useMemo, useState } from "react";
import {
  ActionSheetIOS,
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
import MapViewDirections from "react-native-maps-directions";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../theme/colors";
import { GOOGLE_MAPS_API_KEY } from "../config/maps";

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

  const showMap = hasValidCoordinate(pickup) && hasValidCoordinate(driver);

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

  const openGoogleMaps = () => {
    if (!hasValidCoordinate(pickup)) {
      Alert.alert("Error", "Pickup location not available");
      return;
    }

    const url = Platform.select({
      ios: `comgooglemaps://?daddr=${pickup.latitude},${pickup.longitude}&directionsmode=driving`,
      android: `google.navigation:q=${pickup.latitude},${pickup.longitude}&mode=d`,
    });

    const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${pickup.latitude},${pickup.longitude}&travelmode=driving`;

    if (url) {
      Linking.canOpenURL(url)
        .then((supported) => {
          if (supported) {
            return Linking.openURL(url);
          } else {
            return Linking.openURL(fallbackUrl);
          }
        })
        .catch((err) => {
          console.error("Error opening Google Maps:", err);
          Linking.openURL(fallbackUrl);
        });
    }
  };

const openWaze = () => {
  if (!hasValidCoordinate(pickup)) {
    Alert.alert("Error", "Pickup location not available");
    return;
  }

    const url = `https://waze.com/ul?ll=${pickup.latitude},${pickup.longitude}&navigate=yes`;

    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          return Linking.openURL(url);
        } else {
          Alert.alert(
            "Waze Not Installed",
            "Please install the Waze app to use this feature.",
            [{ text: "OK" }]
          );
        }
      })
      .catch((err) => {
        console.error("Error opening Waze:", err);
        Alert.alert("Error", "Could not open Waze");
      });
  };

  const openAppleMaps = () => {
    if (!hasValidCoordinate(pickup)) {
      Alert.alert("Error", "Pickup location not available");
      return;
    }
    const url = `http://maps.apple.com/?daddr=${pickup.latitude},${pickup.longitude}&dirflg=d`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open Apple Maps"));
  };

  const handleNavigationSelection = () => {
    if (!hasValidCoordinate(pickup)) {
      Alert.alert("Error", "Pickup location not available");
      return;
    }

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Navigate with",
          options: ["Google Maps", "Waze", "Apple Maps", "Cancel"],
          cancelButtonIndex: 3,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) openGoogleMaps();
          if (buttonIndex === 1) openWaze();
          if (buttonIndex === 2) openAppleMaps();
        }
      );
    } else {
      Alert.alert("Choose Navigation App", undefined, [
        { text: "Google Maps", onPress: openGoogleMaps },
        { text: "Waze", onPress: openWaze },
        { text: "Cancel", style: "cancel" },
      ]);
    }
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
          >
            {/* Driver Marker */}
            <Marker 
              coordinate={{ latitude: driver.latitude!, longitude: driver.longitude! }} 
              title="Your Location"
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.driverMarker}>
                <MaterialCommunityIcons name="navigation-variant" size={20} color="#fff" />
              </View>
            </Marker>

            {/* Pickup Marker */}
            <Marker
              coordinate={{ latitude: pickup.latitude!, longitude: pickup.longitude! }}
              title="Pickup Location"
              pinColor="#22c55e"
            >
              <View style={styles.pickupMarker}>
                <MaterialCommunityIcons name="map-marker" size={28} color="#22c55e" />
              </View>
            </Marker>

            {/* Route Directions */}
            <MapViewDirections
              origin={{
                latitude: driver.latitude!,
                longitude: driver.longitude!,
              }}
              destination={{
                latitude: pickup.latitude!,
                longitude: pickup.longitude!,
              }}
              apikey={GOOGLE_MAPS_API_KEY}
              strokeWidth={4}
              strokeColor="#3b82f6"
              lineDashPattern={[0]}
              lineCap="round"
              lineJoin="round"
              optimizeWaypoints={true}
              onReady={(result) => {
                setRouteDistance(result.distance);
                setRouteDuration(result.duration);
                onRouteStats?.({
                  distanceKm: result.distance,
                  durationMin: result.duration,
                });
              }}
              onError={(errorMessage) => {
                console.warn("Directions Error:", errorMessage);
              }}
            />

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
