import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";

interface OutOfZoneBannerProps {
  /** Name of the zone that was left */
  zoneName?: string | null;
  /** Callback to dismiss the banner */
  onDismiss?: () => void;
}

/**
 * A pulsing alert banner that shows when the driver leaves their assigned zone.
 * Uses a professional amber/orange colour scheme with a subtle pulse animation
 * to draw attention without being overly intrusive.
 */
export const OutOfZoneBanner: React.FC<OutOfZoneBannerProps> = ({
  zoneName,
  onDismiss,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const iconRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Continuous pulse animation on the banner background
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );

    // Gentle shake on the warning icon
    const shake = Animated.loop(
      Animated.sequence([
        Animated.timing(iconRotate, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(iconRotate, {
          toValue: -1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(iconRotate, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1500),
      ])
    );

    pulse.start();
    shake.start();

    return () => {
      pulse.stop();
      shake.stop();
    };
  }, [pulseAnim, iconRotate]);

  const iconSpin = iconRotate.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ["-12deg", "0deg", "12deg"],
  });

  return (
    <Animated.View style={[styles.container, { opacity: pulseAnim }]}>
      <View style={styles.innerRow}>
        <Animated.View style={{ transform: [{ rotate: iconSpin }] }}>
          <MCIcon name="map-marker-off" size={22} color="#fff" />
        </Animated.View>

        <View style={styles.textBlock}>
          <Text style={styles.title}>You are out of zone</Text>
          <Text style={styles.subtitle}>
            {zoneName
              ? `Return to "${zoneName}" to receive jobs`
              : "Return to your zone to receive jobs"}
          </Text>
        </View>

        {onDismiss && (
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.dismissBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <MCIcon name="close" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#d97706", // amber-600
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#f59e0b", // amber-500
    shadowColor: "#d97706",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  innerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 11,
    color: "rgba(255,255,255,0.85)",
    marginTop: 1,
  },
  dismissBtn: {
    backgroundColor: "rgba(0,0,0,0.2)",
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
});
