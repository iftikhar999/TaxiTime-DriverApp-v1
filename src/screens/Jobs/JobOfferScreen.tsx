import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Linking,
    Platform,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import JobOfferMap from '../../components/JobOfferMap';
import { formatCurrency } from '../../config/currency';
import { useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { AppStackParamList } from '../../navigation/RootNavigator';
import { RideSummary } from '../../types/rides';
import { emitDriverStatus } from '../../services/driverSocket';

// Default fallback only — the actual countdown comes from the company
// setting (`autoAssignTimeoutSeconds`) and is shipped on the job offer
// payload as `countdownMs`. The owner panel / super admin controls
// it; previously this 10s constant overrode everything regardless.
const COUNTDOWN_MS_FALLBACK = 10_000;
const { width, height } = Dimensions.get('window');
// Map: ~40% of viewport. Was 50% which made everything below feel
// crammed and the action buttons oversized — driver complaint was
// "looks like a baby app". 40% gives the map enough presence while
// leaving room for tighter, more professional info rows.
const MAP_HEIGHT = Math.round(height * 0.4);
const THEME = {
  background: '#0a0e1a',
  surface: '#141b2d',
  mutedSurface: '#1a2332',
  border: '#1e293b',
  text: '#f1f5f9',
  muted: '#94a3b8',
  accent: '#f59e0b',
  info: '#3b82f6',
  danger: '#ef4444',
  success: '#10b981',
  purple: '#8b5cf6',
};

/**
 * Normalise a job's service type into { TAXI | DELIVERY | COURIER }.
 * The backend may send `serviceType` (canonical) or `jobType` (legacy lowercase)
 * — accept both and default to TAXI so existing taxi jobs keep rendering unchanged.
 */
const resolveServiceType = (raw: string | null | undefined): 'TAXI' | 'DELIVERY' | 'COURIER' => {
  const upper = (raw || '').toString().trim().toUpperCase();
  if (upper === 'DELIVERY') return 'DELIVERY';
  if (upper === 'COURIER') return 'COURIER';
  return 'TAXI';
};

const SERVICE_BADGE: Record<'TAXI' | 'DELIVERY' | 'COURIER', { icon: string; color: string; bg: string; label: string }> = {
  TAXI: { icon: 'taxi', color: '#facc15', bg: '#1f2937', label: 'TAXI' },
  DELIVERY: { icon: 'food', color: '#f59e0b', bg: '#1f2937', label: 'DELIVERY' },
  COURIER: { icon: 'package-variant', color: '#06b6d4', bg: '#1f2937', label: 'COURIER' },
};

const makeCoordinate = (
  latitude: number | null | undefined,
  longitude: number | null | undefined
) => {
  if (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude)
  ) {
    return { latitude, longitude };
  }
  return undefined;
};

export interface JobOfferScreenParams {
  job: RideSummary;
}

export type JobOfferScreenProps = NativeStackScreenProps<AppStackParamList, 'JobOffer'>;

