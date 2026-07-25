import React, { useMemo } from "react";
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
  maxVisible?: number;
}

const prettifyJobStatus = (status: string) => {
  return status
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const getStatusStyle = (status: string): { bg: string; color: string } => {
  const upper = status.toUpperCase();
  if (upper === "COMPLETED" || upper === "FINISHED")
    return { bg: "rgba(76, 175, 80, 0.15)", color: "#4ade80" };
  if (upper === "CANCELLED")
    return { bg: "rgba(239, 68, 68, 0.15)", color: "#f87171" };
  if (upper === "NOSHOW" || upper === "NO_SHOW")
    return { bg: "rgba(249, 115, 22, 0.15)", color: "#f97316" };
  return { bg: "rgba(148, 163, 184, 0.15)", color: "#94a3b8" };
};

const getPaymentIcon = (method?: string | null): { icon: string; color: string; label: string } => {
  const upper = (method || "").toUpperCase();
  if (upper === "CASH" || upper === "CASH_COLLECTION")
    return { icon: "cash", color: "#4ade80", label: "Cash" };
  if (upper === "CARD" || upper === "STRIPE")
    return { icon: "credit-card-outline", color: "#38bdf8", label: "Card" };
  if (upper === "WALLET" || upper === "ACCOUNT")
    return { icon: "wallet-outline", color: "#a78bfa", label: "Account" };
  return { icon: "help-circle-outline", color: "#8d95ad", label: "" };
};

const formatRelativeTime = (value?: string | null): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
};

const formatCompletedAt = (value?: string | null) => {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatDistanceLabel = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return "–";
  return formatDistance(value);
};

const formatDropoffAddress = (address?: string | null): string => {
  if (!address) return "Walk-in (no drop-off set)";
  const lower = address.toLowerCase();
  if (
    lower === "destination pending" ||
    lower === "destination - to be set" ||
    lower === "dropoff location"
  ) {
    return "Walk-in (no drop-off set)";
  }
  return address;
};

export const RecentJobsSection: React.FC<RecentJobsSectionProps> = ({
  jobs,
  loading = false,
  onRefresh,
  formatCurrency,
  formatDuration,
  maxVisible = 5,
}) => {
  const visibleJobs = useMemo(() => jobs.slice(0, maxVisible), [jobs, maxVisible]);

  if (!loading && jobs.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MCIcon name="history" size={16} color={Colors.accent.highlight} />
            <Text style={styles.title}>Recent Jobs</Text>
          </View>
        </View>
        <View style={styles.emptyContainer}>
          <MCIcon name="car-off" size={36} color="#3a3f52" />
          <Text style={styles.emptyText}>No completed trips yet</Text>
          <Text style={styles.emptySubtext}>
            Your completed trips will appear here
          </Text>
        </View>
      </View>
    );
  }

  const formatDurationLabel = (seconds?: number | null) => {
    if (typeof seconds !== "number" || Number.isNaN(seconds)) return "–";
    return formatDuration(seconds);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MCIcon name="history" size={16} color={Colors.accent.highlight} />
          <Text style={styles.title}>Recent Jobs</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{jobs.length}</Text>
          </View>
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
        {visibleJobs.map((job) => {
          const fareLabel = formatCurrency(job.fare.total);
          const driverEarnings =
            typeof job.fare.driverEarnings === "number"
              ? formatCurrency(job.fare.driverEarnings)
              : null;
          const statusStyle = getStatusStyle(job.status);
          const paymentInfo = getPaymentIcon(job.paymentMethod);
          const relativeTime = formatRelativeTime(job.completedAt);
          const dropoffText = formatDropoffAddress(job.dropoff?.address);
          const isWalkIn = dropoffText.startsWith("Walk-in");

          return (
            <View key={job.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.jobIdRow}>
                  <Text style={styles.jobCode}>
                    #{job.jobId?.slice(-6) || job.id.slice(-6)}
                  </Text>
                  {paymentInfo.label ? (
                    <View style={[styles.paymentBadge, { backgroundColor: `${paymentInfo.color}15` }]}>
                      <MCIcon name={paymentInfo.icon} size={10} color={paymentInfo.color} />
                      <Text style={[styles.paymentBadgeText, { color: paymentInfo.color }]}>
                        {paymentInfo.label}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.headerRight}>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusStyle.color }]}>
                      {prettifyJobStatus(job.status)}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.passengerRow}>
                <Text style={styles.passengerName} numberOfLines={1}>
                  {job.passenger?.name || "Guest Passenger"}
                </Text>
                <Text style={styles.timeText}>
                  {relativeTime || formatCompletedAt(job.completedAt)}
                </Text>
              </View>

              <View style={styles.routeBlock}>
                <View style={styles.routeIndicator}>
                  <View style={styles.routeDotGreen} />
                  <View style={styles.routeLine} />
                  <MCIcon
                    name="map-marker"
                    size={12}
                    color={isWalkIn ? "#6b7280" : "#f97316"}
                  />
                </View>
                <View style={styles.routeAddresses}>
                  <Text style={styles.routeText} numberOfLines={1}>
                    {job.pickup?.address || "Current Location"}
                  </Text>
                  <Text
                    style={[styles.routeText, isWalkIn && styles.routeTextMuted]}
                    numberOfLines={1}
                  >
                    {dropoffText}
                  </Text>
                </View>
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
                  <Text style={[styles.metricValue, styles.metricValueHighlight]}>
                    {driverEarnings ?? fareLabel}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {jobs.length > maxVisible && (
        <TouchableOpacity style={styles.viewAllButton} activeOpacity={0.85}>
          <Text style={styles.viewAllText}>
            View all {jobs.length} trips
          </Text>
          <MCIcon name="chevron-right" size={14} color={Colors.accent.highlight} />
        </TouchableOpacity>
      )}
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
  countBadge: {
    backgroundColor: "#2a2f3f",
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    marginLeft: 2,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#8d95ad",
  },
  refreshText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.accent.highlight,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 24,
    gap: 6,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  emptySubtext: {
    fontSize: 12,
    color: "#4b5563",
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
  jobIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  jobCode: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
  paymentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  paymentBadgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  passengerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  passengerName: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: "#e2e8f0",
    marginRight: 8,
  },
  routeBlock: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 2,
  },
  routeIndicator: {
    alignItems: "center",
    width: 14,
    paddingTop: 3,
  },
  routeDotGreen: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#4ade80",
  },
  routeLine: {
    width: 1.5,
    flex: 1,
    backgroundColor: "#2a2f3f",
    marginVertical: 2,
  },
  routeAddresses: {
    flex: 1,
    justifyContent: "space-between",
    gap: 4,
  },
  routeText: {
    fontSize: 11,
    color: "#e2e8f0",
  },
  routeTextMuted: {
    color: "#6b7280",
    fontStyle: "italic",
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
    backgroundColor: "#151821",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
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
  metricValueHighlight: {
    color: Colors.accent.highlight,
  },
  metricDivider: {
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    marginTop: 6,
  },
  viewAllText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.accent.highlight,
  },
});
