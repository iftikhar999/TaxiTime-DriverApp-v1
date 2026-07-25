/**
 * ThemedAlert
 *
 * Drop-in replacement for React Native's `Alert.alert` that renders a
 * modal matching the driver console's dark + red-accent aesthetic (same
 * visual language as the SOS confirmation sheet).
 *
 * Usage:
 *   1. Wrap the app in <ThemedAlertProvider> (done in App.tsx).
 *   2. Import `themedAlert` and call it like Alert.alert:
 *        import { themedAlert } from './components/ThemedAlert';
 *        themedAlert('Invalid date', 'Use YYYY-MM-DD.');
 *        themedAlert('Delete?', 'Cannot undo', [
 *          { text: 'Cancel', style: 'cancel' },
 *          { text: 'Delete', style: 'destructive', onPress: doDelete },
 *        ]);
 *
 * Variants (`variant` on the tone):
 *   default  → red accent stripe + red info icon (general alerts/errors)
 *   success  → green accent + check icon
 *   warning  → amber accent + warning icon
 *   destructive → used when any button has style='destructive'; red pulse.
 *
 * The imperative `themedAlert` works by posting to a module-level event
 * emitter that the provider subscribes to. The provider renders the
 * modal. No hooks required at call sites — same DX as Alert.alert.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from '../theme/colors';

export type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

export type AlertVariant = 'default' | 'success' | 'warning' | 'info';

export type AlertPayload = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  variant?: AlertVariant;
};

type Subscriber = (p: AlertPayload) => void;
let subscriber: Subscriber | null = null;

/** Imperative API — same signature as RN's Alert.alert. */
export const themedAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  variant: AlertVariant = 'default',
) => {
  if (subscriber) {
    subscriber({ title, message, buttons, variant });
  } else {
    // Provider not mounted yet (shouldn't happen in practice). Log so the
    // dev notices, but don't crash.
    console.warn('[themedAlert] Provider not mounted; dropping alert:', title);
  }
};

const variantMeta = (variant: AlertVariant, destructive: boolean) => {
  if (destructive) return { color: Colors.danger, icon: 'alert-octagon' };
  switch (variant) {
    case 'success': return { color: '#22c55e', icon: 'check-circle' };
    case 'warning': return { color: '#f59e0b', icon: 'alert' };
    case 'info':    return { color: '#60a5fa', icon: 'information-outline' };
    default:        return { color: Colors.danger, icon: 'alert-octagon' };
  }
};

export const ThemedAlertProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [payload, setPayload] = useState<AlertPayload | null>(null);

  useEffect(() => {
    subscriber = (p) => setPayload(p);
    return () => { subscriber = null; };
  }, []);

  const dismiss = useCallback(() => setPayload(null), []);

  const handlePress = useCallback((btn: AlertButton) => {
    // Close first so any follow-up work (navigation, another alert) isn't
    // stacked underneath this modal.
    setPayload(null);
    setTimeout(() => btn.onPress?.(), 0);
  }, []);

  // If the caller didn't pass buttons, synthesize a single OK so tapping
  // anywhere (or the backdrop) dismisses cleanly.
  const buttons: AlertButton[] = payload?.buttons && payload.buttons.length > 0
    ? payload.buttons
    : [{ text: 'OK', style: 'default' }];

  const hasDestructive = buttons.some((b) => b.style === 'destructive');
  const meta = variantMeta(payload?.variant || 'default', hasDestructive);

  return (
    <>
      {children}
      <Modal
        transparent
        visible={!!payload}
        animationType="fade"
        onRequestClose={dismiss}
        statusBarTranslucent
      >
        <Pressable style={styles.backdrop} onPress={dismiss}>
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={[styles.stripe, { backgroundColor: meta.color }]} />
            <View style={[styles.iconWrap, { backgroundColor: meta.color, shadowColor: meta.color }]}>
              <Icon name={meta.icon as any} size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.title}>{payload?.title || ''}</Text>
            {payload?.message ? (
              <Text style={styles.body}>{payload.message}</Text>
            ) : null}
            <View
              style={[
                styles.actions,
                buttons.length === 1 ? styles.actionsSingle : null,
              ]}
            >
              {buttons.map((b, i) => {
                const isCancel = b.style === 'cancel';
                const isDestructive = b.style === 'destructive';
                return (
                  <TouchableOpacity
                    key={`${b.text}-${i}`}
                    activeOpacity={0.85}
                    onPress={() => handlePress(b)}
                    style={[
                      styles.button,
                      isCancel ? styles.buttonCancel : null,
                      isDestructive
                        ? { backgroundColor: Colors.danger }
                        : !isCancel
                          ? { backgroundColor: meta.color }
                          : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.buttonText,
                        isCancel ? styles.buttonCancelText : null,
                      ]}
                    >
                      {b.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 8, 14, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1a1d29',
    borderRadius: 20,
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 97, 0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 14,
    overflow: 'hidden',
  },
  stripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 6,
  },
  title: {
    color: '#ffffff',
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    color: '#aab0c4',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    alignSelf: 'stretch',
  },
  actionsSingle: {
    justifyContent: 'center',
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonCancel: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonCancelText: {
    color: '#d0d4e2',
    fontWeight: '600',
  },
});

export default themedAlert;
