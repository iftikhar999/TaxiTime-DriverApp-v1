/**
 * ActiveJobResumeBanner
 *
 * Floating "Return to active job" banner pinned above any non-job-flow screen
 * whenever the driver has an in-progress job. Solves the complaint that the
 * job tracking screen can "disappear" (driver hits back, opens Wallet, etc.)
 * with no obvious way to get back to it.
 *
 * It hides itself on the job-flow screens (ActiveRide / JobOffer / JobPaused /
 * PaymentCollection / RatePassenger) since those ARE the job UI, and hides on
 * Login so it never shows while signed out.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { navigationRef } from '../navigation/navigationRef';
import { useJob } from '../context/JobContext';
import { Colors } from '../theme/colors';

// Statuses that represent an in-progress job the driver should be able to jump
// back into. Mirrors the server-side single-active-job guard.
const ACTIVE_STATUSES = new Set([
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ARRIVED',
  'STARTED',
  'ACTIVE',
  'REACHED',
  'PAUSED',
  'PENDING_PAYMENT',
]);

// Screens that already are part of the job flow — we don't want a duplicate
// "return to job" banner floating over them.
const HIDE_ON_ROUTES = new Set([
  'ActiveRide',
  'JobOffer',
  'JobPaused',
  'PaymentCollection',
  'RatePassenger',
  'EnhancedJobTracking',
  'Login',
  'Register',
]);

const formatStatus = (status: string) => {
  switch (status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      return 'Head to pickup';
    case 'ON_THE_WAY':
      return 'En route to pickup';
    case 'ARRIVED':
      return 'Arrived at pickup';
    case 'STARTED':
    case 'ACTIVE':
      return 'Trip in progress';
    case 'REACHED':
      return 'Arrived at dropoff';
    case 'PAUSED':
      return 'Trip paused';
    case 'PENDING_PAYMENT':
      return 'Awaiting payment';
    default:
      return 'Active job';
  }
};

const ActiveJobResumeBanner: React.FC = () => {
  const { currentJob, status } = useJob();
  // The banner is a SIBLING of the navigator (so it can overlay any
  // screen), not a child of one — that means the React Navigation hooks
  // (`useNavigation`, `useNavigationState`) throw "Couldn't get the
  // navigation state". We subscribe to state changes through the
  // detached navigationRef instead, which works from anywhere.
  const [currentRoute, setCurrentRoute] = useState<string | null>(null);

  useEffect(() => {
    const ref = navigationRef.current;
    if (!ref) return;
    const sync = () => {
      try {
        const route = ref.getCurrentRoute?.();
        setCurrentRoute(route?.name ?? null);
      } catch {
        /* navigator not ready yet — next event will refresh */
      }
    };
    sync();
    const unsub = ref.addListener?.('state', sync);
    return unsub;
  }, []);

  if (!currentJob || !ACTIVE_STATUSES.has(status)) return null;
  if (currentRoute && HIDE_ON_ROUTES.has(currentRoute)) return null;

  const target =
    status === 'PAUSED'
      ? 'JobPaused'
      : status === 'PENDING_PAYMENT'
      ? 'PaymentCollection'
      : 'ActiveRide';

  const handlePress = () => {
    const ref = navigationRef.current;
    if (!ref?.isReady?.()) return;
    try {
      if (target === 'PaymentCollection') {
        (ref.navigate as any)(target, {
          jobId: currentJob.id,
          amount: (currentJob as any)?.estimatedFare ?? 0,
        });
      } else {
        (ref.navigate as any)(target);
      }
    } catch (err) {
      console.warn('[ActiveJobResumeBanner] navigate failed', err);
    }
  };

  const dest =
    (currentJob as any)?.dropoffAddress ||
    (currentJob as any)?.pickupAddress ||
    'Active trip';

  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={handlePress}
        style={styles.banner}>
        <View style={styles.iconWrap}>
          <Icon name="directions-car" size={20} color="#000" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {formatStatus(status)}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {dest}
          </Text>
        </View>
        <Icon name="chevron-right" size={22} color="#000" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    zIndex: 9999,
    elevation: 12,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: (Colors as any)?.primary?.[500] ?? '#FFD166',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: { flex: 1 },
  title: { color: '#000', fontSize: 14, fontWeight: '700' },
  subtitle: { color: '#0d1117', fontSize: 12, opacity: 0.75, marginTop: 2 },
});

export default ActiveJobResumeBanner;
