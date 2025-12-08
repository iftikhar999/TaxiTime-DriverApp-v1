import React from "react";
import {
    ActivityIndicator,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";
import { RecentJobSummary } from "../../../types/recentJob";
import { formatDistance } from "../../../utils/distance";

interface RecentJobsSectionProps {
  jobs: RecentJobSummary[];
  loading?: boolean;
  onRefresh?: () => void;
  formatCurrency: (amount: number) => string;
  formatDuration: (seconds: number) => string;
}

const prettifyJobStatus = (status: string) => {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatCompletedAt = (value?: string | null) => {
  if (!value) {
    return "–";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "–";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDistanceLabel = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "–";
  }
  return formatDistance(value);
};

export const RecentJobsSection: React.FC<RecentJobsSectionProps> = ({
  jobs,
  loading = false,
  onRefresh,
  formatCurrency,
  formatDuration,
}) => {
  if (!loading && jobs.length === 0) {
    return null;
  }

  const formatDurationLabel = (seconds?: number | null) => {
    if (typeof seconds !== "number" || Number.isNaN(seconds)) {
      return "–";
    }
    return formatDuration(seconds);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MCIcon name="history" size={16} color={Colors.accent.highlight} />
          <Text style={styles.title}>Recent Jobs</Text>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={Colors.accent.highlight} />
        ) : onRefresh ? (
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.85}>
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.list}>
        {jobs.map((job) => {
          const fareLabel = formatCurrency(job.fare.total);
          const driverEarnings =
            typeof job.fare.driverEarnings === "number"
              ? formatCurrency(job.fare.driverEarnings)
              : null;

          return (
            <View key={job.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.jobCode}>
                  #{job.jobId?.slice(-6) || job.id.slice(-6)}
                </Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>
                    {prettifyJobStatus(job.status)}
                  </Text>
                </View>
              </View>

              <View style={styles.row}>
                <MCIcon name="account" size={14} color="#8d95ad" />
                <Text style={styles.rowText} numberOfLines={1}>
                  {job.passenger?.name || "Passenger"}
                </Text>
                <Text style={styles.timeText}>{formatCompletedAt(job.completedAt)}</Text>
              </View>

              <View style={styles.row}>
                <MCIcon name="map-marker" size={14} color="#8d95ad" />
                <Text style={styles.rowText} numberOfLines={1}>
                  {job.pickup?.address || "Pickup location"}
                </Text>
              </View>

              <View style={styles.row}>
                <MCIcon name="flag-checkered" size={14} color="#8d95ad" />
                <Text style={styles.rowText} numberOfLines={1}>
                  {job.dropoff?.address || "Dropoff location"}
                </Text>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Distance</Text>
                  <Text style={styles.metricValue}>
                    {formatDistanceLabel(job.distanceKm)}
                  </Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Duration</Text>
                  <Text style={styles.metricValue}>
                    {formatDurationLabel(job.durationSeconds)}
                  </Text>
                </View>
                <View style={styles.metricDivider} />
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>Fare</Text>
                  <Text style={styles.metricValue}>
                    {driverEarnings ?? fareLabel}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  refreshText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.accent.highlight,
  },
  list: {
    gap: 8,
  },
  card: {
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  jobCode: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(76, 175, 80, 0.2)",
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#4ade80",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  rowText: {
    flex: 1,
    fontSize: 11,
    color: "#e2e8f0",
  },
  timeText: {
    fontSize: 10,
    color: "#94a3b8",
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  metric: {
    flex: 1,
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 9,
    color: "#8d95ad",
    marginBottom: 1,
  },
  metricValue: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  metricDivider: {
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});
