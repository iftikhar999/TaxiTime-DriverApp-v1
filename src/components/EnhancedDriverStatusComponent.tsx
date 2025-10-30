import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useEnhancedDriverStatus } from "../hooks/useEnhancedDriverStatus";
import {
  EnhancedDriverStatus,
  JobProgressStatus,
} from "../types/enhancedDriverStatus";

interface EnhancedDriverStatusComponentProps {
  driverId: string;
  companyId: string;
  token: string;
}

/**
 * Enhanced Driver Status Component
 * Real-time status management with automatic transitions
 */
export const EnhancedDriverStatusComponent: React.FC<
  EnhancedDriverStatusComponentProps
> = ({ driverId, companyId, token }) => {
  const {
    driverState,
    currentStatus,
    isConnected,
    isInitialized,
    updateStatus,
    startShift,
    endShift,
    updateJobProgress,
    queuePosition,
    jobMetrics,
  } = useEnhancedDriverStatus({
    driverId,
    companyId,
    token,
    autoStart: true,
  });

  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(false);

  /**
   * Handle manual status change
   */
  const handleStatusChange = async (newStatus: EnhancedDriverStatus) => {
    if (isChangingStatus) return;

    setIsChangingStatus(true);

    try {
      const success = await updateStatus(newStatus, "manual");

      if (success) {
        Alert.alert("Status Updated", `Successfully changed to ${newStatus}`);
      } else {
        Alert.alert("Error", "Failed to update status. Please try again.");
      }
    } catch (error) {
      console.error("Status change error:", error);
      Alert.alert("Error", "An unexpected error occurred");
    } finally {
      setIsChangingStatus(false);
    }
  };

  /**
   * Handle shift management
   */
  const handleShiftToggle = async () => {
    try {
      if (currentStatus === "OFFLINE") {
        // Start shift
        const success = await startShift("auto-shift-id", "vehicle-1");
        if (success) {
          setLocationEnabled(true);
          Alert.alert("Shift Started", "You are now online and available");
        }
      } else {
        // End shift
        const success = await endShift();
        if (success) {
          setLocationEnabled(false);
          Alert.alert("Shift Ended", "You are now offline");
        }
      }
    } catch (error) {
      console.error("Shift toggle error:", error);
      Alert.alert("Error", "Failed to toggle shift status");
    }
  };

  /**
   * Handle job progress updates (example for testing)
   */
  const simulateJobProgress = async () => {
    if (!driverState?.activeJob) {
      Alert.alert("No Active Job", "No job is currently assigned");
      return;
    }

    const currentProgress = driverState.activeJob.status;
    let nextStatus: JobProgressStatus;

    switch (currentProgress) {
      case "INCOMING":
        nextStatus = "ASSIGNED";
        break;
      case "ASSIGNED":
      case "ACCEPTED":
        nextStatus = "ON_THE_WAY";
        break;
      case "ON_THE_WAY":
        nextStatus = "ARRIVED";
        break;
      case "ARRIVED":
        nextStatus = "STARTED";
        break;
      case "STARTED":
        nextStatus = "COMPLETED";
        break;
      default:
        Alert.alert("Job Complete", "Job is already completed or cancelled");
        return;
    }

    const success = await updateJobProgress(
      driverState.activeJob.jobId,
      nextStatus,
      {
        totalCost: (driverState.activeJob.metrics?.totalCost || 0) + 5.0,
        distance: (driverState.activeJob.metrics?.distance || 0) + 1.5,
      }
    );

    if (success) {
      Alert.alert("Job Updated", `Job status changed to ${nextStatus}`);
    }
  };

  /**
   * Get status color - Following proper color scheme
   * Available = Green, Busy = Red, Away = Orange, Offline = Grey
   */
  const getStatusColor = (status: EnhancedDriverStatus | null): string => {
    switch (status) {
      case "AVAILABLE":
        return "#4CAF50"; // Green - Ready for jobs
      case "ROGER":
        return "#FF9800"; // Orange - Transitioning (job accepted)
      case "BUSY":
        return "#F44336"; // Red - On trip/busy
      case "AWAY":
        return "#FF9800"; // Orange - Temporarily unavailable
      case "OFFLINE":
        return "#9E9E9E"; // Grey - Not on shift
      default:
        return "#BDBDBD"; // Light grey for unknown status
    }
  };

  /**
   * Get status display text
   */
  const getStatusText = (status: EnhancedDriverStatus | null): string => {
    switch (status) {
      case "AVAILABLE":
        return "Available";
      case "ROGER":
        return "Accepting Job";
      case "BUSY":
        return "On Trip";
      case "AWAY":
        return "Away";
      case "OFFLINE":
        return "Offline";
      default:
        return "Unknown";
    }
  };

  if (!isInitialized) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Initializing Status System...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enhanced Driver Status</Text>
        <View
          style={[
            styles.connectionIndicator,
            {
              backgroundColor: isConnected ? "#4CAF50" : "#F44336",
            },
          ]}
        >
          <Text style={styles.connectionText}>
            {isConnected ? "Connected" : "Disconnected"}
          </Text>
        </View>
      </View>

      {/* Current Status Display */}
      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusCircle,
            {
              backgroundColor: getStatusColor(currentStatus),
            },
          ]}
        >
          <Text style={styles.statusText}>{getStatusText(currentStatus)}</Text>
        </View>

        {queuePosition !== null && (
          <Text style={styles.queueText}>Queue Position: {queuePosition}</Text>
        )}
      </View>

      {/* Status Controls */}
      <View style={styles.controlsContainer}>
        <Text style={styles.sectionTitle}>Status Controls</Text>

        {/* Shift Toggle */}
        <View style={styles.shiftControl}>
          <Text style={styles.controlLabel}>Shift Status</Text>
          <TouchableOpacity
            style={[
              styles.shiftButton,
              {
                backgroundColor:
                  currentStatus === "OFFLINE" ? "#4CAF50" : "#F44336",
              },
            ]}
            onPress={handleShiftToggle}
            disabled={isChangingStatus}
          >
            <Text style={styles.shiftButtonText}>
              {currentStatus === "OFFLINE" ? "Start Shift" : "End Shift"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Manual Status Buttons */}
        {currentStatus !== "OFFLINE" && (
          <View style={styles.statusButtons}>
            <TouchableOpacity
              style={[styles.statusButton, { backgroundColor: "#4CAF50" }]}
              onPress={() => handleStatusChange("AVAILABLE")}
              disabled={isChangingStatus || currentStatus === "AVAILABLE"}
            >
              <Text style={styles.buttonText}>Available</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.statusButton, { backgroundColor: "#9E9E9E" }]}
              onPress={() => handleStatusChange("AWAY")}
              disabled={isChangingStatus || currentStatus === "AWAY"}
            >
              <Text style={styles.buttonText}>Away</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Active Job Information */}
      {driverState?.activeJob && (
        <View style={styles.jobContainer}>
          <Text style={styles.sectionTitle}>Active Job</Text>
          <View style={styles.jobDetails}>
            <Text style={styles.jobText}>
              Job ID: {driverState.activeJob.jobId}
            </Text>
            <Text style={styles.jobText}>
              Status: {driverState.activeJob.status}
            </Text>
            {jobMetrics && (
              <>
                <Text style={styles.jobText}>
                  Distance: {jobMetrics.distance?.toFixed(1)} km
                </Text>
                <Text style={styles.jobText}>
                  Earnings: ${jobMetrics.totalCost?.toFixed(2)}
                </Text>
              </>
            )}

            <TouchableOpacity
              style={styles.jobProgressButton}
              onPress={simulateJobProgress}
            >
              <Text style={styles.buttonText}>Update Job Progress</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Debug Information */}
      {__DEV__ && (
        <View style={styles.debugContainer}>
          <Text style={styles.debugTitle}>Debug Info</Text>
          <Text style={styles.debugText}>Driver ID: {driverId}</Text>
          <Text style={styles.debugText}>Company ID: {companyId}</Text>
          <Text style={styles.debugText}>
            Last Update: {driverState?.lastUpdate || "Never"}
          </Text>
          {driverState?.location && (
            <Text style={styles.debugText}>
              Location: {driverState.location.latitude.toFixed(4)},{" "}
              {driverState.location.longitude.toFixed(4)}
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: "#666",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#333",
  },
  connectionIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  connectionText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  statusContainer: {
    alignItems: "center",
    marginBottom: 32,
  },
  statusCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  statusText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  queueText: {
    fontSize: 16,
    color: "#666",
  },
  controlsContainer: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    color: "#333",
  },
  shiftControl: {
    marginBottom: 16,
  },
  controlLabel: {
    fontSize: 16,
    marginBottom: 8,
    color: "#666",
  },
  shiftButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  shiftButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  statusButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  statusButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: {
    color: "white",
    fontSize: 14,
    fontWeight: "600",
  },
  jobContainer: {
    backgroundColor: "white",
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  jobDetails: {
    gap: 8,
  },
  jobText: {
    fontSize: 14,
    color: "#666",
  },
  jobProgressButton: {
    backgroundColor: "#2196F3",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 8,
  },
  debugContainer: {
    backgroundColor: "#000",
    padding: 12,
    borderRadius: 8,
  },
  debugTitle: {
    color: "#0f0",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
  },
  debugText: {
    color: "#0f0",
    fontSize: 12,
    fontFamily: "monospace",
  },
});
