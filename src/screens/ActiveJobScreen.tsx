import { useNavigation } from "@react-navigation/native";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/Feather";
import { useAuth } from "../context/AuthContext";

interface ActiveJobData {
  jobId: string;
  jobType: "TAXI" | "DELIVERY" | "COURIER";
  status: "ASSIGNED" | "ACCEPTED" | "STARTED" | "IN_PROGRESS" | "COMPLETED";
  pickup: {
    address: string;
    latitude: number;
    longitude: number;
  };
  dropoff: {
    address: string;
    latitude: number;
    longitude: number;
  };
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
  };
  estimatedPrice: number;
  estimatedDistance: number;
  estimatedDuration: number;
  acceptedAt?: string;
  startedAt?: string;
  completedAt?: string;
}

interface ActiveJobScreenProps {
  jobData: ActiveJobData;
  onUpdateStatus: (jobId: string, status: string) => Promise<void>;
  onNavigateToLocation: (
    latitude: number,
    longitude: number,
    address: string
  ) => void;
  onContactCustomer: (phone: string) => void;
  onCompleteJob: (jobId: string) => Promise<void>;
}

const ActiveJobScreen: React.FC<ActiveJobScreenProps> = ({
  jobData,
  onUpdateStatus,
  onNavigateToLocation,
  onContactCustomer,
  onCompleteJob,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<"pickup" | "dropoff">(
    "pickup"
  );
  const { driver } = useAuth();
  const navigation = useNavigation();

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "ASSIGNED":
        return {
          title: "Job Assigned",
          description: "Navigate to pickup location",
          color: "#007AFF",
          icon: "navigation",
          nextAction: "Start Journey",
          nextStatus: "STARTED",
        };
      case "ACCEPTED":
        return {
          title: "Job Accepted",
          description: "Navigate to pickup location",
          color: "#4CAF50",
          icon: "navigation",
          nextAction: "Start Journey",
          nextStatus: "STARTED",
        };
      case "STARTED":
        return {
          title: "En Route to Pickup",
          description: "Heading to customer location",
          color: "#FF9500",
          icon: "navigation",
          nextAction: "Arrived at Pickup",
          nextStatus: "IN_PROGRESS",
        };
      case "IN_PROGRESS":
        return {
          title: "Trip in Progress",
          description: "Customer on board - navigate to destination",
          color: "#FF5722",
          icon: "users",
          nextAction: "Complete Trip",
          nextStatus: "COMPLETED",
        };
      default:
        return {
          title: "Active Job",
          description: "Job in progress",
          color: "#666",
          icon: "activity",
          nextAction: "Update Status",
          nextStatus: "COMPLETED",
        };
    }
  };

  const statusConfig = getStatusConfig(jobData.status);
  const isPickupPhase = ["ASSIGNED", "ACCEPTED", "STARTED"].includes(
    jobData.status
  );
  const targetLocation = isPickupPhase ? jobData.pickup : jobData.dropoff;

  const handleStatusUpdate = async () => {
    if (isUpdating) return;

    try {
      setIsUpdating(true);
      await onUpdateStatus(jobData.jobId, statusConfig.nextStatus);

      if (statusConfig.nextStatus === "COMPLETED") {
        await onCompleteJob(jobData.jobId);
      }
    } catch (error) {
      console.error("Error updating job status:", error);
      Alert.alert("Error", "Failed to update job status. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleNavigate = () => {
    onNavigateToLocation(
      targetLocation.latitude,
      targetLocation.longitude,
      targetLocation.address
    );
  };

  const handleCallCustomer = () => {
    Alert.alert(
      "Contact Customer",
      `Call ${jobData.customer.firstName} ${jobData.customer.lastName}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Call",
          onPress: () => onContactCustomer(jobData.customer.phone),
        },
      ]
    );
  };

  const handleEmergency = () => {
    Alert.alert("Emergency", "Do you need emergency assistance?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Call 911",
        style: "destructive",
        onPress: () => Linking.openURL("tel:911"),
      },
    ]);
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const formatDistance = (distanceInMeters: number) => {
    const km = (distanceInMeters / 1000).toFixed(1);
    return `${km} km`;
  };

  const formatDuration = (durationInSeconds: number) => {
    const minutes = Math.round(durationInSeconds / 60);
    return `${minutes} min`;
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status Header */}
      <View
        style={[styles.statusHeader, { backgroundColor: statusConfig.color }]}
      >
        <View style={styles.statusInfo}>
          <Icon name={statusConfig.icon} size={24} color="#FFF" />
          <View style={styles.statusText}>
            <Text style={styles.statusTitle}>{statusConfig.title}</Text>
            <Text style={styles.statusDescription}>
              {statusConfig.description}
            </Text>
          </View>
        </View>
        <Text style={styles.jobId}>#{jobData.jobId.slice(-8)}</Text>
      </View>

      {/* Customer Information */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Icon name="user" size={20} color="#007AFF" />
          <Text style={styles.sectionTitle}>Customer</Text>
        </View>
        <View style={styles.customerInfo}>
          <View style={styles.customerDetails}>
            <Text style={styles.customerName}>
              {jobData.customer.firstName} {jobData.customer.lastName}
            </Text>
            <Text style={styles.customerPhone}>{jobData.customer.phone}</Text>
          </View>
          <TouchableOpacity
            style={styles.callButton}
            onPress={handleCallCustomer}
          >
            <Icon name="phone" size={20} color="#4CAF50" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Current Target Location */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Icon
            name={isPickupPhase ? "map-pin" : "flag"}
            size={20}
            color={isPickupPhase ? "#4CAF50" : "#FF5722"}
          />
          <Text style={styles.sectionTitle}>
            {isPickupPhase ? "Pickup Location" : "Destination"}
          </Text>
        </View>
        <View style={styles.locationInfo}>
          <Text style={styles.locationAddress}>{targetLocation.address}</Text>
          <TouchableOpacity
            style={styles.navigateButton}
            onPress={handleNavigate}
          >
            <Icon name="navigation" size={16} color="#FFF" />
            <Text style={styles.navigateButtonText}>Navigate</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Trip Details */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Icon name="info" size={20} color="#007AFF" />
          <Text style={styles.sectionTitle}>Trip Details</Text>
        </View>

        <View style={styles.tripDetails}>
          <View style={styles.locationRow}>
            <View style={styles.locationIcon}>
              <View style={styles.pickupDot} />
            </View>
            <View style={styles.locationText}>
              <Text style={styles.locationLabel}>Pickup</Text>
              <Text style={styles.locationAddress}>
                {jobData.pickup.address}
              </Text>
            </View>
          </View>

          <View style={styles.routeLine} />

          <View style={styles.locationRow}>
            <View style={styles.locationIcon}>
              <View style={styles.dropoffDot} />
            </View>
            <View style={styles.locationText}>
              <Text style={styles.locationLabel}>Destination</Text>
              <Text style={styles.locationAddress}>
                {jobData.dropoff.address}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Icon name="navigation" size={16} color="#666" />
            <Text style={styles.statText}>
              {formatDistance(jobData.estimatedDistance)}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Icon name="clock" size={16} color="#666" />
            <Text style={styles.statText}>
              {formatDuration(jobData.estimatedDuration)}
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
              {formatPrice(jobData.estimatedPrice)}
            </Text>
          </View>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.emergencyButton}
          onPress={handleEmergency}
        >
          <Icon name="alert-triangle" size={20} color="#FF3B30" />
          <Text style={styles.emergencyButtonText}>Emergency</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.primaryAction,
            { backgroundColor: statusConfig.color },
          ]}
          onPress={handleStatusUpdate}
          disabled={isUpdating}
        >
          {isUpdating ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Icon
                name={
                  jobData.status === "IN_PROGRESS" ? "check" : "arrow-right"
                }
                size={20}
                color="#FFF"
              />
              <Text style={styles.primaryActionText}>
                {statusConfig.nextAction}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F5",
  },
  content: {
    paddingBottom: 20,
  },
  statusHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    paddingTop: 60,
  },
  statusInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusText: {
    marginLeft: 12,
  },
  statusTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#FFF",
  },
  statusDescription: {
    fontSize: 14,
    color: "rgba(255, 255, 255, 0.8)",
    marginTop: 2,
  },
  jobId: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.8)",
    fontFamily: "monospace",
  },
  section: {
    backgroundColor: "#FFF",
    margin: 16,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginLeft: 8,
  },
  customerInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  customerDetails: {
    flex: 1,
  },
  customerName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  customerPhone: {
    fontSize: 14,
    color: "#666",
    marginTop: 2,
  },
  callButton: {
    backgroundColor: "rgba(76, 175, 80, 0.1)",
    padding: 12,
    borderRadius: 25,
  },
  locationInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  locationAddress: {
    flex: 1,
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
    marginRight: 12,
  },
  navigateButton: {
    backgroundColor: "#007AFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  navigateButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
  },
  tripDetails: {
    marginBottom: 16,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
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
  routeLine: {
    width: 2,
    height: 20,
    backgroundColor: "#E5E5E5",
    marginLeft: 9,
    marginVertical: 4,
  },
  locationText: {
    flex: 1,
    marginBottom: 8,
  },
  locationLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#E5E5E5",
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
    paddingHorizontal: 16,
    gap: 12,
  },
  emergencyButton: {
    flex: 1,
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    borderWidth: 1,
    borderColor: "#FF3B30",
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  emergencyButtonText: {
    color: "#FF3B30",
    fontSize: 14,
    fontWeight: "600",
    marginLeft: 8,
  },
  primaryAction: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryActionText: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "bold",
    marginLeft: 8,
  },
});

export default ActiveJobScreen;
