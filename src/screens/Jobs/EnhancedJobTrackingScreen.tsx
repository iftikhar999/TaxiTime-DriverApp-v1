import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
    Dimensions,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import RideMap from '../../components/RideMap';
import { JobStatus, useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { useShift } from '../../context/ShiftContext';
import { calculateDistance } from '../../utils/distance';

const { width } = Dimensions.get('window');

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

const formatTime = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
  }
  return `${minutes.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
};

const EnhancedJobTrackingScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { currentJob, status, updateStatus, timer, routePoints, noShowJob, recallJob } = useJob();
  const { selectedTariff } = useShift();
  const { location } = useLocation();

  // Auto-arrive when within 500m of pickup location
  const hasAutoArrived = useRef(false);
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

  useEffect(() => {
    if (
      status === 'ON_THE_WAY' &&
      !hasAutoArrived.current &&
      location?.latitude &&
      location?.longitude &&
      pickupCoordinate
    ) {
      const distanceToPickup = calculateDistance(
        location.latitude,
        location.longitude,
        pickupCoordinate.latitude,
        pickupCoordinate.longitude
      );

      if (distanceToPickup <= 0.5) {
        hasAutoArrived.current = true;
        updateStatus('ARRIVED');
        Toast.show({
          type: 'success',
          text1: 'Arrived at Pickup',
          text2: 'You are now at the pickup location',
        });
      }
    } else if (status !== 'ON_THE_WAY') {
      hasAutoArrived.current = false;
    }
  }, [status, location, pickupCoordinate, updateStatus]);

  // Navigate back if no job (with delay to prevent hooks error)
  useEffect(() => {
    if (!currentJob) {
      const timer = setTimeout(() => {
        navigation.navigate('Home');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentJob, navigation]);

  // ✅ FIX: Navigate to ActiveRideScreen when job is STARTED
  // This screen is ONLY for: ACCEPTED, ON_THE_WAY, ARRIVED
  // Once STARTED, switch to the full tracking screen
  useEffect(() => {
    if (['STARTED', 'ACTIVE', 'REACHED'].includes(status)) {
      console.log('✅ Job started - navigating to ActiveRideScreen');
      const timer = setTimeout(() => {
        navigation.navigate('ActiveRide');
      }, 300); // Small delay to allow state to settle
      return () => clearTimeout(timer);
    }
  }, [status, navigation]);

  // Calculate current fare
  const fareBreakdown = useMemo(() => {
    const base = selectedTariff?.baseFare ?? 0;
    const distanceFare = (selectedTariff?.perKmRate ?? 0) * ((timer?.distanceMeters ?? 0) / 1000);
    const timeFare = (selectedTariff?.perMinuteRate ?? 0) * ((timer?.elapsedSeconds ?? 0) / 60);
    const waitingFare = (selectedTariff?.waitingTimeRate ?? 0) * ((timer?.waitingSeconds ?? 0) / 60);
    const total = base + distanceFare + timeFare + waitingFare;

    return {
      start: base,
      distance: distanceFare,
      time: timeFare,
      waiting: waitingFare,
      liveFare: total,
      totalFare: total,
    };
  }, [
    selectedTariff?.baseFare,
    selectedTariff?.perKmRate,
    selectedTariff?.perMinuteRate,
    selectedTariff?.waitingTimeRate,
    timer?.distanceMeters,
    timer?.elapsedSeconds,
    timer?.waitingSeconds,
  ]);

  const handleProceedToPickup = useCallback(() => {
    updateStatus('ON_THE_WAY');
  }, [updateStatus]);

  const handleArrive = useCallback(() => {
    updateStatus('ARRIVED');
  }, [updateStatus]);

  const handleStartRide = useCallback(() => {
    updateStatus('STARTED');
  }, [updateStatus]);

  const handleComplete = useCallback(() => {
    updateStatus('COMPLETED');
    setTimeout(() => navigation.navigate('Home'), 1500);
  }, [updateStatus, navigation]);

  const handleNoShow = useCallback(() => {
    noShowJob();
    Toast.show({
      type: 'info',
      text1: 'No Show Reported',
      text2: 'Job has been marked as no-show',
    });
    setTimeout(() => navigation.navigate('Home'), 1500);
  }, [noShowJob, navigation]);

  const handleRecall = useCallback(() => {
    recallJob();
    Toast.show({
      type: 'info',
      text1: 'Job Recalled',
      text2: 'Job has been returned to dispatch',
    });
    setTimeout(() => navigation.navigate('Home'), 1500);
  }, [recallJob, navigation]);

  const handleCancel = useCallback(() => {
    updateStatus('CANCELLED');
    Toast.show({
      type: 'warning',
      text1: 'Job Cancelled',
      text2: 'Job has been cancelled',
    });
    setTimeout(() => navigation.navigate('Home'), 1500);
  }, [updateStatus, navigation]);

  // ✅ REMOVED EARLY RETURN - causes "Rendered fewer hooks" error
  // The useEffect above already handles navigation when currentJob is null
  // All hooks must run on every render, so we use optional chaining instead

  const isRideActive = ['STARTED', 'ACTIVE'].includes(status);
  
  // Only show dropoff on map after ride has started
  const showDropoffOnMap = useMemo(
    () => ['STARTED', 'ACTIVE', 'REACHED', 'COMPLETED'].includes(status),
    [status]
  );
  
  // ✅ Use optional chaining for all currentJob accesses
  const riderName = currentJob?.passenger?.name || 'Unknown';
  const riderPhone = currentJob?.passenger?.phone || 'Not available';
  const vehicleLabel = currentJob?.vehicleType || 'Vehicle not assigned';
  const tariffName = selectedTariff?.name || 'Standard';
  const jobReference = currentJob?.publicJobId || currentJob?.id || 'N/A';
  const routeCoordinates = useMemo(
    () => routePoints.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [routePoints]
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Job Tracking</Text>
          <Text style={styles.headerSubtitle}>{jobReference}</Text>
        </View>

        {/* Status Banner */}
        <View style={[styles.statusBanner, getStatusBannerStyle(status)]}>
          <MCIcon name={getStatusIcon(status)} size={24} color="#fff" />
          <Text style={styles.statusBannerText}>{getStatusLabel(status)}</Text>
        </View>

        {/* Tariff Card */}
        <View style={styles.tariffCard}>
          <View style={styles.tariffHeader}>
            <MCIcon name="steering" size={20} color="#fbbf24" />
            <Text style={styles.tariffTitle}>Tariff: {tariffName}</Text>
          </View>
          {selectedTariff && (
            <View style={styles.tariffDetails}>
              <Text style={styles.tariffDetail}>S: ${(selectedTariff.baseFare ?? 0).toFixed(2)}</Text>
              <Text style={styles.tariffDetail}>D: ${(selectedTariff.perKmRate ?? 0).toFixed(2)}/km</Text>
              <Text style={styles.tariffDetail}>T: ${(selectedTariff.perMinuteRate ?? 0).toFixed(2)}/min</Text>
              <Text style={styles.tariffDetail}>W: ${(selectedTariff.waitingTimeRate ?? 0).toFixed(2)}/min</Text>
            </View>
          )}
        </View>

        {/* Total Fare Card - Only show when job is STARTED or later */}
        {isRideActive && (
          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>TOTAL FARE</Text>
            <View style={styles.fareRow}>
              <MCIcon name="cash-multiple" size={40} color="#fbbf24" />
              <Text style={styles.fareAmount}>${(fareBreakdown?.totalFare ?? 0).toFixed(2)}</Text>
            </View>

            {/* Metrics Grid */}
            <View style={styles.metricsGrid}>
            <View style={styles.metricItem}>
              <MCIcon name="clock-outline" size={18} color="#60a5fa" />
              <Text style={styles.metricLabel}>TIME</Text>
              <Text style={styles.metricValue}>{formatTime(timer?.elapsedSeconds ?? 0)}</Text>
            </View>
            <View style={styles.metricItem}>
              <MCIcon name="map-marker-distance" size={18} color="#34d399" />
              <Text style={styles.metricLabel}>TRAVELLED</Text>
              <Text style={styles.metricValue}>{((timer?.distanceMeters ?? 0) / 1000).toFixed(2)} km</Text>
            </View>
            <View style={styles.metricItem}>
              <MCIcon name="cash" size={18} color="#fbbf24" />
              <Text style={styles.metricLabel}>LIVE FARE</Text>
              <Text style={styles.metricValue}>${(fareBreakdown?.liveFare ?? 0).toFixed(2)}</Text>
            </View>
          </View>

          {/* Fare Breakdown Circle */}
          <View style={styles.fareBreakdownContainer}>
            <View style={styles.fareBreakdown}>
              {/* Start */}
              <View style={[styles.fareComponent, styles.fareComponentTop]}>
                <View style={[styles.fareCircle, styles.fareCircleActive]}>
                  <Text style={styles.fareCircleLabel}>START</Text>
                  <Text style={styles.fareCircleValue}>${(fareBreakdown?.start ?? 0).toFixed(2)}</Text>
                </View>
              </View>

              {/* Center indicator */}
              <View style={styles.fareCenterIndicator} />

              {/* Distance */}
              <View style={[styles.fareComponent, styles.fareComponentRight]}>
                <Text style={styles.fareComponentLabel}>DISTANCE</Text>
                <Text style={styles.fareComponentValue}>${(fareBreakdown?.distance ?? 0).toFixed(2)}</Text>
              </View>

              {/* Time */}
              <View style={[styles.fareComponent, styles.fareComponentLeft]}>
                <Text style={styles.fareComponentLabel}>TIME</Text>
                <Text style={styles.fareComponentValue}>${(fareBreakdown?.time ?? 0).toFixed(2)}</Text>
              </View>

              {/* Waiting */}
              <View style={[styles.fareComponent, styles.fareComponentBottom]}>
                <Text style={styles.fareComponentLabel}>WAITING</Text>
                <Text style={styles.fareComponentValue}>
                  ${(fareBreakdown?.waiting ?? 0).toFixed(2)} 
                  {(timer?.waitingSeconds ?? 0) > 0 && ` (${timer?.waitingSeconds ?? 0}s)`}
                </Text>
              </View>
            </View>
          </View>

          {/* Start/Distance/Waiting Summary */}
          <View style={styles.fareSummary}>
            <Text style={styles.fareSummaryText}>
              Start: <Text style={styles.fareSummaryValue}>${(fareBreakdown?.start ?? 0).toFixed(2)}</Text>
            </Text>
            <Text style={styles.fareSummaryText}>
              Distance: <Text style={styles.fareSummaryValue}>${(fareBreakdown?.distance ?? 0).toFixed(2)}</Text>
            </Text>
            <Text style={styles.fareSummaryText}>
              Waiting: <Text style={styles.fareSummaryValue}>${(fareBreakdown?.waiting ?? 0).toFixed(2)}</Text>
              {(timer?.waitingSeconds ?? 0) > 0 && (
                <Text style={styles.fareSummaryWaiting}> ({timer?.waitingSeconds ?? 0}s)</Text>
              )}
            </Text>
          </View>
          </View>
        )}

        {/* Trip Details */}
        <View style={styles.tripCard}>
          <Text style={styles.sectionTitle}>TRIP DETAILS</Text>
          <View style={styles.tripRow}>
            <MCIcon name="map-marker" size={20} color="#22c55e" />
            <View style={styles.tripInfo}>
              <Text style={styles.tripLabel}>PICKUP</Text>
              <Text style={styles.tripValue}>{currentJob?.pickupAddress || 'Not provided'}</Text>
            </View>
          </View>
          <View style={styles.tripRow}>
            <MCIcon name="flag" size={20} color="#f87171" />
            <View style={styles.tripInfo}>
              <Text style={styles.tripLabel}>DROPOFF</Text>
              <Text style={styles.tripValue}>{currentJob?.dropoffAddress || 'Not provided'}</Text>
            </View>
          </View>
          <View style={styles.tripMeta}>
            <View style={styles.tripMetaItem}>
              <MCIcon name="map-marker-distance" size={16} color="#60a5fa" />
              <Text style={styles.tripMetaText}>
                Planned {currentJob?.distance ? currentJob.distance.toFixed(1) : '0.0'} km
              </Text>
            </View>
            <View style={styles.tripMetaItem}>
              <MCIcon name="clock-outline" size={16} color="#38bdf8" />
              <Text style={styles.tripMetaText}>
                ETA {currentJob?.estimatedDuration ? Math.round(currentJob.estimatedDuration) : 'N/A'} min
              </Text>
            </View>
          </View>
        </View>

        {/* Rider Info */}
        <View style={styles.riderCard}>
          <Text style={styles.sectionTitle}>RIDER</Text>
          <View style={styles.riderRow}>
            <MCIcon name="account" size={18} color="#fbbf24" />
            <Text style={styles.riderText}>{riderName}</Text>
          </View>
          <View style={styles.riderRow}>
            <MCIcon name="phone" size={18} color="#34d399" />
            <Text style={styles.riderText}>{riderPhone}</Text>
          </View>
          <View style={styles.riderRow}>
            <MCIcon name="car" size={18} color="#60a5fa" />
            <Text style={styles.riderText}>{vehicleLabel}</Text>
          </View>
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <RideMap
            pickup={pickupCoordinate}
            dropoff={showDropoffOnMap ? dropoffCoordinate : undefined}
            driver={driverCoordinate}
            route={routeCoordinates}
            style={styles.map}
            height={250}
          />
        </View>

        {/* Action Buttons */}
        <View style={styles.actionsContainer}>
          {renderActionButtons(
            status,
            handleProceedToPickup,
            handleArrive,
            handleStartRide,
            handleComplete,
            handleNoShow,
            handleRecall,
            handleCancel
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const getStatusLabel = (status: JobStatus): string => {
  switch (status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      return 'Job Accepted';
    case 'ON_THE_WAY':
      return 'On the Way to Pickup';
    case 'ARRIVED':
      return 'Arrived at Pickup';
    case 'STARTED':
    case 'ACTIVE':
      return 'Ride Started - Safe Travels!';
    case 'REACHED':
      return 'Reached Destination';
    default:
      return 'Job Active';
  }
};

const getStatusIcon = (status: JobStatus): string => {
  switch (status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      return 'check-circle';
    case 'ON_THE_WAY':
      return 'navigation';
    case 'ARRIVED':
      return 'map-marker-check';
    case 'STARTED':
    case 'ACTIVE':
      return 'play-circle';
    case 'REACHED':
      return 'flag-checkered';
    default:
      return 'information';
  }
};

const getStatusBannerStyle = (status: JobStatus) => {
  switch (status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      return styles.statusBannerGreen;
    case 'ON_THE_WAY':
      return styles.statusBannerBlue;
    case 'ARRIVED':
      return styles.statusBannerCyan;
    case 'STARTED':
    case 'ACTIVE':
      return styles.statusBannerOrange;
    case 'REACHED':
      return styles.statusBannerPurple;
    default:
      return styles.statusBannerGray;
  }
};

const renderActionButtons = (
  status: JobStatus,
  onProceedToPickup: () => void,
  onArrive: () => void,
  onStartRide: () => void,
  onComplete: () => void,
  onNoShow: () => void,
  onRecall: () => void,
  onCancel: () => void
) => {
  switch (status) {
    case 'ASSIGNED':
    case 'ACCEPTED':
      return (
        <>
          <TouchableOpacity style={[styles.primaryButton, styles.buttonBlue]} onPress={onProceedToPickup}>
            <MCIcon name="navigation-variant" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Proceed to Pickup</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, styles.buttonGray]} onPress={onRecall}>
            <MCIcon name="arrow-u-left-top" size={18} color="#fff" />
            <Text style={styles.secondaryButtonText}>Recall</Text>
          </TouchableOpacity>
        </>
      );

    case 'ON_THE_WAY':
      return (
        <>
          <TouchableOpacity style={[styles.primaryButton, styles.buttonCyan]} onPress={onArrive}>
            <MCIcon name="map-marker-check" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>I've Arrived</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, styles.buttonGray]} onPress={onRecall}>
            <MCIcon name="arrow-u-left-top" size={18} color="#fff" />
            <Text style={styles.secondaryButtonText}>Recall</Text>
          </TouchableOpacity>
        </>
      );

    case 'ARRIVED':
      return (
        <>
          <TouchableOpacity style={[styles.primaryButton, styles.buttonGreen]} onPress={onStartRide}>
            <MCIcon name="play-circle" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Start Ride</Text>
          </TouchableOpacity>
          <View style={styles.secondaryButtonRow}>
            <TouchableOpacity style={[styles.secondaryButton, styles.buttonOrange, { flex: 1 }]} onPress={onNoShow}>
              <MCIcon name="account-cancel" size={18} color="#fff" />
              <Text style={styles.secondaryButtonText}>No Show</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.secondaryButton, styles.buttonGray, { flex: 1 }]} onPress={onRecall}>
              <MCIcon name="arrow-u-left-top" size={18} color="#fff" />
              <Text style={styles.secondaryButtonText}>Recall</Text>
            </TouchableOpacity>
          </View>
        </>
      );

    case 'STARTED':
    case 'ACTIVE':
    case 'REACHED':
      return (
        <>
          <TouchableOpacity style={[styles.primaryButton, styles.buttonGreen]} onPress={onComplete}>
            <MCIcon name="check-circle" size={20} color="#fff" />
            <Text style={styles.primaryButtonText}>Complete Trip</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.secondaryButton, styles.buttonRed]} onPress={onCancel}>
            <MCIcon name="close-circle" size={18} color="#fff" />
            <Text style={styles.secondaryButtonText}>Cancel Trip</Text>
          </TouchableOpacity>
        </>
      );

    default:
      return null;
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e1a',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  statusBannerGreen: { backgroundColor: '#16a34a' },
  statusBannerBlue: { backgroundColor: '#3b82f6' },
  statusBannerCyan: { backgroundColor: '#06b6d4' },
  statusBannerOrange: { backgroundColor: '#f97316' },
  statusBannerPurple: { backgroundColor: '#a855f7' },
  statusBannerGray: { backgroundColor: '#64748b' },
  statusBannerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  tariffCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  tariffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  tariffTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fbbf24',
  },
  tariffDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  tariffDetail: {
    fontSize: 13,
    color: '#cbd5e1',
  },
  fareCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  fareLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 8,
  },
  fareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  fareAmount: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  metricsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  metricItem: {
    alignItems: 'center',
    gap: 4,
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  fareBreakdownContainer: {
    alignItems: 'center',
    marginVertical: 20,
  },
  fareBreakdown: {
    width: 200,
    height: 200,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fareComponent: {
    position: 'absolute',
    alignItems: 'center',
  },
  fareComponentTop: { top: 0, left: '50%', transform: [{ translateX: -50 }] },
  fareComponentRight: { right: 0, top: '50%', transform: [{ translateY: -20 }] },
  fareComponentBottom: { bottom: 0, left: '50%', transform: [{ translateX: -60 }] },
  fareComponentLeft: { left: 0, top: '50%', transform: [{ translateY: -20 }] },
  fareCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#64748b',
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fareCircleActive: {
    borderColor: '#06b6d4',
    backgroundColor: '#164e63',
  },
  fareCircleLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
  },
  fareCircleValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#06b6d4',
    marginTop: 2,
  },
  fareCenterIndicator: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#06b6d4',
    borderWidth: 3,
    borderColor: '#0f172a',
  },
  fareComponentLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 2,
  },
  fareComponentValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  fareSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  fareSummaryText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  fareSummaryValue: {
    fontWeight: '700',
    color: '#fbbf24',
  },
  fareSummaryWaiting: {
    fontSize: 11,
    color: '#f97316',
  },
  tripCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 12,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  tripInfo: {
    flex: 1,
  },
  tripLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 4,
  },
  tripValue: {
    fontSize: 14,
    color: '#f8fafc',
  },
  tripMeta: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  tripMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tripMetaText: {
    fontSize: 12,
    color: '#cbd5e1',
  },
  riderCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  riderText: {
    fontSize: 14,
    color: '#f8fafc',
  },
  mapContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
  },
  map: {
    borderRadius: 12,
  },
  actionsContainer: {
    gap: 12,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 12,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
  buttonGreen: { backgroundColor: '#16a34a' },
  buttonBlue: { backgroundColor: '#3b82f6' },
  buttonCyan: { backgroundColor: '#06b6d4' },
  buttonOrange: { backgroundColor: '#f97316' },
  buttonGray: { backgroundColor: '#64748b' },
  buttonRed: { backgroundColor: '#dc2626' },
});

export default EnhancedJobTrackingScreen;

