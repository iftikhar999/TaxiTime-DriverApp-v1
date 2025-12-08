/**
 * 🛑 JOB PAUSED SCREEN
 * 
 * Shows when driver pauses an active ride.
 * Displays job statistics and resume button.
 * Professional black theme matching ActiveRideScreen.
 */

import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useJob } from '../../context/JobContext';
import { useShift } from '../../context/ShiftContext';
import { getWaitingRatePerMinute } from '../../utils/tariffUtils';
import { openExternalNavigation } from '../../utils/navigationHelper';

const { width } = Dimensions.get('window');

const JobPausedScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { 
    currentJob, 
    timer, 
    pricingBreakdown,
    pauseRecords,
    resumeJob,
    status,
  } = useJob();
  
  const { selectedTariff } = useShift();
  
  // ✅ FIX: Real-time current pause duration with live counter
  const [currentPauseDuration, setCurrentPauseDuration] = useState(0);
  
  useEffect(() => {
    if (!pauseRecords || pauseRecords.length === 0) {
      setCurrentPauseDuration(0);
      return;
    }
    
    const lastPause = pauseRecords.at(-1);
    if (!lastPause?.pausedAt || lastPause.resumedAt) {
      setCurrentPauseDuration(0);
      return;
    }
    
    // Update pause duration every second
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(lastPause.pausedAt).getTime()) / 1000);
      setCurrentPauseDuration(elapsed);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [pauseRecords]);
  
  // Format time
  const formatTime = (seconds: number) => {
    // ✅ FIX: Floor the input to remove floating point precision issues
    const totalSeconds = Math.floor(seconds);
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = Math.floor(totalSeconds % 60);
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const waitingRate = useMemo(
    () => getWaitingRatePerMinute(selectedTariff),
    [selectedTariff]
  );

  const pickCoordinate = (...values: Array<number | null | undefined>) => {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
    return null;
  };

  const dropoffCoordinate = useMemo(() => {
    if (!currentJob) {
      return null;
    }
    const latitude = pickCoordinate(
      currentJob.dropoffLatitude,
      (currentJob as any)?.destination?.latitude
    );
    const longitude = pickCoordinate(
      currentJob.dropoffLongitude,
      (currentJob as any)?.destination?.longitude
    );
    if (latitude === null || longitude === null) {
      return null;
    }
    return { latitude, longitude };
  }, [currentJob]);

  const dropoffLabel = useMemo(() => {
    if (!currentJob) {
      return 'Destination pending';
    }
    return (
      currentJob.dropoffAddress ||
      (currentJob as any)?.destination?.address ||
      'Destination pending'
    );
  }, [currentJob]);

  const coerceMoneyValue = (value: unknown): number => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  // Calculate fare breakdown
  const fareBreakdown = useMemo(() => {
    // Try pricing breakdown first
    if (pricingBreakdown) {
      return {
        base: coerceMoneyValue(pricingBreakdown.startingPrice),
        distance: coerceMoneyValue(pricingBreakdown.distanceCost),
        time: coerceMoneyValue(pricingBreakdown.durationCost),
        waiting: coerceMoneyValue(pricingBreakdown.waitingCost),
        total: coerceMoneyValue(pricingBreakdown.totalCost),
      };
    }
    
    // Fallback: Calculate from timer and tariff
    if (timer && selectedTariff) {
      const base = selectedTariff.baseFare || 0;
      const distance = ((timer.distanceMeters || 0) / 1000) * (selectedTariff.perKmRate || 0);
      const time = ((timer.elapsedSeconds || 0) / 60) * (selectedTariff.perMinuteRate || 0);
      const waiting = ((timer.waitingSeconds || 0) / 60) * waitingRate;
      const total = base + distance + time + waiting;
      
      return { base, distance, time, waiting, total };
    }
    
    return { base: 0, distance: 0, time: 0, waiting: 0, total: 0 };
  }, [pricingBreakdown, timer, waitingRate, selectedTariff]);
  
  const currentFare = Number.isFinite(fareBreakdown.total)
    ? fareBreakdown.total
    : 0;
  const formattedCurrentFare = currentFare.toFixed(2);

  const handleNavigateToDropoff = useCallback(() => {
    openExternalNavigation(
      dropoffCoordinate
        ? {
            latitude: dropoffCoordinate.latitude,
            longitude: dropoffCoordinate.longitude,
            label: dropoffLabel,
          }
        : null
    );
  }, [dropoffCoordinate, dropoffLabel]);
  
  const handleResume = useCallback(async () => {
    try {
      await resumeJob();
      navigation.navigate('ActiveRide');
      Toast.show({
        type: 'success',
        text1: 'Ride Resumed',
        text2: 'Tracking distance and time',
      });
    } catch (error) {
      console.error('Failed to resume job:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Resume',
        text2: 'Please try again',
      });
    }
  }, [resumeJob, navigation]);

  useEffect(() => {
    if (status === 'STARTED' || status === 'ACTIVE') {
      navigation.navigate('ActiveRide');
    }
  }, [status, navigation]);
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Professional Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>TRIP PAUSED</Text>
          <Text style={styles.headerJobId}>#{currentJob?.publicJobId || currentJob?.id || '---'}</Text>
        </View>
        <View style={styles.pauseIconContainer}>
          <Icon name="pause-circle" size={24} color="#ef4444" />
        </View>
      </View>

      {/* Professional Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View style={styles.statusIndicator}>
            <View style={styles.pausedDot} />
            <Text style={styles.statusText}>PAUSED</Text>
          </View>
        </View>
        <View style={styles.statusRight}>
          <Text style={styles.statusPauseDuration}>{formatTime(currentPauseDuration)}</Text>
          <Text style={styles.statusLabel}>PAUSE TIME</Text>
        </View>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Professional Meter Display */}
        <View style={styles.meterSection}>
          <View style={styles.meterDisplay}>
            <View style={styles.meterHeader}>
              <Text style={styles.meterHeaderText}>CURRENT FARE</Text>
              <View style={styles.pauseIndicator}>
                <View style={styles.pauseDot} />
                <Text style={styles.pauseText}>PAUSED</Text>
              </View>
            </View>
            <Text style={styles.meterFare}>${formattedCurrentFare}</Text>
          </View>

          {/* Professional Stats Row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>
                {((timer?.distanceMeters || 0) / 1000).toFixed(2)}
              </Text>
              <Text style={styles.statUnit}>KM</Text>
            </View>
            <View style={[styles.statBox, styles.statBoxBorder]}>
              <Text style={styles.statValue}>
                {formatTime(timer?.elapsedSeconds || 0)}
              </Text>
              <Text style={styles.statUnit}>TIME</Text>
            </View>
            <View style={[styles.statBox, styles.statBoxBorder]}>
              <Text style={styles.statValue}>
                {formatTime(timer?.waitingSeconds || 0)}
              </Text>
              <Text style={styles.statUnit}>WAIT</Text>
            </View>
            <View style={[styles.statBox, styles.statBoxBorder]}>
              <Text style={styles.statValue}>
                {formatTime(currentPauseDuration)}
              </Text>
              <Text style={styles.statUnit}>PAUSE</Text>
            </View>
          </View>
        </View>

        {/* Destination insight */}
        <View style={styles.destinationCard}>
          <View style={styles.destinationHeader}>
            <Text style={styles.destinationTitle}>Destination</Text>
            {dropoffCoordinate ? (
              <TouchableOpacity
                style={styles.destinationNavigate}
                onPress={handleNavigateToDropoff}
                activeOpacity={0.85}
              >
                <Icon name="navigation-variant" size={16} color="#0f172a" />
                <Text style={styles.destinationNavigateText}>Navigate</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={styles.destinationAddress} numberOfLines={2}>
            {dropoffLabel}
          </Text>
          {dropoffCoordinate ? (
            <Text style={styles.destinationCoords}>
              {dropoffCoordinate.latitude.toFixed(5)}, {dropoffCoordinate.longitude.toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.destinationHint}>
              Set a drop-off from the Home screen to unlock navigation shortcuts.
            </Text>
          )}
        </View>

        {/* Fare Breakdown Table */}
        <View style={styles.breakdownSection}>
          <Text style={styles.breakdownHeader}>FARE BREAKDOWN</Text>
          <View style={styles.breakdownTable}>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Base Fare</Text>
              <Text style={styles.breakdownValue}>${fareBreakdown.base.toFixed(2)}</Text>
            </View>
            <View style={[styles.breakdownRow, styles.breakdownRowBorder]}>
              <Text style={styles.breakdownLabel}>
                Distance ({((timer?.distanceMeters || 0) / 1000).toFixed(2)} km)
              </Text>
              <Text style={styles.breakdownValue}>${fareBreakdown.distance.toFixed(2)}</Text>
            </View>
            <View style={[styles.breakdownRow, styles.breakdownRowBorder]}>
              <Text style={styles.breakdownLabel}>
                Time ({formatTime(timer?.elapsedSeconds || 0)})
              </Text>
              <Text style={styles.breakdownValue}>${fareBreakdown.time.toFixed(2)}</Text>
            </View>
            <View style={[styles.breakdownRow, styles.breakdownRowBorder]}>
              <Text style={styles.breakdownLabel}>
                Waiting ({formatTime(timer?.waitingSeconds || 0)})
              </Text>
              <Text style={styles.breakdownValue}>${fareBreakdown.waiting.toFixed(2)}</Text>
            </View>
            <View style={[styles.breakdownRow, styles.breakdownTotal]}>
              <Text style={styles.breakdownLabelTotal}>TOTAL</Text>
              <Text style={styles.breakdownValueTotal}>${fareBreakdown.total.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Trip Info */}
        <View style={styles.tripSection}>
          <Text style={styles.tripHeader}>TRIP INFORMATION</Text>
          <View style={styles.tripInfo}>
            <View style={styles.tripRow}>
              <Icon name="account" size={16} color="#666" />
              <Text style={styles.tripLabel}>Passenger</Text>
              <Text style={styles.tripValue}>
                {currentJob?.passenger?.name || 'N/A'}
              </Text>
            </View>
            {currentJob?.passenger?.phone && (
              <View style={[styles.tripRow, styles.tripRowBorder]}>
                <Icon name="phone" size={16} color="#666" />
                <Text style={styles.tripLabel}>Phone</Text>
                <Text style={styles.tripValue}>{currentJob.passenger.phone}</Text>
              </View>
            )}
            <View style={[styles.tripRow, styles.tripRowBorder]}>
              <Icon name="map-marker" size={16} color="#666" />
              <Text style={styles.tripLabel}>Destination</Text>
              <Text style={styles.tripValue} numberOfLines={2}>
                {currentJob?.dropoffAddress || 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Auto-Resume Info */}
        <View style={styles.infoBox}>
          <Icon name="information-outline" size={20} color="#888" />
          <Text style={styles.infoText}>
            Trip will auto-resume if you start moving
          </Text>
        </View>
      </ScrollView>

      {/* Professional Resume Button */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={styles.resumeButton}
          onPress={handleResume}
          activeOpacity={0.7}
        >
          <Icon name="play" size={20} color="#000" />
          <Text style={styles.resumeText}>RESUME TRIP</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: 40,
  },
  // Professional Header
  header: {
    backgroundColor: '#000000',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  headerJobId: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
    fontFamily: 'Courier New',
  },
  pauseIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Professional Status Bar
  statusBar: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLeft: {
    flex: 1,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pausedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  statusRight: {
    alignItems: 'flex-end',
  },
  statusPauseDuration: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ef4444',
    fontFamily: 'Courier New',
    lineHeight: 16,
  },
  statusLabel: {
    fontSize: 8,
    fontWeight: '600',
    color: '#666',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  // Professional Meter Section
  meterSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  destinationCard: {
    backgroundColor: '#111322',
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2f3f',
    padding: 14,
    gap: 6,
  },
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  destinationTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f5b400',
    letterSpacing: 0.6,
  },
  destinationNavigate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#facc15',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  destinationNavigateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0f172a',
  },
  destinationAddress: {
    fontSize: 14,
    color: '#ffffff',
    fontWeight: '600',
  },
  destinationCoords: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'Courier New',
  },
  destinationHint: {
    fontSize: 12,
    color: '#8d95ad',
  },
  meterDisplay: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  meterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  meterHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
  },
  pauseIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pauseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ef4444',
  },
  pauseText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#ef4444',
    letterSpacing: 0.5,
  },
  meterFare: {
    fontSize: 48,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: 'Courier New',
    letterSpacing: -1,
  },
  // Professional Stats Row
  statsRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statBoxBorder: {
    borderLeftWidth: 1,
    borderLeftColor: '#333',
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'Courier New',
  },
  statUnit: {
    fontSize: 8,
    fontWeight: '600',
    color: '#666',
    marginTop: 4,
    letterSpacing: 1,
  },
  // Fare Breakdown Section
  breakdownSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    marginTop: 0,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  breakdownHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
    padding: 12,
    paddingBottom: 8,
  },
  breakdownTable: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  breakdownRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  breakdownLabel: {
    fontSize: 12,
    color: '#999',
    flex: 1,
  },
  breakdownValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'Courier New',
  },
  breakdownTotal: {
    borderTopWidth: 2,
    borderTopColor: '#fbbf24',
    marginTop: 4,
    paddingTop: 12,
  },
  breakdownLabelTotal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  breakdownValueTotal: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: 'Courier New',
  },
  // Trip Information Section
  tripSection: {
    backgroundColor: '#1a1a1a',
    margin: 10,
    marginTop: 0,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  tripHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
    padding: 12,
    paddingBottom: 8,
  },
  tripInfo: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  tripRowBorder: {
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  tripLabel: {
    fontSize: 11,
    color: '#666',
    width: 80,
  },
  tripValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  // Info Box
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 10,
    marginTop: 0,
    padding: 12,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  infoText: {
    flex: 1,
    fontSize: 11,
    color: '#888',
    lineHeight: 16,
  },
  // Professional Button
  buttonContainer: {
    padding: 10,
    backgroundColor: '#000000',
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  resumeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fbbf24',
    paddingVertical: 16,
    borderRadius: 4,
  },
  resumeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 1,
  },
});

export default JobPausedScreen;
