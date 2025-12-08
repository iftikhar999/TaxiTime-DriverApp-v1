import React, { useMemo } from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";

interface DashboardHeaderProps {
  driverName?: string;
  companyName?: string;
  driverStatus: "AVAILABLE" | "AWAY" | "BUSY";
  zoneName?: string | null;
  zoneLoading?: boolean;
  zoneError?: string | null;
  onPressStatus: () => void;
  onEndShift: () => void;
  onRetryZone?: () => Promise<void> | void;
  onOpenMenu?: () => void;
  showLogoutButton?: boolean; // New prop to show "Logout" instead of "End"
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  driverName,
  companyName,
  driverStatus,
  zoneName,
  zoneLoading,
  zoneError,
  onPressStatus,
  onEndShift,
  onRetryZone,
  onOpenMenu,
  showLogoutButton = false,
}) => {
  const insets = useSafeAreaInsets();
  const statusMeta = useMemo(() => {
    switch (driverStatus) {
      case "AWAY":
        return { label: "Away", color: "#f97316" };
      case "BUSY":
        return { label: "On a job", color: "#38bdf8" };
      case "AVAILABLE":
      default:
        return { label: "Online", color: "#4ade80" };
    }
  }, [driverStatus]);

  const primaryIdentity = useMemo(() => {
    if (companyName && driverName) {
      return `${companyName} • ${driverName}`;
    }
    return companyName || driverName || "Driver";
  }, [companyName, driverName]);

  const headerPaddingTop = useMemo(() => {
    const inset = insets.top || 0;
    const platformOffset = Platform.OS === "ios" ? 48 : 36;
    return Math.max(inset - platformOffset, 0);
  }, [insets.top]);

  return (
    <View style={[styles.stickyHeader, { paddingTop: headerPaddingTop }]}>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={[styles.iconButton, !onOpenMenu && styles.iconButtonDisabled]}
          onPress={() => onOpenMenu?.()}
          disabled={!onOpenMenu}
          activeOpacity={0.85}
        >
          <MCIcon name="menu" size={18} color="#fff" />
        </TouchableOpacity>
        <View style={styles.topMeta}>
          <Text style={styles.dashboardLabel}>Driver Console</Text>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {primaryIdentity}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onPressStatus}
          activeOpacity={0.85}
        >
          <MCIcon name="account-cog-outline" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      <View style={styles.headerContent}>
        <View style={styles.driverInfo}>
          <View style={styles.avatarCircle}>
            <MCIcon name="account" size={22} color="#f5b400" />
          </View>
          <View style={styles.driverDetails}>
            <TouchableOpacity
              style={styles.statusRow}
              onPress={onPressStatus}
              activeOpacity={0.85}
            >
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: statusMeta.color },
                ]}
              />
              <Text style={[styles.statusText, { color: statusMeta.color }]}>
                {statusMeta.label}
              </Text>
            </TouchableOpacity>
            {zoneName ? (
              <View style={styles.zonePill}>
                <MCIcon
                  name="map-marker-radius"
                  size={10}
                  color={Colors.accent.highlight}
                />
                <Text style={styles.zonePillText} numberOfLines={1}>
                  {zoneName}
                </Text>
              </View>
            ) : zoneLoading ? (
              <View style={styles.zonePillMuted}>
                <MCIcon name="crosshairs" size={10} color="#8d95ad" />
                <Text style={styles.zonePillText} numberOfLines={1}>
                  Detecting zone…
                </Text>
              </View>
            ) : (
              <Text style={styles.companyLabel}>
                {companyName
                  ? `Operating under ${companyName}`
                  : "Zone not detected"}
              </Text>
            )}
            {zoneError ? (
              <TouchableOpacity
                style={styles.zoneRetryPill}
                onPress={() => void onRetryZone?.()}
                disabled={zoneLoading}
                activeOpacity={0.85}
              >
                <MCIcon name="alert-circle" size={10} color={Colors.danger} />
                <Text style={styles.zoneRetryPillText} numberOfLines={1}>
                  {zoneLoading ? "Retrying zone detection…" : zoneError}
                </Text>
                {!zoneLoading ? (
                  <Text style={styles.zoneRetryPillCta}>Retry</Text>
                ) : null}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.endShiftButton, showLogoutButton && styles.logoutButton]}
          onPress={onEndShift}
          activeOpacity={0.85}
        >
          <MCIcon name={showLogoutButton ? "logout" : "power"} size={16} color="#fff" />
          <Text style={styles.endShiftText}>{showLogoutButton ? "Logout" : "End"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  stickyHeader: {
    backgroundColor: "#1a1d29",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2f3f",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
    justifyContent: "center",
    alignItems: "center",
  },
  iconButtonDisabled: {
    opacity: 0.35,
  },
  topMeta: {
    flex: 1,
    marginHorizontal: 10,
  },
  dashboardLabel: {
    color: "#9aa4c1",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  headerTitleText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 1,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(15, 17, 26, 0.75)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(42, 47, 63, 0.8)",
  },
  driverInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2a2f3f",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 8,
  },
  driverDetails: {
    flex: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  zonePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(245, 180, 0, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
    marginTop: 2,
  },
  zonePillMuted: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(141, 149, 173, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
    marginTop: 2,
  },
  zonePillText: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.accent.highlight,
    maxWidth: 130,
  },
  companyLabel: {
    fontSize: 11,
    color: "#8d95ad",
    marginTop: 2,
  },
  zoneRetryPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
    marginTop: 2,
  },
  zoneRetryPillText: {
    fontSize: 10,
    fontWeight: "600",
    color: Colors.danger,
    maxWidth: 100,
  },
  zoneRetryPillCta: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: Colors.danger,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 3,
  },
  endShiftButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#dc2626",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    gap: 4,
  },
  logoutButton: {
    backgroundColor: "#f97316", // Orange color for logout
  },
  endShiftText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
});
