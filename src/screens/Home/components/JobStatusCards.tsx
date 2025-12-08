import React, { useEffect, useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { openExternalNavigation } from "../../../utils/navigationHelper";

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

interface ActiveJobPreview {
  jobLabel: string;
  displayJobId?: string;
  passengerName?: string;
  destination?: string;
  dropoffLatitude?: number | null;
  dropoffLongitude?: number | null;
  fareLabel: string;
  durationLabel: string;
  waitingLabel: string | null;
  statusLabel: string;
}

interface JobStatusCardsProps {
  acceptedJobsCount: number;
  onGoingJobsCount: number;
  onViewAcceptedJobs: () => void;
  onViewOnGoingJobs: () => void;
  activeJobPreview?: ActiveJobPreview | null;
}

export const JobStatusCards: React.FC<JobStatusCardsProps> = ({
  acceptedJobsCount,
  onGoingJobsCount,
  onViewAcceptedJobs,
  onViewOnGoingJobs,
  activeJobPreview,
}) => {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (acceptedJobsCount > 0) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }

    pulseAnim.stopAnimation();
    pulseAnim.setValue(0);
  }, [acceptedJobsCount, pulseAnim]);

  const attentionStyles = useMemo(() => {
    const scale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.04],
    });
    const shadow = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.75],
    });

    return [
      styles.card,
      styles.attentionCard,
      {
        transform: [{ scale }],
        shadowOpacity: shadow,
      },
    ];
  }, [pulseAnim]);

  if (acceptedJobsCount === 0 && onGoingJobsCount === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      {acceptedJobsCount > 0 && (
        <AnimatedTouchable
          style={attentionStyles}
          onPress={onViewAcceptedJobs}
          activeOpacity={0.85}
        >
          <View style={styles.cardContent}>
            <View style={[styles.iconContainer, styles.attentionIcon]}> 
              <MCIcon name="briefcase-check" size={24} color="#fee2e2" />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardLabel, styles.attentionText]}>Accepted Jobs</Text>
              <Text style={[styles.cardValue, styles.attentionValue]}>{acceptedJobsCount}</Text>
              <Text style={styles.attentionSubtext}>Tap to continue</Text>
            </View>
            <View style={styles.attentionChevon}>
              <MCIcon name="chevron-right" size={20} color="#fecaca" />
            </View>
          </View>
          <View style={styles.attentionBadge}>
            <MCIcon name="bell-ring" size={14} color="#fff" />
            <Text style={styles.attentionBadgeText}>Action</Text>
          </View>
        </AnimatedTouchable>
      )}

      {onGoingJobsCount > 0 && (
        <TouchableOpacity
          style={[styles.card, styles.activeCard]}
          onPress={onViewOnGoingJobs}
          activeOpacity={0.85}
        >
          {activeJobPreview ? (
            <>
              <View style={styles.activeHeader}>
                <View>
                  <Text style={styles.activeLabel}>Active Ride</Text>
                  <Text style={styles.activeJobId}>#{activeJobPreview.displayJobId || activeJobPreview.jobLabel}</Text>
                </View>
                <Text style={styles.activeStatus}>{activeJobPreview.statusLabel}</Text>
              </View>
              <View style={styles.activeFareRow}>
                <Text style={styles.activeFareLabel}>Total Earned</Text>
                <Text style={styles.activeFareValue}>{activeJobPreview.fareLabel}</Text>
              </View>
              <View style={styles.activeDetails}>
                <MCIcon name="account-circle" size={16} color="#8d95ad" />
                <Text style={styles.activeText} numberOfLines={1}>
                  {activeJobPreview.passengerName || "Passenger"}
                </Text>
              </View>
              <View style={styles.activeDetails}>
                <MCIcon name="flag-checkered" size={16} color="#f97316" />
                <Text style={styles.activeText} numberOfLines={1}>
                  {activeJobPreview.destination || "Destination pending"}
                </Text>
                {typeof activeJobPreview.dropoffLatitude === "number" &&
                Number.isFinite(activeJobPreview.dropoffLatitude) &&
                typeof activeJobPreview.dropoffLongitude === "number" &&
                Number.isFinite(activeJobPreview.dropoffLongitude) ? (
                  <TouchableOpacity
                    style={styles.navigateButton}
                    onPress={() =>
                      openExternalNavigation({
                        latitude: activeJobPreview.dropoffLatitude!,
                        longitude: activeJobPreview.dropoffLongitude!,
                        label: activeJobPreview.destination,
                      })
                    }
                    activeOpacity={0.85}
                  >
                    <MCIcon name="navigation-variant" size={14} color="#0f172a" />
                    <Text style={styles.navigateButtonText}>Navigate</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={styles.activeMetrics}>
                <View style={styles.metricChip}>
                  <MCIcon name="clock-outline" size={14} color="#38bdf8" />
                  <Text style={styles.metricChipText}>{activeJobPreview.durationLabel}</Text>
                </View>
                {activeJobPreview.waitingLabel ? (
                  <View style={styles.metricChip}>
                    <MCIcon name="pause-circle" size={14} color="#f97316" />
                    <Text style={styles.metricChipText}>{activeJobPreview.waitingLabel}</Text>
                  </View>
                ) : null}
                <View style={styles.metricChip}>
                  <MCIcon name="cash" size={14} color="#facc15" />
                  <Text style={styles.metricChipText}>{activeJobPreview.fareLabel}</Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.cardContent}>
              <View style={[styles.iconContainer, { backgroundColor: "rgba(56, 189, 248, 0.2)" }]}>
                <MCIcon name="car" size={24} color="#38bdf8" />
              </View>
              <View style={styles.cardInfo}>
                <Text style={styles.cardLabel}>On Going Jobs</Text>
                <Text style={styles.cardValue}>{onGoingJobsCount}</Text>
              </View>
              <MCIcon name="chevron-right" size={20} color="#8d95ad" />
            </View>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 10,
  },
  card: {
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  cardInfo: {
    flex: 1,
  },
  cardLabel: {
    fontSize: 12,
    color: "#8d95ad",
    marginBottom: 3,
  },
  cardValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  activeCard: {
    backgroundColor: "#13151f",
    borderColor: "#2e3345",
  },
  activeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  activeLabel: {
    fontSize: 12,
    color: "#8d95ad",
    letterSpacing: 0.8,
  },
  activeJobId: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fbbf24",
    marginTop: 2,
  },
  activeStatus: {
    fontSize: 12,
    fontWeight: "700",
    color: "#38bdf8",
  },
  activeFareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(250, 204, 21, 0.08)",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  activeFareLabel: {
    fontSize: 11,
    color: "#facc15",
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  activeFareValue: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  activeDetails: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  navigateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#facc15",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginLeft: "auto",
  },
  navigateButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0f172a",
  },
  activeText: {
    flex: 1,
    fontSize: 13,
    color: "#ffffff",
  },
  activeMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  metricChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1f2332",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2e3345",
  },
  metricChipText: {
    fontSize: 11,
    color: "#ffffff",
  },
  attentionCard: {
    backgroundColor: "#2b0f1a",
    borderColor: "#f87171",
    shadowColor: "#f87171",
  },
  attentionIcon: {
    backgroundColor: "rgba(248, 113, 113, 0.35)",
  },
  attentionText: {
    color: "#fecaca",
  },
  attentionValue: {
    color: "#fff",
  },
  attentionSubtext: {
    fontSize: 11,
    color: "#fca5a5",
    marginTop: 2,
  },
  attentionChevon: {
    backgroundColor: "rgba(248, 113, 113, 0.2)",
    borderRadius: 999,
    padding: 4,
  },
  attentionBadge: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#dc2626",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    shadowColor: "#dc2626",
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    shadowOpacity: 0.6,
  },
  attentionBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
});
