/**
 * SOSButton
 *
 * Hold-to-trigger panic button for drivers. Placed on HomeScreen and
 * ActiveRideScreen. Two-step activation to avoid pocket-triggered false alarms:
 *
 *   1. User presses and holds for HOLD_DURATION_MS (2s). A circular progress
 *      ring fills up. Release early = abort.
 *   2. On completion a confirmation Alert pops up ("Send alert to dispatch?").
 *      Only then is the actual `emergency:alert` fired.
 *
 * After firing, shows a persistent red banner "Help is on the way" that only
 * dismisses once the dispatcher acknowledges via `emergency:dispatcher:ack`.
 *
 * Wired against the parallel-agent backend:
 *   - Socket event `emergency:alert` on /driver socket (ack: `emergency:ack`)
 *   - HTTP fallback `POST /api/emergency/alert` if ack doesn't land in 5s
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Toast from 'react-native-toast-message';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../context/JobContext';
import { useLocation } from '../context/LocationContext';
import { onDispatcherAck, sendEmergencyAlert } from '../services/emergencyService';
import { Colors } from '../theme/colors';

const HOLD_DURATION_MS = 2000;

type Props = {
  /** When true, the button renders as a compact FAB in the bottom-right of
   *  the parent view. Used on ActiveRideScreen where space is tight. */
  compact?: boolean;
  /** Optional override styling container, e.g. absolute positioning. */
  style?: any;
  /** Optional override for the inner button (size/radius) — used when the
   *  compact FAB sits alongside other header icons and needs to match. */
  buttonStyle?: any;
  /** Icon size override. Defaults to 22 for compact, 28 otherwise. */
  iconSize?: number;
};

export const SOSButton: React.FC<Props> = ({ compact = false, style, buttonStyle, iconSize }) => {
  const { driver } = useAuth();
  const { currentJob } = useJob();
  const { location } = useLocation();

  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [alertActive, setAlertActive] = useState(false); // true after alert sent, cleared on dispatcher ack
  const [confirmVisible, setConfirmVisible] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the "Help is on the way" banner once a dispatcher acknowledges.
  useEffect(() => {
    if (!alertActive) return;
    const off = onDispatcherAck(() => {
      setAlertActive(false);
      Toast.show({
        type: 'success',
        text1: 'Dispatcher is responding',
        text2: 'A dispatcher has acknowledged your alert.',
        visibilityTime: 6000,
      });
    });
    return off;
  }, [alertActive]);

  const fireAlert = useCallback(async () => {
    if (sending) return;
    setSending(true);
    const result = await sendEmergencyAlert({
      userId: driver?.id || 'unknown-driver',
      jobId: currentJob?.id || currentJob?.jobId || null,
      location: location || null,
      message: 'Driver SOS triggered',
    });
    setSending(false);
    if (result.delivered) {
      setAlertActive(true);
      Toast.show({
        type: 'success',
        text1: 'Help is on the way',
        text2:
          result.via === 'socket'
            ? 'Dispatch has been notified (live).'
            : 'Dispatch has been notified.',
        visibilityTime: 6000,
      });
    } else {
      Toast.show({
        type: 'error',
        text1: 'Could not reach dispatch',
        text2:
          'Please call emergency services directly. We will retry in the background.',
        visibilityTime: 8000,
      });
    }
  }, [driver?.id, currentJob?.id, currentJob?.jobId, location, sending]);

  const handlePressIn = useCallback(() => {
    setHolding(true);
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: HOLD_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false, // we animate width — can't use native driver
    }).start();

    holdTimerRef.current = setTimeout(() => {
      setHolding(false);
      // Confirmation before actually emitting — custom themed modal lives
      // below the fragment return.
      setConfirmVisible(true);
    }, HOLD_DURATION_MS);
  }, [progress]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmVisible(false);
    progress.setValue(0);
  }, [progress]);

  const handleConfirmSend = useCallback(async () => {
    setConfirmVisible(false);
    await fireAlert();
  }, [fireAlert]);

  const handlePressOut = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setHolding(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  useEffect(
    () => () => {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    },
    [],
  );

  const widthPct = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <>
      <View style={[compact ? styles.compactWrap : styles.fullWrap, style]} pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.85}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={[styles.button, compact && styles.buttonCompact, sending && styles.buttonDisabled, buttonStyle]}
          accessibilityLabel="Emergency SOS — hold for 2 seconds"
          accessibilityRole="button"
          disabled={sending}>
          <Icon
            name="alert-octagon"
            size={iconSize ?? (compact ? 22 : 28)}
            color="#FFFFFF"
          />
          {!compact && (
            <Text style={styles.buttonText}>
              {sending ? 'Sending…' : holding ? 'Hold to send' : 'SOS — HOLD TO ALERT'}
            </Text>
          )}

          {/* Progress fill */}
          <Animated.View
            pointerEvents="none"
            style={[styles.progressFill, { width: widthPct }]}
          />
        </TouchableOpacity>

        {/* Inline banner only in full (non-compact) mode. Compact mode
             lives in the tight header cluster alongside chat/settings —
             stacking a red shield + text under the 32×32 button explodes
             the layout. The same "help is on the way" state is surfaced
             via the Toast already fired on alert-send + the dispatcher
             ack handler. */}
        {alertActive && !compact && (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Icon name="shield-alert" size={16} color="#FFFFFF" />
            <Text style={styles.bannerText} numberOfLines={2}>
              Help is on the way — waiting for dispatcher acknowledgment.
            </Text>
          </View>
        )}
      </View>

      {/* Themed confirmation sheet — replaces the stock Alert.alert. Dark
          panel with a red accent stripe and the same amber/white typography
          the rest of the driver console uses. */}
      <Modal
        transparent
        visible={confirmVisible}
        animationType="fade"
        onRequestClose={handleConfirmCancel}
        statusBarTranslucent>
        <Pressable style={styles.modalBackdrop} onPress={handleConfirmCancel}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalAccentStripe} />
            <View style={styles.modalIconWrap}>
              <Icon name="alert-octagon" size={32} color="#FFFFFF" />
            </View>
            <Text style={styles.modalTitle}>Send emergency alert?</Text>
            <Text style={styles.modalBody}>
              Dispatch will be notified of your live location and active ride.
              Use this only in a real emergency.
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalCancel]}
                onPress={handleConfirmCancel}
                activeOpacity={0.85}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.modalSend]}
                onPress={handleConfirmSend}
                activeOpacity={0.9}>
                <Icon name="shield-alert" size={16} color="#FFFFFF" />
                <Text style={styles.modalSendText}>Send alert</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  fullWrap: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  compactWrap: {
    alignItems: 'flex-end',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.danger,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 10,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 6,
  },
  buttonCompact: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 24,
    width: 48,
    height: 48,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  banner: {
    marginTop: 10,
    backgroundColor: Colors.danger,
    borderRadius: 10,
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bannerText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  // ── Themed confirmation modal ──────────────────────────────────────────
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 8, 14, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1a1d29',
    borderRadius: 20,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 97, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 14,
    overflow: 'hidden',
  },
  // Thin red stripe along the top edge — signals "this is a danger action"
  // without painting the whole card red (preserves the app's dark theme).
  modalAccentStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: Colors.danger,
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: Colors.danger,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 8,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  modalBody: {
    color: '#aab0c4',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
  },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modalCancel: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  modalCancelText: {
    color: '#d0d4e2',
    fontSize: 14,
    fontWeight: '600',
  },
  modalSend: {
    backgroundColor: Colors.danger,
  },
  modalSendText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});

export default SOSButton;
