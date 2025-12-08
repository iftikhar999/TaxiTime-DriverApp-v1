import React from "react";
import { StyleSheet, Text, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";

interface DashboardMetricProps {
  icon: string;
  label: string;
  value: string;
  color: string;
}

export const DashboardMetric: React.FC<DashboardMetricProps> = ({
  icon,
  label,
  value,
  color,
}) => {
  const normalizedValue = value ?? "—";
  const dynamicFontSize =
    normalizedValue.length > 10 ? 12 : normalizedValue.length > 6 ? 14 : 16;

  return (
    <View style={styles.metricCard}>
      <MCIcon name={icon} size={16} color={color} />
      <Text
        style={[styles.metricValue, { color, fontSize: dynamicFontSize }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {normalizedValue}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  metricCard: {
    flex: 1,
    backgroundColor: "#1e2230",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: "center",
    marginHorizontal: 3,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    flexShrink: 1,
  },
  metricValue: {
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
    width: "100%",
  },
  metricLabel: {
    fontSize: 10,
    color: "#8d95ad",
    marginTop: 2,
    textAlign: "center",
    width: "100%",
  },
});
