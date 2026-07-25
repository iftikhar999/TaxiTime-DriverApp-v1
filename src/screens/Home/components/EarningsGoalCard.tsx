import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

interface EarningsGoalCardProps {
  currentEarnings: number;
  dailyGoal?: number;
  formatCurrency: (amount: number) => string;
}

export const EarningsGoalCard: React.FC<EarningsGoalCardProps> = ({
  currentEarnings,
  dailyGoal = 100,
  formatCurrency,
}) => {
  const progress = useMemo(() => {
    if (dailyGoal <= 0) return 0;
    return Math.min(currentEarnings / dailyGoal, 1);
  }, [currentEarnings, dailyGoal]);

  const percentage = Math.round(progress * 100);
  const remaining = Math.max(dailyGoal - currentEarnings, 0);

  const progressColor = useMemo(() => {
    if (progress >= 1) return "#22c55e";
    if (progress >= 0.75) return "#4ade80";
    if (progress >= 0.5) return Colors.accent.highlight;
    if (progress >= 0.25) return "#f97316";
    return "#ef4444";
  }, [progress]);

  const milestone = useMemo(() => {
    if (progress >= 1) return { icon: "trophy", text: "Goal reached!", color: "#22c55e" };
    if (progress >= 0.75) return { icon: "fire", text: "Almost there!", color: "#4ade80" };
    if (progress >= 0.5) return { icon: "trending-up", text: "Halfway done", color: Colors.accent.highlight };
    if (progress >= 0.25) return { icon: "rocket-launch", text: "Getting started", color: "#f97316" };
    return { icon: "target", text: "Start earning", color: "#8d95ad" };
  }, [progress]);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <MCIcon name="bullseye-arrow" size={14} color={Colors.accent.highlight} />
          <Text style={styles.title}>Daily Goal</Text>
        </View>
        <View style={styles.milestoneRow}>
          <MCIcon name={milestone.icon} size={12} color={milestone.color} />
          <Text style={[styles.milestoneText, { color: milestone.color }]}>
            {milestone.text}
          </Text>
        </View>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.progressBarBg}>
          <View
            style={[
              styles.progressBarFill,
              {
                width: `${Math.max(percentage, 2)}%`,
                backgroundColor: progressColor,
              },
            ]}
          />
        </View>
        <Text style={[styles.percentageText, { color: progressColor }]}>
          {percentage}%
        </Text>
      </View>

      <View style={styles.amountsRow}>
        <Text style={styles.earnedText}>
          {formatCurrency(currentEarnings)}{" "}
          <Text style={styles.ofText}>of {formatCurrency(dailyGoal)}</Text>
        </Text>
        {remaining > 0 ? (
          <Text style={styles.remainingText}>
            {formatCurrency(remaining)} to go
          </Text>
        ) : (
          <Text style={[styles.remainingText, { color: "#22c55e" }]}>
            Goal complete!
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  milestoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  milestoneText: {
    fontSize: 11,
    fontWeight: "600",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: "#242838",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 4,
    minWidth: 4,
  },
  percentageText: {
    fontSize: 13,
    fontWeight: "800",
    minWidth: 36,
    textAlign: "right",
  },
  amountsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  earnedText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#ffffff",
  },
  ofText: {
    fontWeight: "500",
    color: "#8d95ad",
  },
  remainingText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8d95ad",
  },
});
