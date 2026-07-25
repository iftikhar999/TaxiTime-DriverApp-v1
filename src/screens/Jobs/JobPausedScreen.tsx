/**
 * 🛑 JOB PAUSED SCREEN
 * 
 * Shows when driver pauses an active ride.
 * Displays job statistics and resume button.
 * Professional black theme matching ActiveRideScreen.
 */

import { useNavigation } from '@react-navigation/native';
import { formatCurrency, CURRENCY_SYMBOL } from '../../config/currency';
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
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
        {/* Clean Fare Display */}
        <View style={styles.fareSection}>
          <Text style={styles.fareLabel}>CURRENT FARE</Text>
          <Text style={styles.fareAmount}>{CURRENCY_SYMBOL} {formattedCurrentFare}</Text>
          <Text style={styles.fareHint}>Meter paused</Text>
        </View>

        {/* Fare Breakdown */}
        <View style={styles.breakdownSection}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Base Fare</Text>
            <Text style={styles.breakdownValue}>{formatCurrency(fareBreakdown.base)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Distance ({((timer?.distanceMeters || 0) / 1000).toFixed(2)} km)
            </Text>
            <Text style={styles.breakdownValue}>{formatCurrency(fareBreakdown.distance)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Time ({formatTime(timer?.elapsedSeconds || 0)})
            </Text>
            <Text style={styles.breakdownValue}>{formatCurrency(fareBreakdown.time)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Waiting ({formatTime(timer?.waitingSeconds || 0)})
            </Text>
            <Text style={styles.breakdownValue}>{formatCurrency(fareBreakdown.waiting)}</Text>
          </View>
        </View>

        {/* Destination Card */}
        <View style={styles.destinationCard}>
          <View style={styles.destinationHeader}>
            <Icon name="map-marker" size={20} color="#22c55e" />
            <Text style={styles.destinationLabel}>DESTINATION</Text>
          </View>
          <Text style={styles.destinationAddress} numberOfLines={3}>
            {dropoffLabel}
          </Text>
          {dropoffCoordinate && (
            <TouchableOpacity
              style={styles.navigateButton}
              onPress={handleNavigateToDropoff}
              activeOpacity={0.7}
            >
              <Icon name="navigation-variant" size={18} color="#fff" />
              <Text style={styles.navigateText}>Navigate</Text>
            </TouchableOpacity>
          )}
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
  // Fare Breakdown
  breakdownSection: {
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#333',
    gap: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#888',
    flex: 1,
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fbbf24',
    fontFamily: 'Courier New',
  },
  // Destination
  destinationCard: {
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 16,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  destinationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  destinationLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#22c55e',
    letterSpacing: 1.2,
  },
  destinationAddress: {
    fontSize: 15,
    color: '#ffffff',
    fontWeight: '500',
    lineHeight: 22,
    marginBottom: 12,
  },
  navigateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    borderRadius: 8,
  },
  navigateText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  // Clean Fare Section
  fareSection: {
    alignItems: 'center',
    paddingVertical: 24,
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  fareLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  fareAmount: {
    fontSize: 56,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: 'Courier New',
    letterSpacing: -2,
  },
  fareHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
  },
  // Resume Button
  buttonContainer: {
    padding: 16,
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
    borderRadius: 8,
  },
  resumeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 1,
  },
});

export default JobPausedScreen;
