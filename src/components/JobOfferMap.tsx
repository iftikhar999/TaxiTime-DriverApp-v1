import React, { useMemo, useState } from "react";
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
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
  showNavigationButtons = false 
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

  return (
    <View style={[styles.container, { height }, style]}>
      {showMap ? (
        <>
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
              }}
              onError={(errorMessage) => {
                console.warn("Directions Error:", errorMessage);
              }}
            />
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
                style={[styles.navButton, styles.googleMapsButton]}
                onPress={openGoogleMaps}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="google-maps" size={18} color="#fff" />
                <Text style={styles.navButtonText}>Google Maps</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.navButton, styles.wazeButton]}
                onPress={openWaze}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="waze" size={18} color="#fff" />
                <Text style={styles.navButtonText}>Waze</Text>
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
    left: 12,
    right: 12,
    flexDirection: "row",
    gap: 10,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 4,
  },
  googleMapsButton: {
    backgroundColor: "#4285F4",
  },
  wazeButton: {
    backgroundColor: "#00D7FF",
  },
  navButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});

export default JobOfferMap;

