import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

const { width, height } = Dimensions.get("window");

interface JobAcceptanceModalProps {
  visible: boolean;
  job: ActiveJob | null;
  onAccept: () => void;
  onReject: () => void;
  autoRejectSeconds?: number;
}

const JobAcceptanceModal: React.FC<JobAcceptanceModalProps> = ({
  visible,
  job,
  onAccept,
  onReject,
  autoRejectSeconds = 30,
}) => {
  const [timeLeft, setTimeLeft] = useState(autoRejectSeconds);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);

  useEffect(() => {
    if (!visible || !job) {
      setTimeLeft(autoRejectSeconds);
      setIsAccepting(false);
      setIsRejecting(false);
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          onReject(); // Auto-reject when time runs out
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, job, onReject, autoRejectSeconds]);

  const handleAccept = async () => {
    if (!job || isAccepting) return;

    try {
      setIsAccepting(true);
      onAccept();
    } catch (error) {
      console.error("Error accepting job:", error);
      Alert.alert("Error", "Failed to accept job. Please try again.");
    } finally {
      setIsAccepting(false);
    }
  };

  const handleReject = () => {
    if (!job || isRejecting) return;

    Alert.alert("Reject Job", "Are you sure you want to reject this job?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reject",
        style: "destructive",
        onPress: async () => {
          try {
            setIsRejecting(true);
            onReject();
          } catch (error) {
            console.error("Error rejecting job:", error);
            Alert.alert("Error", "Failed to reject job. Please try again.");
          } finally {
            setIsRejecting(false);
          }
        },
      },
    ]);
  };

  const formatDistance = (distanceInMeters: number) => {
    const km = (distanceInMeters / 1000).toFixed(1);
    return `${km} km`;
  };

  const formatDuration = (durationInSeconds: number) => {
    const minutes = Math.round(durationInSeconds / 60);
    return `${minutes} min`;
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  if (!visible || !job) {
    return null;
  }

  const jobType = job.jobType || "TAXI";
  const iconName = jobType === "TAXI" ? "car" : jobType === "DELIVERY" ? "package-variant" : "motorbike";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}} // Prevent back button close
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <MCIcon
                name={iconName}
                size={24}
                color="#007AFF"
              />
              <Text style={styles.headerTitle}>New {jobType} Job</Text>
            </View>
            <View style={styles.timer}>
              <Icon
                name="clock"
                size={16}
                color={timeLeft <= 10 ? "#FF3B30" : "#007AFF"}
              />
              <Text
                style={[
                  styles.timerText,
                  { color: timeLeft <= 10 ? "#FF3B30" : "#007AFF" },
                ]}
              >
                {timeLeft}s
              </Text>
            </View>
          </View>

          {/* Customer Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Customer</Text>
            <Text style={styles.customerName}>
              {job.passenger?.name || "Unknown"}
            </Text>
            <Text style={styles.customerPhone}>{job.passenger?.phone || "N/A"}</Text>
          </View>

          {/* Trip Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Trip Details</Text>

            {/* Pickup */}
            <View style={styles.locationRow}>
              <View style={styles.locationIcon}>
                <View style={styles.pickupDot} />
              </View>
              <View style={styles.locationText}>
                <Text style={styles.locationLabel}>Pickup</Text>
                <Text style={styles.locationAddress}>
                  {job.pickupAddress || "Unknown"}
                </Text>
              </View>
            </View>

            {/* Dropoff */}
            <View style={styles.locationRow}>
              <View style={styles.locationIcon}>
                <View style={styles.dropoffDot} />
              </View>
              <View style={styles.locationText}>
                <Text style={styles.locationLabel}>Destination</Text>
                <Text style={styles.locationAddress}>
                  {job.dropoffAddress || "Unknown"}
                </Text>
              </View>
            </View>
          </View>

          {/* Trip Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Icon name="navigation" size={16} color="#666" />
              <Text style={styles.statText}>
                {job.distance ? formatDistance(job.distance) : "N/A"}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Icon name="clock" size={16} color="#666" />
              <Text style={styles.statText}>
                {job.estimatedDuration ? formatDuration(job.estimatedDuration) : "N/A"}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Icon name="dollar-sign" size={16} color="#4CAF50" />
              <Text
                style={[
                  styles.statText,
                  { color: "#4CAF50", fontWeight: "bold" },
                ]}
              >
                {job.estimatedFare ? formatPrice(job.estimatedFare) : "N/A"}
              </Text>
            </View>
          </View>

          {/* Action Buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.rejectButton}
              onPress={handleReject}
              disabled={isRejecting || isAccepting}
            >
              {isRejecting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Icon name="x" size={20} color="#FFF" />
                  <Text style={styles.rejectButtonText}>Reject</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.acceptButton}
              onPress={handleAccept}
              disabled={isAccepting || isRejecting}
            >
              {isAccepting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Icon name="check" size={20} color="#FFF" />
                  <Text style={styles.acceptButtonText}>Accept</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressContainer}>
            <View
              style={[
                styles.progressBar,
                { width: `${(timeLeft / autoRejectSeconds) * 100}%` },
              ]}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "#FFF",
    borderRadius: 12,
    width: width - 40,
    maxHeight: height * 0.8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginLeft: 10,
  },
  timer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0F0F0",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  timerText: {
    marginLeft: 6,
    fontSize: 16,
    fontWeight: "bold",
  },
  section: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5E5",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  customerName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 4,
  },
  customerPhone: {
    fontSize: 16,
    color: "#666",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  locationIcon: {
    width: 20,
    alignItems: "center",
    marginRight: 12,
    marginTop: 2,
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#4CAF50",
  },
  dropoffDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF5722",
  },
  locationText: {
    flex: 1,
  },
  locationLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationAddress: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: "#F8F9FA",
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  statText: {
    marginLeft: 6,
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  actions: {
    flexDirection: "row",
    padding: 20,
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    backgroundColor: "#FF3B30",
    paddingVertical: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  rejectButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: "#4CAF50",
    paddingVertical: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButtonText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
  progressContainer: {
    height: 4,
    backgroundColor: "#E5E5E5",
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    backgroundColor: "#007AFF",
  },
});

export default JobAcceptanceModal;
