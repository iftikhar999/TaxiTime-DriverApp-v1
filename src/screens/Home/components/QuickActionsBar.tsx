import React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";

interface QuickActionsBarProps {
  onNavigateToHistory?: () => void;
  onCallDispatch?: () => void;
  onMessageDispatch?: () => void;
  onToggleMap?: () => void;
  mapExpanded?: boolean;
  dispatchPhone?: string;
}

// Note: the "dispatch" entry keeps its existing tel: behaviour — dispatchers
// still expect incoming calls as the primary escalation path. The new
// "message" entry sits next to it for text-first contact.
const actions = [
  { key: "history", icon: "clipboard-list", label: "History", color: "#38bdf8" },
  { key: "message", icon: "message-text", label: "Message", color: "#60a5fa" },
  { key: "dispatch", icon: "headset", label: "Dispatch", color: "#a78bfa" },
  { key: "map", icon: "map-outline", label: "Map", color: "#4ade80" },
  { key: "settings", icon: "cog-outline", label: "Settings", color: "#f97316" },
] as const;

export const QuickActionsBar: React.FC<QuickActionsBarProps> = ({
  onNavigateToHistory,
  onCallDispatch,
  onMessageDispatch,
  onToggleMap,
  mapExpanded,
  dispatchPhone,
}) => {
  const handlePress = (key: string) => {
    switch (key) {
      case "history":
        onNavigateToHistory?.();
        break;
      case "message":
        onMessageDispatch?.();
        break;
      case "dispatch":
        if (dispatchPhone) {
          Linking.openURL(`tel:${dispatchPhone}`).catch(() => {});
        }
        onCallDispatch?.();
        break;
      case "map":
        onToggleMap?.();
        break;
      default:
        break;
    }
  };

  return (
    <View style={styles.container}>
      {actions.map((action) => (
        <TouchableOpacity
          key={action.key}
          style={styles.actionButton}
          onPress={() => handlePress(action.key)}
          activeOpacity={0.8}
        >
          <View style={[styles.iconCircle, { backgroundColor: `${action.color}18` }]}>
            <MCIcon
              name={
                action.key === "map" && mapExpanded
                  ? "map-minus"
                  : action.icon
              }
              size={18}
              color={action.color}
            />
          </View>
          <Text style={styles.label}>{action.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  actionButton: {
    alignItems: "center",
    gap: 4,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: "#8d95ad",
  },
});
