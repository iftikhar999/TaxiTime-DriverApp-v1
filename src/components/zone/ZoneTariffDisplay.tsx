import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LocationData } from "../../services/locationService";
import { Zone, ZoneTariff } from "../../services/zoneService";

interface ZoneTariffDisplayProps {
  currentZone: Zone | null;
  availableTariffs: ZoneTariff[];
  currentLocation: LocationData | null;
  onTariffSelect?: (tariff: ZoneTariff) => void;
  selectedTariffId?: string;
}

export const ZoneTariffDisplay: React.FC<ZoneTariffDisplayProps> = ({
  currentZone,
  availableTariffs,
  currentLocation,
  onTariffSelect,
  selectedTariffId,
}) => {
  if (!currentLocation) {
    return (
      <View style={styles.container}>
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>📍 Getting location...</Text>
        </View>
      </View>
    );
  }

  if (!currentZone) {
    return (
      <View style={styles.container}>
        <View style={styles.statusCard}>
          <Text style={styles.statusText}>🌍 Outside service area</Text>
          <Text style={styles.locationText}>
            📍 {currentLocation.latitude.toFixed(4)},{" "}
            {currentLocation.longitude.toFixed(4)}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Current Zone Info */}
      <View style={styles.zoneCard}>
        <Text style={styles.zoneTitle}>📍 Current Zone</Text>
        <Text style={styles.zoneName}>{currentZone.name}</Text>
        {currentZone.description && (
          <Text style={styles.zoneDescription}>{currentZone.description}</Text>
        )}
        <Text style={styles.locationText}>
          📍 {currentLocation.latitude.toFixed(4)},{" "}
          {currentLocation.longitude.toFixed(4)}
        </Text>
      </View>

      {/* Available Tariffs */}
      <View style={styles.tariffsSection}>
        <Text style={styles.sectionTitle}>
          💰 Available Tariffs ({availableTariffs.length})
        </Text>

        {availableTariffs.length === 0 ? (
          <View style={styles.noTariffsCard}>
            <Text style={styles.noTariffsText}>
              No tariffs available for this zone
            </Text>
          </View>
        ) : (
          <ScrollView
            style={styles.tariffsList}
            showsVerticalScrollIndicator={false}
          >
            {availableTariffs.map((zoneTariff) => (
              <TariffCard
                key={zoneTariff.id}
                zoneTariff={zoneTariff}
                isSelected={selectedTariffId === zoneTariff.tariff.id}
                onSelect={() => onTariffSelect?.(zoneTariff)}
              />
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
};

interface TariffCardProps {
  zoneTariff: ZoneTariff;
  isSelected: boolean;
  onSelect: () => void;
}

const TariffCard: React.FC<TariffCardProps> = ({
  zoneTariff,
  isSelected,
  onSelect,
}) => {
  const { tariff } = zoneTariff;

  return (
    <TouchableOpacity
      style={[styles.tariffCard, isSelected && styles.selectedTariffCard]}
      onPress={onSelect}
      activeOpacity={0.7}
    >
      <View style={styles.tariffHeader}>
        <Text style={[styles.tariffName, isSelected && styles.selectedText]}>
          {tariff.name}
        </Text>
        {tariff.vehicleType && (
          <Text style={[styles.vehicleType, isSelected && styles.selectedText]}>
            🚗 {tariff.vehicleType}
          </Text>
        )}
      </View>

      {tariff.description && (
        <Text
          style={[styles.tariffDescription, isSelected && styles.selectedText]}
        >
          {tariff.description}
        </Text>
      )}

      <View style={styles.tariffRates}>
        <View style={styles.rateRow}>
          <Text style={[styles.rateLabel, isSelected && styles.selectedText]}>
            Base Fare:
          </Text>
          <Text style={[styles.rateValue, isSelected && styles.selectedText]}>
            ${tariff.baseFare.toFixed(2)}
          </Text>
        </View>

        <View style={styles.rateRow}>
          <Text style={[styles.rateLabel, isSelected && styles.selectedText]}>
            Per KM:
          </Text>
          <Text style={[styles.rateValue, isSelected && styles.selectedText]}>
            ${tariff.perKmRate.toFixed(2)}
          </Text>
        </View>

        <View style={styles.rateRow}>
          <Text style={[styles.rateLabel, isSelected && styles.selectedText]}>
            Per Minute:
          </Text>
          <Text style={[styles.rateValue, isSelected && styles.selectedText]}>
            ${tariff.perMinuteRate.toFixed(2)}
          </Text>
        </View>

        <View style={styles.rateRow}>
          <Text style={[styles.rateLabel, isSelected && styles.selectedText]}>
            Minimum:
          </Text>
          <Text style={[styles.rateValue, isSelected && styles.selectedText]}>
            ${tariff.minimumFare.toFixed(2)}
          </Text>
        </View>

        {tariff.waitingFeePerMinute && tariff.waitingFeePerMinute > 0 && (
          <View style={styles.rateRow}>
            <Text style={[styles.rateLabel, isSelected && styles.selectedText]}>
              Waiting:
            </Text>
            <Text style={[styles.rateValue, isSelected && styles.selectedText]}>
              ${tariff.waitingFeePerMinute.toFixed(2)}/min
            </Text>
          </View>
        )}
      </View>

      {isSelected && (
        <View style={styles.selectedIndicator}>
          <Text style={styles.selectedIndicatorText}>✓ Selected</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: "#f5f5f5",
  },
  statusCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statusText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
    marginBottom: 8,
  },
  locationText: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
  },
  zoneCard: {
    backgroundColor: "#e8f5e8",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#c3e6c3",
  },
  zoneTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2d5a2d",
    marginBottom: 4,
  },
  zoneName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1a4d1a",
    marginBottom: 4,
  },
  zoneDescription: {
    fontSize: 14,
    color: "#4a7a4a",
    marginBottom: 8,
  },
  tariffsSection: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 12,
  },
  tariffsList: {
    flex: 1,
  },
  noTariffsCard: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  noTariffsText: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
  },
  tariffCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedTariffCard: {
    borderColor: "#007AFF",
    borderWidth: 2,
    backgroundColor: "#f0f8ff",
  },
  tariffHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  tariffName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#333",
    flex: 1,
  },
  vehicleType: {
    fontSize: 12,
    color: "#666",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tariffDescription: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  tariffRates: {
    gap: 6,
  },
  rateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rateLabel: {
    fontSize: 13,
    color: "#666",
  },
  rateValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  selectedText: {
    color: "#007AFF",
  },
  selectedIndicator: {
    marginTop: 12,
    padding: 8,
    backgroundColor: "#007AFF",
    borderRadius: 6,
    alignItems: "center",
  },
  selectedIndicatorText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
