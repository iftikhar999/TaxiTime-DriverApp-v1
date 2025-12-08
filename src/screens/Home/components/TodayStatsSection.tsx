import React from "react";
import { StyleSheet, Text, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

interface TodayStatsSectionProps {
  totalJobs: number;
  totalEarnings: number;
  formatCurrency: (amount: number) => string;
}

export const TodayStatsSection: React.FC<TodayStatsSectionProps> = ({
  totalJobs,
  totalEarnings,
  formatCurrency,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.cardHeader}>
        <MCIcon name="calendar-today" size={20} color={Colors.accent.highlight} />
        <Text style={styles.cardTitle}>Today's Performance</Text>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <MCIcon name="briefcase-check" size={20} color="#4ade80" />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Jobs Completed</Text>
            <Text style={styles.statValue}>{totalJobs}</Text>
          </View>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <View style={styles.statIconContainer}>
            <MCIcon name="cash-multiple" size={20} color={Colors.accent.highlight} />
          </View>
          <View style={styles.statContent}>
            <Text style={styles.statLabel}>Total Earned</Text>
            <Text style={styles.statValueHighlight}>
              {formatCurrency(totalEarnings)}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  statItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  statIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2f3f",
    justifyContent: "center",
    alignItems: "center",
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    color: "#8d95ad",
    marginBottom: 3,
  },
  statValue: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  statValueHighlight: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.accent.highlight,
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: "#2a2f3f",
    marginHorizontal: 12,
  },
});
