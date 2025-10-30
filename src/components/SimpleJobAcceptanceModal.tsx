import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { ActiveJob } from "../context/JobContext";

const { width } = Dimensions.get("window");

interface JobAcceptanceModalProps {
  visible: boolean;
  job: ActiveJob | null;
  onAccept: () => void;
  onReject: (reason?: "manual" | "timeout") => void;
  autoRejectSeconds?: number;
  isAccepting?: boolean;
  isRejecting?: boolean;
}

const JobAcceptanceModal: React.FC<JobAcceptanceModalProps> = ({
  visible,
  job,
  onAccept,
  onReject,
  autoRejectSeconds = 30,
  isAccepting = false,
  isRejecting = false,
}) => {
  const [timeLeft, setTimeLeft] = useState(autoRejectSeconds);
  const [initialSeconds, setInitialSeconds] = useState(autoRejectSeconds);

  useEffect(() => {
    if (!visible || !job) {
      setTimeLeft(autoRejectSeconds);
      setInitialSeconds(autoRejectSeconds);
      return;
    }

    const expiryTimestamp = (() => {
      if (job.expiresAt) {
        const parsed = new Date(job.expiresAt);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.getTime();
        }
      }

      if (typeof job.countdownMs === "number") {
        return Date.now() + job.countdownMs;
      }

      return Date.now() + autoRejectSeconds * 1000;
    })();

    const totalSeconds = Math.max(
      0,
      Math.round((expiryTimestamp - Date.now()) / 1000)
    );

    setInitialSeconds(totalSeconds || autoRejectSeconds);
    setTimeLeft(totalSeconds);

    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.round((expiryTimestamp - Date.now()) / 1000)
      );
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, job, autoRejectSeconds]);

  const handleAccept = () => {
    if (!job || isAccepting || isRejecting || timeLeft <= 0) return;
    onAccept();
  };

  const handleReject = () => {
    if (!job || isAccepting || isRejecting) return;
    onReject("manual");
  };

  if (!visible || !job) return null;

  const progress = Math.min(
    100,
    Math.max(0, initialSeconds > 0 ? (timeLeft / initialSeconds) * 100 : 0)
  );
  const isOfferExpired = timeLeft <= 0;
  const customerName = job.passenger?.name || "Unknown Customer";
  const customerPhone = job.passenger?.phone || "";
  const pickupAddress = job.pickupAddress || "Unknown pickup location";
  const dropoffAddress = job.dropoffAddress || "Unknown destination";
  const estimatedPrice = job.estimatedFare || job.fare || 0;
  const distance = job.distance || 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleReject}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <MCIcon name="car" size={24} color="#4CAF50" />
              <Text style={styles.title}>New Ride Request</Text>
            </View>
            <View style={styles.timerContainer}>
              <Text style={styles.timerText}>{timeLeft}s</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>

          {/* Customer Info */}
          <View style={styles.section}>
            <View style={styles.customerHeader}>
              <Icon name="user" size={20} color="#666" />
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{customerName}</Text>
                {customerPhone ? (
                  <Text style={styles.customerPhone}>{customerPhone}</Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* Trip Details */}
          <View style={styles.section}>
            <View style={styles.tripDetail}>
              <View style={styles.locationDot} />
              <View style={styles.locationInfo}>
                <Text style={styles.locationLabel}>PICKUP</Text>
                <Text style={styles.locationAddress}>{pickupAddress}</Text>
              </View>
            </View>

            <View style={styles.routeLine} />

            <View style={styles.tripDetail}>
              <View style={[styles.locationDot, styles.destinationDot]} />
              <View style={styles.locationInfo}>
                <Text style={styles.locationLabel}>DESTINATION</Text>
                <Text style={styles.locationAddress}>{dropoffAddress}</Text>
              </View>
            </View>
          </View>

          {/* Trip Metrics */}
          <View style={styles.metricsContainer}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>
                ${estimatedPrice.toFixed(2)}
              </Text>
              <Text style={styles.metricLabel}>Estimated Fare</Text>
            </View>
            <View style={styles.metricSeparator} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{distance.toFixed(1)}km</Text>
              <Text style={styles.metricLabel}>Distance</Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={handleReject}
              disabled={isAccepting || isRejecting || isOfferExpired}
              activeOpacity={0.8}
            >
              {isRejecting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="x" size={20} color="#fff" />
                  <Text style={styles.rejectText}>Decline</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={handleAccept}
              disabled={isAccepting || isRejecting || isOfferExpired}
              activeOpacity={0.8}
            >
              {isAccepting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="check" size={20} color="#fff" />
                  <Text style={styles.acceptText}>Accept</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Auto-reject warning */}
          <Text style={styles.autoRejectWarning}>
            {isOfferExpired
              ? "Offer expired – awaiting dispatch update"
              : `Offer expires in ${timeLeft} seconds`}
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  container: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: width - 40,
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
    marginLeft: 8,
  },
  timerContainer: {
    backgroundColor: "#ff4444",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  timerText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  progressBar: {
    height: 4,
    backgroundColor: "#f0f0f0",
    borderRadius: 2,
    marginBottom: 20,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#ff4444",
    borderRadius: 2,
  },
  section: {
    marginBottom: 20,
  },
  customerHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
    padding: 16,
    borderRadius: 12,
  },
  customerInfo: {
    marginLeft: 12,
    flex: 1,
  },
  customerName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  customerPhone: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  tripDetail: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 8,
  },
  locationDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#4CAF50",
    marginTop: 4,
    marginRight: 16,
  },
  destinationDot: {
    backgroundColor: "#ff4444",
  },
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: "#ddd",
    marginLeft: 5,
    marginVertical: 4,
    marginRight: 16,
  },
  locationInfo: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: 16,
    color: "#333",
    lineHeight: 22,
  },
  metricsContainer: {
    flexDirection: "row",
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  metric: {
    flex: 1,
    alignItems: "center",
  },
  metricSeparator: {
    width: 1,
    backgroundColor: "#ddd",
    marginHorizontal: 16,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#333",
  },
  metricLabel: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  acceptButton: {
    backgroundColor: "#4CAF50",
  },
  rejectButton: {
    backgroundColor: "#ff4444",
  },
  acceptText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  rejectText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  autoRejectWarning: {
    textAlign: "center",
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
  },
});

export default JobAcceptanceModal;
