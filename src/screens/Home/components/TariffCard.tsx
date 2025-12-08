import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

interface TariffCardProps {
  tariffName?: string;
  baseFare?: number;
  perKm?: number;
  perMinute?: number;
  onPress?: () => void;
  formatCurrency: (amount: number) => string;
}

export const TariffCard: React.FC<TariffCardProps> = ({
  tariffName,
  baseFare,
  perKm,
  perMinute,
  onPress,
  formatCurrency,
}) => {
  const hasTariff = Boolean(tariffName);
  const summaryText = hasTariff
    ? `Tariff · ${tariffName}  •  Base ${formatCurrency(
        baseFare || 0
      )}  •  Km ${formatCurrency(perKm || 0)}  •  Min ${formatCurrency(
        perMinute || 0
      )}`
    : "Select a tariff to update pricing";

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.85}
      disabled={!onPress}
      hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
      accessibilityRole="button"
    >
      <View style={styles.inlineContent}>
        <View style={styles.iconContainer}>
          <MCIcon name="currency-usd" size={14} color={Colors.accent.highlight} />
        </View>
        <Text style={styles.summaryText} numberOfLines={1}>
          {summaryText}
        </Text>
      </View>
      {onPress ? (
        <MCIcon name="chevron-right" size={16} color="#8d95ad" />
      ) : null}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1a1d29",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 6,
    marginHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  inlineContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  iconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(245, 180, 0, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  summaryText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
});
