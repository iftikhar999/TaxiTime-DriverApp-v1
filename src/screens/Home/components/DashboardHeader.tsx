import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { Colors } from "../../../theme/colors";
import SOSButton from "../../../components/SOSButton";
import { useUnreadDispatcher } from "../../../context/UnreadDispatcherContext";

interface DashboardHeaderProps {
  driverName?: string;
  companyName?: string;
  driverStatus: "AVAILABLE" | "AWAY" | "BUSY";
  zoneName?: string | null;
  zoneLoading?: boolean;
  zoneError?: string | null;
  driverRating?: number | null;
  totalRatings?: number;
  vehicleInfo?: string | null;
  onPressStatus: () => void;
  onEndShift: () => void;
  onRetryZone?: () => Promise<void> | void;
  onOpenMenu?: () => void;
  onOpenDispatcherChat?: () => void;
  showLogoutButton?: boolean;
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
  onOpenDispatcherChat,
  showLogoutButton = false,
  driverRating,
  totalRatings = 0,
  vehicleInfo,
}) => {
  const insets = useSafeAreaInsets();
  const { unreadCount, lastArrivalAt } = useUnreadDispatcher();

  // Bounce the dispatcher-chat icon on every new incoming message. Uses
  // a scale+translate pulse (native driver eligible) triggered by a
  // change in lastArrivalAt so the animation re-plays on each message
  // rather than just the first.
  const chatBounce = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!lastArrivalAt) return;
    chatBounce.setValue(0);
    Animated.sequence([
      Animated.timing(chatBounce, { toValue: 1, duration: 140, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(chatBounce, { toValue: 0, duration: 180, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
      Animated.timing(chatBounce, { toValue: 1, duration: 120, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.timing(chatBounce, { toValue: 0, duration: 160, easing: Easing.in(Easing.ease),  useNativeDriver: true }),
    ]).start();
  }, [lastArrivalAt, chatBounce]);
  const chatTranslateY = chatBounce.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  const chatScale = chatBounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

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
          style={[styles.iconButton, styles.menuButton, !onOpenMenu && styles.iconButtonDisabled]}
          onPress={() => onOpenMenu?.()}
          disabled={!onOpenMenu}
          activeOpacity={0.85}
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
        >
          <MCIcon name="menu" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={styles.topMeta}>
          <Text style={styles.dashboardLabel}>Driver Console</Text>
          <Text style={styles.headerTitleText} numberOfLines={1}>
            {primaryIdentity}
          </Text>
        </View>
        {/* 💬 Dispatcher chat — live text channel to company dispatch.
             Sits in the right cluster for one-tap access from home. The
             icon bounces on each incoming message; the red badge shows
             the unread count while the screen isn't open. */}
        {onOpenDispatcherChat ? (
          <Animated.View
            style={{ transform: [{ translateY: chatTranslateY }, { scale: chatScale }] }}
          >
            <TouchableOpacity
              style={[styles.iconButton, styles.chatButton]}
              onPress={onOpenDispatcherChat}
              activeOpacity={0.85}
              accessibilityLabel={
                unreadCount > 0
                  ? `Chat with dispatcher — ${unreadCount} unread`
                  : "Chat with dispatcher"
              }
            >
              <MCIcon name="message-text" size={18} color="#60a5fa" />
              {unreadCount > 0 ? (
                <View style={styles.chatBadge}>
                  <Text style={styles.chatBadgeText}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>
          </Animated.View>
        ) : null}
        {/* 🚨 Emergency SOS — always-reachable hold-to-alert button. */}
        <SOSButton compact iconSize={18} buttonStyle={styles.sosHeaderButton} />
      </View>
      <View style={styles.headerContent}>
        <View style={styles.driverInfo}>
          {/* Avatar now takes the role the cog used to play: tap to change
              status (Online/Away/Busy). Cog removed — fewer right-cluster
              icons, clearer mental model. */}
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={onPressStatus}
            activeOpacity={0.85}
            accessibilityLabel="Change availability"
          >
            <MCIcon name="account" size={22} color="#f5b400" />
          </TouchableOpacity>
          <View style={styles.driverDetails}>
            <View style={styles.statusAndRatingRow}>
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
              {typeof driverRating === "number" && driverRating > 0 ? (
                <View style={styles.ratingBadge}>
                  <MCIcon name="star" size={10} color="#fbbf24" />
                  <Text style={styles.ratingText}>
                    {driverRating.toFixed(1)}
                  </Text>
                  {totalRatings > 0 ? (
                    <Text style={styles.ratingCount}>({totalRatings})</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
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
            {vehicleInfo ? (
              <View style={styles.vehiclePill}>
                <MCIcon name="car" size={10} color="#60a5fa" />
                <Text style={styles.vehiclePillText} numberOfLines={1}>
                  {vehicleInfo}
                </Text>
              </View>
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
  // Shape SOS to match the 32×32 cog pill, with 8px gap from the settings
  // icon so the two read as a unified right cluster (not a stray FAB).
  sosHeaderButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginRight: 8,
  },
  chatButton: {
    marginRight: 8,
    backgroundColor: "rgba(96, 165, 250, 0.14)",
  },
  // Unread badge — small red pill over the top-right of the chat icon.
  chatBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#1a1d29",
  },
  chatBadgeText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 11,
  },
  // Burger/menu button — bigger tap target than the round status button so
  // it's obviously the primary nav affordance.
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
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
  statusAndRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(251, 191, 36, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fbbf24",
  },
  ratingCount: {
    fontSize: 9,
    fontWeight: "500",
    color: "#8d95ad",
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
  vehiclePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(96, 165, 250, 0.15)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 3,
    marginTop: 2,
  },
  vehiclePillText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#60a5fa",
    maxWidth: 160,
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