const JobOfferScreen: React.FC<JobOfferScreenProps> = ({ navigation, route }) => {
  const { job } = route.params;
  const { acceptJob, rejectJob, recallJob, setIncomingJob, currentJob, status } = useJob();
  const { location } = useLocation();
  // Per-job countdown — read from the offer payload first, fall back to
  // the safety default only when the server didn't send a value.
  const initialCountdownMs = (() => {
    const raw = (job as any)?.countdownMs ?? (job as any)?.offerTimeoutMs;
    const ms = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(ms) && ms >= 1000 ? ms : COUNTDOWN_MS_FALLBACK;
  })();
  const [countdown, setCountdown] = useState(initialCountdownMs);
  const [hasAccepted, setHasAccepted] = useState(false);
  const [hasCalled, setHasCalled] = useState(false);
  const [mapModalVisible, setMapModalVisible] = useState(false);
  const [routeStats, setRouteStats] = useState<{ distanceKm: number | null; durationMin: number | null }>({
    distanceKm: null,
    durationMin: null,
  });

  useEffect(() => {
    if (job) {
      setIncomingJob({
        ...job,
        status: 'INCOMING',
        passenger: job.passenger ? {
          id: job.passenger.id ?? null,
          name: job.passenger.name || 'Unknown',
          phone: job.passenger.phone || ''
        } : {
          id: null,
          name: 'Unknown',
          phone: ''
        }
      });
      setCountdown(initialCountdownMs);
    }
  }, [job, setIncomingJob]);

  // ✅ Navigate back to Home when job is cleared (recalled by dispatcher)
  useEffect(() => {
    if (!currentJob) {
      const timer = setTimeout(() => {
        console.log('🔙 JobOfferScreen: Job cleared, navigating back to Home');
        navigation.navigate('Home');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentJob, navigation]);

  // ✅ FIX: Stop countdown when job is no longer in INCOMING status
  useEffect(() => {
    // If job is not incoming anymore (accepted, rejected, or cleared), stop countdown
    if (status !== 'INCOMING') {
      return;
    }
    
    // Auto-reject only if still in INCOMING status and countdown reached 0
    if (countdown <= 0) {
      console.log('⏱️ Countdown reached 0 - auto-rejecting job (timeout)');
      console.log('🚨 Driver unresponsive - changing status to AWAY');
      
      // Change driver status to AWAY so dispatcher knows they're unresponsive
      // This prevents auto-dispatch from sending more jobs to this driver
      emitDriverStatus('AWAY', location ? {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy ?? undefined,
        heading: location.heading ?? undefined,
        speed: location.speed ?? undefined,
        timestamp: Date.now(),
      } : undefined).then(() => {
        console.log('✅ Driver status changed to AWAY after timeout');
      }).catch((error) => {
        console.error('❌ Failed to change driver status to AWAY:', error);
      });
      
      // Reject the job
      rejectJob('timeout');
      navigation.goBack();
      return;
    }
    
    const interval = setInterval(() => setCountdown((prev) => prev - 1000), 1000);
    return () => clearInterval(interval);
  }, [countdown, status, navigation, rejectJob, location]);

  const formattedCountdown = useMemo(() => `${Math.ceil(countdown / 1000)}s`, [countdown]);
  const pickupCoordinate = useMemo(
    () => makeCoordinate(currentJob?.pickupLatitude ?? null, currentJob?.pickupLongitude ?? null),
    [currentJob?.pickupLatitude, currentJob?.pickupLongitude]
  );
  const dropoffCoordinate = useMemo(
    () => makeCoordinate(currentJob?.dropoffLatitude ?? null, currentJob?.dropoffLongitude ?? null),
    [currentJob?.dropoffLatitude, currentJob?.dropoffLongitude]
  );
  const driverCoordinate = useMemo(
    () => makeCoordinate(location?.latitude ?? null, location?.longitude ?? null),
    [location?.latitude, location?.longitude]
  );
  
  // Debug log coordinates on mount
  useEffect(() => {
    console.log('📍 JobOfferScreen: Coordinates', {
      pickup: pickupCoordinate,
      driver: driverCoordinate,
      hasPickup: !!pickupCoordinate,
      hasDriver: !!driverCoordinate,
    });
  }, [pickupCoordinate, driverCoordinate]);
  const estimatedFareValue =
    typeof currentJob?.estimatedFare === 'number' && Number.isFinite(currentJob.estimatedFare)
      ? Math.max(currentJob.estimatedFare, 0)
      : 0;
  const distanceValue =
    typeof currentJob?.distance === 'number' && Number.isFinite(currentJob.distance)
      ? Math.max(currentJob.distance, 0)
      : 0;
  const estimatedDuration =
    typeof currentJob?.estimatedDuration === 'number' && Number.isFinite(currentJob.estimatedDuration)
      ? Math.max(currentJob.estimatedDuration, 0)
      : null;
  const distanceLabel =
    routeStats.distanceKm !== null ? `${routeStats.distanceKm.toFixed(1)} km` : `${distanceValue.toFixed(1)} km`;
  const etaLabel =
    routeStats.durationMin !== null
      ? `${Math.round(routeStats.durationMin)} min`
      : estimatedDuration
      ? `${Math.round(estimatedDuration)} min`
      : 'N/A';

  const handleReject = useCallback(() => {
    rejectJob('manual');
    navigation.goBack();
  }, [navigation, rejectJob]);

  const handleAccept = useCallback(() => {
    setHasAccepted(true);
    acceptJob();
    // Don't navigate immediately - show navigation options first
  }, [acceptJob]);

  const handleContinueToJob = useCallback(() => {
    navigation.navigate('EnhancedJobTracking');
  }, [navigation]);

  const handleCallRider = useCallback(() => {
    const phoneNumber = currentJob?.passenger?.phone;
    
    if (!phoneNumber || phoneNumber === 'Not available') {
      Alert.alert('No Phone Number', 'Rider phone number is not available.');
      return;
    }

    const phoneUrl = Platform.select({
      ios: `tel:${phoneNumber}`,
      android: `tel:${phoneNumber}`,
      default: `tel:${phoneNumber}`,
    });

    Linking.canOpenURL(phoneUrl)
      .then((supported) => {
        if (supported) {
          setHasCalled(true);
          return Linking.openURL(phoneUrl);
        } else {
          Alert.alert('Cannot Make Call', 'Your device does not support phone calls.');
        }
      })
      .catch((error) => {
        console.error('Error opening phone dialer:', error);
        Alert.alert('Call Failed', 'Unable to open phone dialer.');
      });
  }, [currentJob?.passenger?.phone]);

  const handleRecall = useCallback(() => {
    Alert.alert(
      'Recall Job',
      'Are you sure you want to recall this job? The customer will be notified.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Yes, Recall',
          style: 'destructive',
          onPress: () => {
            recallJob();
            navigation.goBack();
          },
        },
      ]
    );
  }, [recallJob, navigation]);

  if (!currentJob) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={THEME.accent} />
          <Text style={styles.loaderText}>Loading job details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pickupAddress =
    currentJob.pickupAddress && currentJob.pickupAddress.length
      ? currentJob.pickupAddress
      : 'Pickup not provided';
  const dropoffAddress =
    currentJob.dropoffAddress && currentJob.dropoffAddress.length
      ? currentJob.dropoffAddress
      : 'Dropoff not provided';
  const riderName = currentJob.passenger?.name || currentJob.passenger?.id || 'Rider';
  const riderPhone = currentJob.passenger?.phone || 'Not available';
  const vehicleLabel = currentJob.vehicleType || 'Vehicle not assigned';
  const tariffName = currentJob.tariffName || currentJob.tariff?.name || 'Standard Rate';
  const notes = currentJob.notes?.trim();
  const jobCode = currentJob.publicJobId || currentJob.jobId || currentJob.id || 'JOB';
  const displayJobCode =
    jobCode.length > 12 ? `${jobCode.slice(0, 6)}…${jobCode.slice(-4)}` : jobCode;
  const estimatedFareLabel = formatCurrency(estimatedFareValue);
  const serviceType = resolveServiceType((currentJob as any).serviceType || currentJob.jobType);
  const serviceBadge = SERVICE_BADGE[serviceType];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topSpacer} />
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        {/* Map - Large and Prominent */}
        <View style={styles.mapCard}>
          <JobOfferMap
            pickup={pickupCoordinate}
            driver={driverCoordinate}
            style={styles.map}
            height={MAP_HEIGHT}
            showNavigationButtons={hasAccepted}
            onRouteStats={(stats) => setRouteStats(stats)}
          />
        </View>

        {/* 🎯 Service type badge — makes clear whether this is a taxi ride,
            food delivery, or parcel courier so the driver doesn't accept the
            wrong kind of job. */}
        <View style={[styles.serviceBadge, { backgroundColor: serviceBadge.bg, borderColor: serviceBadge.color }]}>
          <MCIcon name={serviceBadge.icon} size={16} color={serviceBadge.color} />
          <Text style={[styles.serviceBadgeText, { color: serviceBadge.color }]}>
            {serviceBadge.label}
          </Text>
        </View>

        {/* Stats Row - show the estimated fare up front so the driver can make
            an informed accept/reject decision instead of accepting blind. */}
        <View style={styles.statsRow}>
          <View style={[styles.stat, styles.statFare]}>
            <MCIcon name="cash-multiple" size={18} color="#10b981" />
            <Text style={[styles.statValue, styles.statValueFare]}>{estimatedFareLabel}</Text>
            <Text style={styles.statLabel}>EST. FARE</Text>
          </View>
          <View style={styles.stat}>
            <MCIcon name="map-marker-distance" size={18} color="#3b82f6" />
            <Text style={styles.statValue}>{distanceLabel}</Text>
            <Text style={styles.statLabel}>DISTANCE</Text>
          </View>
          <View style={styles.stat}>
            <MCIcon name="clock-time-four-outline" size={18} color="#f59e0b" />
            <Text style={styles.statValue}>{etaLabel}</Text>
            <Text style={styles.statLabel}>ETA</Text>
          </View>
        </View>

        {!hasAccepted ? (
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.acceptButton} onPress={handleAccept} activeOpacity={0.9}>
              <View style={styles.buttonContent}>
                <MCIcon name="check-circle" size={22} color="#fff" />
                <Text style={styles.buttonText}>ACCEPT</Text>
              </View>
              <View style={styles.countdownBadge}>
                <Text style={styles.countdownText}>{formattedCountdown}</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectButton} onPress={handleReject} activeOpacity={0.9}>
              <MCIcon name="close-circle" size={22} color="#fff" />
              <Text style={styles.buttonText}>REJECT</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.acceptedContainer}>
            <View style={styles.acceptedBanner}>
              <MCIcon name="check-circle" size={24} color="#22c55e" />
              <Text style={styles.acceptedText}>Ride Accepted!</Text>
            </View>
            <Text style={styles.navHintText}>
              Choose your preferred navigation app or continue in-app
            </Text>
            <TouchableOpacity 
              style={styles.continueButton} 
              onPress={handleContinueToJob} 
              activeOpacity={0.9}
            >
              <MCIcon name="arrow-right-circle" size={20} color="#fff" />
              <Text style={styles.actionText}>Continue In-App</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pickup Location Only */}
        {!hasAccepted && (
          <View style={styles.card}>
            <View style={styles.routeRow}>
              <MCIcon name="account-circle" size={24} color="#22c55e" />
              <View style={styles.routeInfo}>
                <Text style={styles.routeLabel}>CUSTOMER LOCATION</Text>
                <Text style={styles.routeAddress} numberOfLines={2}>{pickupAddress}</Text>
              </View>
            </View>
          </View>
        )}

        {/* Restaurant context — only for FOOD orders. Backend sends
            `merchant` + `order` blocks on the job payload when the job
            is linked to a delivery_orders row. Without this card the
            driver would just see "DELIVERY" and have no idea where to
            pick up or what's being collected. */}
        {(currentJob as any).merchant && (
          <View style={[styles.card, styles.merchantCard]}>
            <View style={styles.merchantHeader}>
              <MCIcon name="silverware-fork-knife" size={22} color="#f97316" />
              <View style={styles.merchantHeaderText}>
                <Text style={styles.merchantName}>{(currentJob as any).merchant.name}</Text>
                <Text style={styles.merchantSubtitle}>
                  {(currentJob as any).merchant.avgPrepTimeMinutes != null
                    ? `${(currentJob as any).merchant.avgPrepTimeMinutes} min prep`
                    : 'Restaurant pickup'}
                  {(currentJob as any).order?.itemCount != null
                    ? ` · ${(currentJob as any).order.itemCount} item${(currentJob as any).order.itemCount === 1 ? '' : 's'}`
                    : ''}
                </Text>
              </View>
              {(currentJob as any).order?.merchantStatus && (
                <View style={styles.merchantStatusPill}>
                  <Text style={styles.merchantStatusText}>{(currentJob as any).order.merchantStatus}</Text>
                </View>
              )}
            </View>
            {Array.isArray((currentJob as any).order?.items) && (currentJob as any).order.items.length > 0 && (
              <View style={styles.itemsList}>
                {(currentJob as any).order.items.slice(0, 5).map((it: any, idx: number) => (
                  <Text key={idx} style={styles.itemLine} numberOfLines={1}>
                    × {it.qty}  {it.name}
                  </Text>
                ))}
                {(currentJob as any).order.items.length > 5 && (
                  <Text style={styles.itemLineMore}>
                    +{(currentJob as any).order.items.length - 5} more…
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {notes ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Instructions</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={mapModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setMapModalVisible(false)}
      >
        <View style={styles.mapModalBackdrop}>
          <View style={styles.mapModalContent}>
            <View style={styles.mapModalHeader}>
              <Text style={styles.mapModalTitle}>Full Navigation View</Text>
              <TouchableOpacity onPress={() => setMapModalVisible(false)}>
                <MCIcon name="close-circle" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            <JobOfferMap
              pickup={pickupCoordinate}
              driver={driverCoordinate}
              height={height * 0.75}
              showNavigationButtons
              showAlternateRoute
              onRouteStats={(stats) => setRouteStats(stats)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  topSpacer: {
    height: 24,
    backgroundColor: THEME.background,
  },
  content: {
    padding: 12,
    paddingBottom: 24,
    gap: 10,
  },
  header: {
    backgroundColor: THEME.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: THEME.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobCode: {
    color: THEME.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  tariffBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: THEME.mutedSurface,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  tariffText: {
    color: THEME.text,
    fontSize: 11,
    fontWeight: '600',
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  loaderText: {
    color: THEME.muted
  },
  mapCard: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.6)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  map: {
    width: '100%'
  },
  serviceBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 4,
  },
  serviceBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 4,
  },
  stat: {
    flex: 1,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.8)',
    alignItems: 'center',
    gap: 2,
  },
  statFare: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  statValue: {
    color: THEME.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  statValueFare: {
    color: '#10b981',
    fontSize: 14,
  },
  statLabel: {
    color: '#64748b',
    fontSize: 8,
    letterSpacing: 0.7,
    textAlign: 'center',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  actionButtons: {
    gap: 8,
  },
  acceptButton: {
    backgroundColor: '#10b981',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.6,
  },
  countdownBadge: {
    backgroundColor: '#ef4444',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1.5,
    borderColor: '#dc2626',
    shadowColor: '#ef4444',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 3,
  },
  countdownText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  rejectButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1.25,
    borderColor: '#ef4444',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  card: {
    backgroundColor: 'rgba(20, 27, 45, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.6)',
    padding: 14,
    gap: 12,
  },
  cardTitle: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 4
  },
  routeContainer: {
    gap: 12,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  routeInfo: {
    flex: 1,
    gap: 4,
  },
  routeLabel: {
    color: THEME.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  routeAddress: {
    color: THEME.text,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19,
  },
  routeDivider: {
    height: 1,
    backgroundColor: THEME.border,
    marginVertical: 4,
  },
  passengerInfo: {
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoText: {
    color: THEME.text,
    fontSize: 14,
    flex: 1,
  },
  passengerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  callButton: {
    flex: 1,
    backgroundColor: THEME.info,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  callText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  recallButton: {
    flex: 1,
    backgroundColor: THEME.danger,
    borderRadius: 10,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  recallText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  routeStop: {
    gap: 4
  },
  // (Duplicate routeLabel/routeAddress keys removed — earlier definitions
  // at the top of this StyleSheet are the canonical ones.)
  sectionTitle: {
    color: THEME.muted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4
  },
  notesText: {
    color: THEME.text,
    fontSize: 14,
    lineHeight: 20
  },
  merchantCard: {
    borderColor: '#f97316',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
  },
  merchantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  merchantHeaderText: { flex: 1 },
  merchantName: { color: THEME.text, fontSize: 15, fontWeight: '700' },
  merchantSubtitle: { color: THEME.muted, fontSize: 12, marginTop: 2 },
  merchantStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(249, 115, 22, 0.18)',
    borderWidth: 1,
    borderColor: '#f97316',
  },
  merchantStatusText: {
    color: '#f97316',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  itemsList: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    gap: 4,
  },
  itemLine: { color: THEME.text, fontSize: 13 },
  itemLineMore: { color: THEME.muted, fontSize: 12, fontStyle: 'italic' },
  acceptedContainer: {
    gap: 12,
    backgroundColor: THEME.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.border
  },
  acceptedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)'
  },
  acceptedText: {
    color: THEME.success,
    fontSize: 16,
    fontWeight: '700'
  },
  navHintText: {
    color: THEME.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4
  },
  continueButton: {
    backgroundColor: THEME.info,
    borderRadius: 26,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 8
  },
  actionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15
  },
  mapModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 16
  },
  mapModalContent: {
    backgroundColor: THEME.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: THEME.border,
    padding: 16,
    gap: 12
  },
  mapModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  mapModalTitle: {
    color: THEME.text,
    fontSize: 16,
    fontWeight: '700'
  }
});

export default JobOfferScreen;
