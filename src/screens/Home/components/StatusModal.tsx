import React from "react";
import {
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

type DriverStatus = "AVAILABLE" | "AWAY" | "BUSY";

interface StatusOption {
  status: DriverStatus;
  label: string;
  icon: string;
  color: string;
  description: string;
}

interface StatusModalProps {
  visible: boolean;
  currentStatus: DriverStatus;
  onSelect: (status: DriverStatus) => void;
  onClose: () => void;
}

const STATUS_OPTIONS: StatusOption[] = [
  {
    status: "AVAILABLE",
    label: "Available",
    icon: "check-circle",
    color: "#4ade80",
    description: "Ready to accept new jobs",
  },
  {
    status: "AWAY",
    label: "Away",
    icon: "timer-sand",
    color: "#f97316",
    description: "On a break, not accepting jobs",
  },
  {
    status: "BUSY",
    label: "Busy",
    icon: "briefcase",
    color: "#38bdf8",
    description: "Currently on a job",
  },
];

export const StatusModal: React.FC<StatusModalProps> = ({
  visible,
  currentStatus,
  onSelect,
  onClose,
}) => {
  const handleSelect = (status: DriverStatus) => {
    onSelect(status);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Change Status</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              activeOpacity={0.85}
            >
              <MCIcon name="close" size={24} color="#8d95ad" />
            </TouchableOpacity>
          </View>

          <View style={styles.optionsContainer}>
            {STATUS_OPTIONS.map((option) => {
              const isSelected = option.status === currentStatus;
              return (
                <TouchableOpacity
                  key={option.status}
                  style={[
                    styles.statusOption,
                    isSelected && styles.statusOptionSelected,
                  ]}
                  onPress={() => handleSelect(option.status)}
                  activeOpacity={0.85}
                >
                  <View
                    style={[
                      styles.statusIconContainer,
                      { backgroundColor: `${option.color}20` },
                    ]}
                  >
                    <MCIcon
                      name={option.icon}
                      size={28}
                      color={option.color}
                    />
                  </View>
                  <View style={styles.statusInfo}>
                    <Text style={styles.statusLabel}>{option.label}</Text>
                    <Text style={styles.statusDescription}>
                      {option.description}
                    </Text>
                  </View>
                  {isSelected && (
                    <MCIcon
                      name="check-circle"
                      size={24}
                      color={Colors.accent.highlight}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
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
  modalContent: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#1a1d29",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
  },
  closeButton: {
    padding: 4,
  },
  optionsContainer: {
    gap: 12,
  },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: "#2a2f3f",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  statusOptionSelected: {
    borderColor: Colors.accent.highlight,
    backgroundColor: "rgba(245, 180, 0, 0.1)",
  },
  statusIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  statusInfo: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  statusDescription: {
    fontSize: 13,
    color: "#8d95ad",
  },
});
