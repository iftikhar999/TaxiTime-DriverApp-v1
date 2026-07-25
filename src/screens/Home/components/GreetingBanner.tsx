import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

interface GreetingBannerProps {
  driverName?: string;
  totalEarnings: number;
  totalTrips: number;
  onlineMinutes: number;
  formatCurrency: (amount: number) => string;
}

const getGreeting = (): { text: string; icon: string; accent: string } => {
  const hour = new Date().getHours();
  if (hour < 6) return { text: "Good night", icon: "weather-night", accent: "#818cf8" };
  if (hour < 12) return { text: "Good morning", icon: "weather-sunny", accent: "#fbbf24" };
  if (hour < 17) return { text: "Good afternoon", icon: "white-balance-sunny", accent: "#f97316" };
  if (hour < 21) return { text: "Good evening", icon: "weather-sunset", accent: "#f472b6" };
  return { text: "Good night", icon: "weather-night", accent: "#818cf8" };
};

const getMotivationalText = (trips: number, earnings: number): string => {
  if (trips === 0) return "Ready to start earning? Jobs are waiting!";
  if (trips === 1) return "First trip done! Keep the momentum going.";
  if (trips < 5) return "Nice start! You're building a great session.";
  if (trips < 10) return "You're on fire! Keep up the excellent work.";
  return "Outstanding session! You're a top performer today.";
};

export const GreetingBanner: React.FC<GreetingBannerProps> = ({
  driverName,
  totalEarnings,
  totalTrips,
  onlineMinutes,
  formatCurrency,
}) => {
  const greeting = useMemo(() => getGreeting(), []);
  const motivation = useMemo(
    () => getMotivationalText(totalTrips, totalEarnings),
    [totalTrips, totalEarnings]
  );
  const firstName = driverName?.split(" ")[0] || "Driver";

  return (
    <View style={styles.container}>
      <View style={styles.greetingRow}>
        <MCIcon name={greeting.icon} size={20} color={greeting.accent} />
        <Text style={styles.greetingText}>
          {greeting.text},{" "}
          <Text style={styles.nameText}>{firstName}</Text>
        </Text>
      </View>
      <Text style={styles.motivationText}>{motivation}</Text>

      <View style={styles.quickStats}>
        <View style={styles.quickStat}>
          <Text style={styles.quickStatValue}>
            {formatCurrency(totalEarnings)}
          </Text>
          <Text style={styles.quickStatLabel}>Today</Text>
        </View>
        <View style={styles.quickStatDivider} />
        <View style={styles.quickStat}>
          <Text style={styles.quickStatValue}>{totalTrips}</Text>
          <Text style={styles.quickStatLabel}>Trips</Text>
        </View>
        <View style={styles.quickStatDivider} />
        <View style={styles.quickStat}>
          <Text style={styles.quickStatValue}>
            {onlineMinutes >= 60
              ? `${Math.floor(onlineMinutes / 60)}h ${onlineMinutes % 60}m`
              : `${onlineMinutes}m`}
          </Text>
          <Text style={styles.quickStatLabel}>Online</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: "#1a1d29",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  greetingText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#c8cee0",
  },
  nameText: {
    fontWeight: "800",
    color: "#ffffff",
  },
  motivationText: {
    fontSize: 12,
    color: "#8d95ad",
    marginBottom: 12,
    lineHeight: 16,
  },
  quickStats: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#151821",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  quickStat: {
    flex: 1,
    alignItems: "center",
  },
  quickStatValue: {
    fontSize: 16,
    fontWeight: "800",
    color: Colors.accent.highlight,
  },
  quickStatLabel: {
    fontSize: 10,
    color: "#8d95ad",
    fontWeight: "600",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  quickStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#2a2f3f",
  },
});
