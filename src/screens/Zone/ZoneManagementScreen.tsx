import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ZoneTariffDisplay } from "../../components/zone/ZoneTariffDisplay";
import { useDriverLocation } from "../../hooks/useDriverLocation";
import { ZoneTariff } from "../../services/zoneService";

interface ZoneManagementScreenProps {
  // Driver info (passed from parent or context)
  driverId: string;
  companyId: string;
  vehicleId?: string;
  onTariffSelected?: (tariff: ZoneTariff) => void;
  onLocationReady?: () => void;
}

export const ZoneManagementScreen: React.FC<ZoneManagementScreenProps> = ({
  driverId,
  companyId,
  vehicleId,
  onTariffSelected,
  onLocationReady,
}) => {
  const [selectedTariff, setSelectedTariff] = useState<ZoneTariff | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  const {
    currentLocation,
    currentZone,
    availableTariffs,
    isTracking,
    startTracking,
    stopTracking,
    updateLocation,
    forceZoneCheck,
    error,
  } = useDriverLocation(driverId, companyId);

  // Initialize zone tracking
  useEffect(() => {
    const initializeTracking = async () => {
      try {
        setIsInitializing(true);

        // Load previously selected tariff
        const storedTariff = await AsyncStorage.getItem("selectedTariff");
        if (storedTariff) {
          setSelectedTariff(JSON.parse(storedTariff));
        }

        // Start location tracking
        const success = await startTracking();
        if (success) {
          console.log("✅ Zone tracking started successfully");
          onLocationReady?.();
        } else {
          Alert.alert(
            "Location Error",
            "Failed to start location tracking. Please check permissions.",
            [{ text: "OK" }]
          );
        }
      } catch (error) {
        console.error("❌ Error initializing tracking:", error);
        Alert.alert("Error", "Failed to initialize zone tracking");
      } finally {
        setIsInitializing(false);
      }
    };

    initializeTracking();

    // Cleanup on unmount
    return () => {
      stopTracking();
    };
  }, [driverId, companyId]);

  // Handle tariff selection
  const handleTariffSelect = async (tariff: ZoneTariff) => {
    try {
      setSelectedTariff(tariff);

      // Store selected tariff
      await AsyncStorage.setItem("selectedTariff", JSON.stringify(tariff));

      // Notify parent component
      onTariffSelected?.(tariff);

      console.log("✅ Tariff selected:", tariff.tariff.name);

      Alert.alert(
        "Tariff Selected",
        `You have selected: ${tariff.tariff.name}`,
        [{ text: "OK" }]
      );
    } catch (error) {
      console.error("❌ Error selecting tariff:", error);
      Alert.alert("Error", "Failed to select tariff");
    }
  };

  // Handle manual location update (for testing)
  const handleManualLocationUpdate = () => {
    Alert.prompt(
      "Update Location",
      "Enter coordinates (lat,lng):",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Update",
          onPress: (text) => {
            if (text) {
              const coords = text.split(",");
              if (coords.length === 2) {
                const lat = parseFloat(coords[0].trim());
                const lng = parseFloat(coords[1].trim());
                if (!isNaN(lat) && !isNaN(lng)) {
                  updateLocation(lat, lng);
                }
              }
            }
          },
        },
      ],
      "plain-text"
    );
  };

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Initializing zone tracking...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Zone Management</Text>
        <View style={styles.statusIndicator}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isTracking ? "#4CAF50" : "#FF5722" },
            ]}
          />
          <Text style={styles.statusText}>
            {isTracking ? "Tracking Active" : "Tracking Inactive"}
          </Text>
        </View>
      </View>

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => startTracking()}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Vehicle Info (if provided) */}
      {vehicleId && (
        <View style={styles.vehicleInfo}>
          <Text style={styles.vehicleText}>🚗 Vehicle: {vehicleId}</Text>
        </View>
      )}

      {/* Zone and Tariff Display */}
      <ZoneTariffDisplay
        currentLocation={currentLocation}
        currentZone={currentZone}
        availableTariffs={availableTariffs}
        selectedTariffId={selectedTariff?.tariff.id}
        onTariffSelect={handleTariffSelect}
      />

      {/* Action Buttons */}
      <View style={styles.actionButtons}>
        <TouchableOpacity style={styles.actionButton} onPress={forceZoneCheck}>
          <Text style={styles.actionButtonText}>🔄 Refresh Zone</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleManualLocationUpdate}
        >
          <Text style={styles.actionButtonText}>📍 Test Location</Text>
        </TouchableOpacity>
      </View>

      {/* Selected Tariff Summary */}
      {selectedTariff && (
        <View style={styles.selectedTariffSummary}>
          <Text style={styles.summaryTitle}>Current Tariff</Text>
          <Text style={styles.summaryText}>
            📋 {selectedTariff.tariff.name} - Base: $
            {selectedTariff.tariff.baseFare}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f5f5f5",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#333",
  },
  statusIndicator: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: "#666",
  },
  errorContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#ffebee",
    borderLeftWidth: 4,
    borderLeftColor: "#f44336",
    margin: 16,
    borderRadius: 4,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: "#c62828",
  },
  retryButton: {
    backgroundColor: "#f44336",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  vehicleInfo: {
    backgroundColor: "#e3f2fd",
    padding: 12,
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bbdefb",
  },
  vehicleText: {
    fontSize: 14,
    color: "#1565c0",
    fontWeight: "600",
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "space-around",
    padding: 16,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  actionButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
    alignItems: "center",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  selectedTariffSummary: {
    backgroundColor: "#e8f5e8",
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c3e6c3",
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2d5a2d",
    marginBottom: 4,
  },
  summaryText: {
    fontSize: 14,
    color: "#1a4d1a",
  },
});
