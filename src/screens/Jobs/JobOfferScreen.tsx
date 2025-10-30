import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import JobOfferMap from '../../components/JobOfferMap';
import { useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { AppStackParamList } from '../../navigation/RootNavigator';
import { Colors } from '../../theme/colors';
import { RideSummary } from '../../types/rides';

const COUNTDOWN_MS = 30_000;

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
  const [countdown, setCountdown] = useState(COUNTDOWN_MS);
  const [hasAccepted, setHasAccepted] = useState(false);
  const [hasCalled, setHasCalled] = useState(false);

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
      setCountdown(COUNTDOWN_MS);
    }
  }, [job, setIncomingJob]);

  // ✅ FIX: Stop countdown when job is no longer in INCOMING status
  useEffect(() => {
    // If job is not incoming anymore (accepted, rejected, or cleared), stop countdown
    if (status !== 'INCOMING') {
      return;
    }
    
    // Auto-reject only if still in INCOMING status and countdown reached 0
    if (countdown <= 0) {
      console.log('⏱️ Countdown reached 0 - auto-rejecting job (timeout)');
      rejectJob('timeout');
      navigation.goBack();
      return;
    }
    
    const interval = setInterval(() => setCountdown((prev) => prev - 1000), 1000);
    return () => clearInterval(interval);
  }, [countdown, status, navigation, rejectJob]);

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
  const distanceLabel = `${distanceValue.toFixed(1)} km`;
  const etaLabel = estimatedDuration ? `${Math.round(estimatedDuration)} min` : 'N/A';

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
    navigation.navigate('JobProgress');
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
          <ActivityIndicator color={Colors.accent.highlight} />
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
  const notes = currentJob.notes?.trim();

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.headerRow}>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerIcon}>🚕</Text>
            <Text style={styles.headerTitle}>New Ride Request</Text>
          </View>
          <View style={styles.countdownPill}>
            <MCIcon name="timer-sand" size={14} color="#f5b400" />
            <Text style={styles.countdownText}>{formattedCountdown}</Text>
          </View>
        </View>

        <JobOfferMap
          pickup={pickupCoordinate}
          driver={driverCoordinate}
          style={styles.map}
          height={hasAccepted ? 300 : 230}
          showNavigationButtons={hasAccepted}
        />

        {!hasAccepted ? (
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.acceptButton} onPress={handleAccept} activeOpacity={0.9}>
              <MCIcon name="check-circle" size={20} color="#fff" />
              <Text style={styles.actionText}>Accept Ride</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.rejectButton} onPress={handleReject} activeOpacity={0.9}>
              <MCIcon name="close-circle" size={20} color="#fff" />
              <Text style={styles.actionText}>Reject</Text>
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

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Trip Details</Text>
            <Text style={styles.fareHighlight}>{`NZD${estimatedFareValue.toFixed(2)}`}</Text>
          </View>

          <View style={styles.detailRow}>
            <View style={[styles.iconPill, { backgroundColor: 'rgba(34,197,94,0.15)' }]}>
              <MCIcon name="map-marker" size={18} color="#22c55e" />
            </View>
            <View style={styles.detailColumn}>
              <Text style={styles.detailLabel}>Pickup</Text>
              <Text style={styles.detailValue}>{pickupAddress}</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <View style={[styles.iconPill, { backgroundColor: 'rgba(239,68,68,0.15)' }]}>
              <MCIcon name="flag" size={18} color="#ef4444" />
            </View>
            <View style={styles.detailColumn}>
              <Text style={styles.detailLabel}>Dropoff</Text>
              <Text style={styles.detailValue}>{dropoffAddress}</Text>
            </View>
          </View>

          <View style={styles.chipRow}>
            <View style={styles.chip}>
              <MCIcon name="map-marker-distance" size={16} color="#4f88ff" />
              <Text style={styles.chipText}>Distance {distanceLabel}</Text>
            </View>
            <View style={styles.chip}>
              <MCIcon name="clock-outline" size={16} color="#60a5fa" />
              <Text style={styles.chipText}>ETA {etaLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Rider Info</Text>
          <View style={styles.infoRow}>
            <MCIcon name="account" size={20} color="#f5b400" />
            <Text style={styles.infoText}>{riderName}</Text>
          </View>
          <View style={styles.infoRow}>
            <MCIcon name="phone" size={20} color="#32d296" />
            <Text style={styles.infoText}>{riderPhone}</Text>
          </View>
          <View style={styles.infoRow}>
            <MCIcon name="car" size={20} color="#4f88ff" />
            <Text style={styles.infoText}>{vehicleLabel}</Text>
          </View>
          
          {/* Call Rider Button */}
          {riderPhone && riderPhone !== 'Not available' && (
            <TouchableOpacity 
              style={styles.callButton} 
              onPress={handleCallRider}
              activeOpacity={0.8}
            >
              <MCIcon name="phone" size={20} color="#fff" />
              <Text style={styles.callButtonText}>
                {hasCalled ? 'Call Rider Again' : 'Call Rider'}
              </Text>
            </TouchableOpacity>
          )}
          
          {/* Recall Button (shows after calling or accepting) */}
          {(hasCalled || hasAccepted) && (
            <TouchableOpacity 
              style={styles.recallButton} 
              onPress={handleRecall}
              activeOpacity={0.8}
            >
              <MCIcon name="arrow-u-left-top" size={20} color="#fff" />
              <Text style={styles.recallButtonText}>Recall Job</Text>
            </TouchableOpacity>
          )}
        </View>

        {notes ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Instructions</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.base
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 18
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  loaderText: {
    color: '#8d95ad'
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 180
  },
  headerIcon: {
    fontSize: 24,
    lineHeight: 28
  },
  headerTitle: {
    color: Colors.text.inverse,
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 24,
    flexShrink: 1
  },
  countdownPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,180,0,0.15)',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 50
  },
  countdownText: {
    color: '#f5b400',
    fontWeight: '700',
    fontSize: 13
  },
  map: {
    width: '100%'
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#22c55e',
    borderRadius: 26,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#f97316',
    borderRadius: 26,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10
  },
  actionText: {
    color: '#fff',
    fontWeight: '700'
  },
  card: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    padding: 18,
    gap: 14
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  cardTitle: {
    color: Colors.text.inverse,
    fontWeight: '700',
    fontSize: 16
  },
  fareHighlight: {
    color: '#f5b400',
    fontWeight: '700',
    fontSize: 16
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  iconPill: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  detailColumn: {
    flex: 1,
    gap: 4
  },
  detailLabel: {
    color: '#8d95ad',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  detailValue: {
    color: Colors.text.inverse,
    fontSize: 14,
    lineHeight: 20
  },
  chipRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4
  },
  chip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(79,136,255,0.1)',
    borderRadius: 14,
    paddingVertical: 10
  },
  chipText: {
    color: '#dfe3f3',
    fontSize: 13,
    fontWeight: '600'
  },
  sectionTitle: {
    color: '#8d95ad',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  infoText: {
    color: Colors.text.inverse,
    fontSize: 15,
    flex: 1
  },
  notesText: {
    color: '#dfe3f3',
    fontSize: 14,
    lineHeight: 20
  },
  acceptedContainer: {
    gap: 12
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
    color: '#22c55e',
    fontSize: 16,
    fontWeight: '700'
  },
  navHintText: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4
  },
  continueButton: {
    backgroundColor: '#3b82f6',
    borderRadius: 26,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 8
  },
  callButton: {
    backgroundColor: '#22c55e',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4
  },
  callButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15
  },
  recallButton: {
    backgroundColor: '#f97316',
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4
  },
  recallButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15
  }
});

export default JobOfferScreen;
