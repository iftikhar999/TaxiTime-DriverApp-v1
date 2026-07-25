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

/* ── helpers ─────────────────────────────────────────── */

const formatPickupTime = (scheduledFor?: string): string | null => {
  if (!scheduledFor) return null;
  const d = new Date(scheduledFor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// `formatDropoff` removed: dropoff is no longer rendered on the available-jobs
// card. See anti-cherry-picking comment in the route block below.

/* ── component ───────────────────────────────────────── */

export const UpcomingJobsSection: React.FC<UpcomingJobsSectionProps> = ({
  jobs,
  loading,
  onClaimJob,
  onRefresh,
  formatCurrency,
  errorMessage,
  claimingJobId,
}) => {
  /* ---------- loading ---------- */
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MCIcon name="briefcase-clock" size={16} color={Colors.accent.highlight} />
            <Text style={styles.title}>Available Jobs</Text>
          </View>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={Colors.accent.highlight} />
          <Text style={styles.loadingText}>Finding jobs near you...</Text>
        </View>
      </View>
    );
  }

  /* ---------- empty ---------- */
  if (jobs.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <MCIcon name="briefcase-clock" size={16} color={Colors.accent.highlight} />
            <Text style={styles.title}>Available Jobs</Text>
          </View>
          {onRefresh && (
            <TouchableOpacity onPress={onRefresh} activeOpacity={0.85}>
              <MCIcon name="refresh" size={16} color="#8d95ad" />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.emptyContainer}>
          <MCIcon name="briefcase-off" size={36} color="#3a3f52" />
          <Text style={styles.emptyText}>No jobs available</Text>
          <Text style={styles.emptySubtext}>
            New rides will appear when they match your zone
          </Text>
          {!!errorMessage && (
            <Text style={styles.errorText}>{errorMessage}</Text>
          )}
        </View>
      </View>
    );
  }

  /* ---------- list ---------- */
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <MCIcon name="briefcase-clock" size={16} color={Colors.accent.highlight} />
          <Text style={styles.title}>Available Jobs</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{jobs.length}</Text>
          </View>
        </View>
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.85}>
            <MCIcon name="refresh" size={16} color="#8d95ad" />
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
          const pickupTime = formatPickupTime(job.scheduledFor);

          return (
            <View key={job.id} style={styles.card}>
              {/* ── top row: passenger + badges ── */}
              <View style={styles.cardTop}>
                <View style={styles.cardTopLeft}>
                  <Text style={styles.passengerName} numberOfLines={1}>
                    {job.passengerName || "Passenger"}
                  </Text>
                  {job.isLate && (
                    <View style={styles.lateBadge}>
                      <Text style={styles.lateBadgeText}>LATE</Text>
                    </View>
                  )}
                  {pickupTime && (
                    <View style={styles.timeBadge}>
                      <MCIcon name="clock-outline" size={10} color="#38bdf8" />
                      <Text style={styles.timeBadgeText}>{pickupTime}</Text>
                    </View>
                  )}
                </View>
              </View>

              {/* ── pickup only — dropoff is intentionally hidden to
                   prevent cherry-picking (drivers shouldn't accept or reject
                   based on ride length). They get the full destination after
                   claiming the job. ── */}
              <View style={styles.routeBlock}>
                <View style={styles.pickupIndicator}>
                  <View style={styles.routeDotGreen} />
                </View>
                <View style={styles.routeAddresses}>
                  <Text style={styles.pickupLabel}>PICKUP</Text>
                  <Text style={styles.addressText} numberOfLines={2}>
                    {job.pickupAddress}
                  </Text>
                </View>
              </View>

              {/* ── bottom row: ONLY distance-to-pickup + ETA-to-pickup.
                   `estimatedDistance` (total ride length) is hidden for the
                   same anti-cherry-picking reason. ── */}
              <View style={styles.cardBottom}>
                <View style={styles.chipRow}>
                  {typeof job.distanceToPickup === "number" && (
                    <View style={styles.chip}>
                      <MCIcon name="map-marker-distance" size={11} color="#8d95ad" />
                      <Text style={styles.chipText}>
                        {formatDistance(job.distanceToPickup)} away
                      </Text>
                    </View>
                  )}
                  {typeof job.minutesToPickup === "number" && (
                    <View style={styles.chip}>
                      <MCIcon name="timer-sand" size={11} color="#8d95ad" />
                      <Text style={styles.chipText}>
                        {job.minutesToPickup <= 0
                          ? "Overdue"
                          : `${job.minutesToPickup} min to pickup`}
                      </Text>
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.claimButton,
                    claimingInProgress && styles.claimButtonDisabled,
                  ]}
                  onPress={() => onClaimJob(job.id)}
                  activeOpacity={0.85}
                  disabled={claimingInProgress}
                >
                  {isClaiming ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <>
                      <MCIcon name="hand-back-right" size={14} color="#000" />
                      <Text style={styles.claimButtonText}>Claim</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};

/* ── styles ──────────────────────────────────────────── */

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
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
    backgroundColor: Colors.accent.highlight,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
    marginLeft: 2,
  },
  countBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#000",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
    marginHorizontal: 12,
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  loadingText: {
    fontSize: 12,
    color: "#8d95ad",
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 24,
    paddingHorizontal: 12,
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
    textAlign: "center",
  },
  errorText: {
    marginTop: 6,
    fontSize: 11,
    color: Colors.danger,
    textAlign: "center",
  },

  /* scroll */
  scrollContent: {
    paddingHorizontal: 12,
    gap: 10,
  },
  card: {
    width: 280,
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },

  /* card top */
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  cardTopLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginRight: 8,
  },
  passengerName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    flexShrink: 1,
  },
  lateBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "rgba(239, 68, 68, 0.18)",
  },
  lateBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#f87171",
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "rgba(56, 189, 248, 0.12)",
  },
  timeBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#38bdf8",
  },
  fare: {
    fontSize: 15,
    fontWeight: "800",
    color: Colors.accent.highlight,
  },

  /* route block */
  routeBlock: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  routeIndicator: {
    alignItems: "center",
    width: 14,
    paddingTop: 3,
  },
  pickupIndicator: {
    alignItems: "center",
    width: 14,
    paddingTop: 5,
  },
  pickupLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#4ade80",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  routeDotGreen: {
    width: 8,
    height: 8,
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
    gap: 6,
  },
  addressText: {
    fontSize: 12,
    color: "#e2e8f0",
    lineHeight: 16,
  },
  addressMuted: {
    color: "#6b7280",
    fontStyle: "italic",
  },

  /* bottom row */
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chipRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginRight: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#151821",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#8d95ad",
  },

  /* claim */
  claimButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent.highlight,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    gap: 4,
  },
  claimButtonDisabled: {
    opacity: 0.5,
  },
  claimButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#000",
  },
});
