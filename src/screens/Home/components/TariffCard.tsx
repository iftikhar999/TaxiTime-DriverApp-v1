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
    ? `${tariffName}`
    : "Select a tariff";

  const rateText = hasTariff
    ? `${formatCurrency(baseFare || 0)} base  ·  ${formatCurrency(perKm || 0)}/km  ·  ${formatCurrency(perMinute || 0)}/min`
    : "Tap to choose pricing";

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
        <View style={styles.textContent}>
          <Text style={styles.tariffName} numberOfLines={1}>
            {summaryText}
          </Text>
          <Text style={styles.rateText} numberOfLines={1}>
            {rateText}
          </Text>
        </View>
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
  textContent: {
    flex: 1,
  },
  tariffName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
    letterSpacing: 0.2,
  },
  rateText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#8d95ad",
    marginTop: 1,
  },
});
