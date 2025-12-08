import React from "react";
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";
import { formatDistance } from "../../../utils/distance";

interface Job {
  id: string;
  pickupAddress: string;
  dropoffAddress?: string;
  estimatedDistance?: number;
  estimatedFare?: number;
  scheduledFor?: string;
  passengerName?: string;
  isLate?: boolean;
  minutesToPickup?: number;
  distanceToPickup?: number;
}

interface UpcomingJobsSectionProps {
  jobs: Job[];
  loading?: boolean;
  onClaimJob: (jobId: string) => void;
  onRefresh?: () => void;
  formatCurrency: (amount: number) => string;
  errorMessage?: string | null;
  claimingJobId?: string | null;
}

export const UpcomingJobsSection: React.FC<UpcomingJobsSectionProps> = ({
  jobs,
  loading,
  onClaimJob,
  onRefresh,
  formatCurrency,
  errorMessage,
  claimingJobId,
}) => {
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <MCIcon name="briefcase-clock" size={20} color={Colors.accent.highlight} />
          <Text style={styles.title}>Available Jobs</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.accent.highlight} />
          <Text style={styles.loadingText}>Loading available jobs...</Text>
        </View>
      </View>
    );
  }

  if (jobs.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <MCIcon name="briefcase-clock" size={20} color={Colors.accent.highlight} />
          <Text style={styles.title}>Available Jobs</Text>
          {onRefresh && (
            <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
              <MCIcon name="refresh" size={18} color="#8d95ad" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.emptyContainer}>
          <MCIcon name="briefcase-off" size={48} color="#8d95ad" />
          <Text style={styles.emptyText}>No jobs available right now</Text>
          <Text style={styles.emptySubtext}>
            New jobs will appear here when they're assigned to your zone
          </Text>
          {!!errorMessage && (
            <Text style={styles.errorText}>{errorMessage}</Text>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MCIcon name="briefcase-clock" size={20} color={Colors.accent.highlight} />
        <Text style={styles.title}>Available Jobs ({jobs.length})</Text>
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} style={styles.refreshButton}>
            <MCIcon name="refresh" size={18} color="#8d95ad" />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {jobs.map((job) => {
          const isClaiming = claimingJobId === job.id;
          const claimingInProgress = Boolean(claimingJobId);
          return (
            <View key={job.id} style={styles.jobCard}>
            <View style={styles.jobHeader}>
              <View style={styles.jobHeaderLeft}>
                <MCIcon name="account-circle" size={20} color="#8d95ad" />
                <Text style={styles.passengerName} numberOfLines={1}>
                  {job.passengerName || "Passenger"}
                </Text>
              </View>
              <View style={styles.jobHeaderRight}>
                {job.isLate && (
                  <View style={styles.lateBadge}>
                    <Text style={styles.lateBadgeText}>Late</Text>
                  </View>
                )}
                {job.estimatedFare ? (
                  <Text style={styles.estimatedFare}>
                    {formatCurrency(job.estimatedFare)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.addressRow}>
              <MCIcon name="map-marker" size={16} color="#4ade80" />
              <Text style={styles.addressText} numberOfLines={2}>
                {job.pickupAddress}
              </Text>
            </View>

            {job.dropoffAddress ? (
              <View style={styles.addressRow}>
                <MCIcon name="flag-checkered" size={16} color={Colors.danger} />
                <Text style={styles.addressText} numberOfLines={2}>
                  {job.dropoffAddress}
                </Text>
              </View>
            ) : null}

            {job.estimatedDistance ? (
              <View style={styles.infoRow}>
                <MCIcon name="map-marker-distance" size={14} color="#8d95ad" />
                <Text style={styles.infoText}>
                  ~{job.estimatedDistance.toFixed(1)} km away
                </Text>
              </View>
            ) : null}

            {typeof job.distanceToPickup === "number" && (
              <View style={styles.infoRow}>
                <MCIcon name="crosshairs" size={14} color="#8d95ad" />
                <Text style={styles.infoText}>
                  {formatDistance(job.distanceToPickup)}
                </Text>
              </View>
            )}

            {job.scheduledFor ? (
              <View style={styles.infoRow}>
                <MCIcon name="clock-outline" size={14} color="#8d95ad" />
                <Text style={styles.infoText}>
                  Scheduled: {new Date(job.scheduledFor).toLocaleTimeString()}
                </Text>
              </View>
            ) : null}

            {typeof job.minutesToPickup === "number" && (
              <View style={styles.infoRow}>
                <MCIcon name="timer-sand" size={14} color="#8d95ad" />
                <Text style={styles.infoText}>
                  {job.minutesToPickup <= 0
                    ? "Pickup overdue"
                    : `Pickup in ${job.minutesToPickup} min`}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={[styles.claimButton, claimingInProgress && styles.claimButtonDisabled]}
              onPress={() => onClaimJob(job.id)}
              activeOpacity={0.85}
              disabled={claimingInProgress}
            >
              {isClaiming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MCIcon name="hand-back-right" size={18} color="#fff" />
              )}
              <Text style={styles.claimButtonText}>
                {isClaiming ? "Claiming..." : "Claim Job"}
              </Text>
            </TouchableOpacity>
          </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 6,
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    color: "#ffffff",
  },
  refreshButton: {
    padding: 4,
  },
  loadingContainer: {
    padding: 28,
    alignItems: "center",
    backgroundColor: "#1a1d29",
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: "#8d95ad",
  },
  emptyContainer: {
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: "center",
    backgroundColor: "#1a1d29",
    marginHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    minHeight: 120,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 15,
    fontWeight: "600",
    color: "#ffffff",
  },
  emptySubtext: {
    marginTop: 8,
    fontSize: 13,
    color: "#8d95ad",
    textAlign: "center",
  },
  errorText: {
    marginTop: 10,
    fontSize: 12,
    color: Colors.danger,
    textAlign: "center",
  },
  scrollContent: {
    paddingHorizontal: 12,
    gap: 8,
  },
  jobCard: {
    width: 240,
    backgroundColor: "#1a1d29",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  jobHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  jobHeaderLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  jobHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  passengerName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#ffffff",
  },
  estimatedFare: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.accent.highlight,
  },
  lateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.4)",
  },
  lateBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#f87171",
    textTransform: "uppercase",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6,
    gap: 6,
  },
  addressText: {
    flex: 1,
    fontSize: 12,
    color: "#8d95ad",
    lineHeight: 16,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    gap: 6,
  },
  infoText: {
    fontSize: 11,
    color: "#8d95ad",
  },
  claimButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent.highlight,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 6,
    gap: 6,
  },
  claimButtonDisabled: {
    opacity: 0.7,
  },
  claimButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#fff",
  },
});
