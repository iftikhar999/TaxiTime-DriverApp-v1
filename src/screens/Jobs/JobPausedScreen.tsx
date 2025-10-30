/**
 * 🛑 JOB PAUSED SCREEN
 * 
 * Shows when driver pauses an active ride.
 * Displays job statistics and resume button.
 */

import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
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

const JobPausedScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { 
    currentJob, 
    timer, 
    pricingBreakdown,
    pauseRecords,
    resumeJob 
  } = useJob();
  
  const { selectedTariff } = useShift();
  
  // ✅ FIX: Real-time current pause duration with live counter
  const [currentPauseDuration, setCurrentPauseDuration] = useState(0);
  
  useEffect(() => {
    if (!pauseRecords || pauseRecords.length === 0) {
      setCurrentPauseDuration(0);
      return;
    }
    
    const lastPause = pauseRecords[pauseRecords.length - 1];
    if (!lastPause.pausedAt || lastPause.resumedAt) {
      setCurrentPauseDuration(0);
      return;
    }
    
    // Update pause duration every second
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(lastPause.pausedAt).getTime()) / 1000);
      setCurrentPauseDuration(elapsed);
      console.log(`⏸️ Current pause duration: ${elapsed}s`);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [pauseRecords]);
  
  // Format time
  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Calculate fare - use actual job data
  const calculateFare = () => {
    // Try pricing breakdown first
    if (pricingBreakdown?.totalCost) {
      return parseFloat(pricingBreakdown.totalCost);
    }
    
    // Try earningsSoFar from timer (most accurate)
    if (timer?.earningsSoFar) {
      return timer.earningsSoFar;
    }
    
    // Fallback: Calculate from timer and tariff
    if (timer && selectedTariff) {
      const distanceKm = (timer.distanceMeters || 0) / 1000;
      const timeMinutes = (timer.elapsedSeconds || 0) / 60;
      const waitingMinutes = (timer.waitingSeconds || 0) / 60;
      
      // ✅ FIX: Use correct property names from Tariff interface
      const baseFare = selectedTariff.baseFare || 0;
      const distanceFare = distanceKm * (selectedTariff.perKmRate || 0);
      const timeFare = timeMinutes * (selectedTariff.perMinuteRate || 0);
      const waitingFare = waitingMinutes * (selectedTariff.waitingTimeRate || 0);
      
      const totalFare = baseFare + distanceFare + timeFare + waitingFare;
      
      console.log('💰 JobPausedScreen - Fare Calculation:', {
        baseFare,
        distanceKm: distanceKm.toFixed(2),
        distanceFare: distanceFare.toFixed(2),
        timeMinutes: timeMinutes.toFixed(2),
        timeFare: timeFare.toFixed(2),
        waitingMinutes: waitingMinutes.toFixed(2),
        waitingFare: waitingFare.toFixed(2),
        totalFare: totalFare.toFixed(2),
      });
      
      return totalFare;
    }
    
    // Last resort
    return 0;
  };
  
  const currentFare = calculateFare();
  
  // ✅ DEBUG: Log values to console
  useEffect(() => {
    console.log('📊 JobPausedScreen Stats:', {
      currentFare: currentFare.toFixed(2),
      distanceKm: ((timer?.distanceMeters || 0) / 1000).toFixed(2),
      elapsedSeconds: timer?.elapsedSeconds || 0,
      waitingSeconds: timer?.waitingSeconds || 0,
      currentPauseDuration,
      pauseRecordsCount: pauseRecords?.length || 0,
    });
  }, [currentFare, timer, currentPauseDuration, pauseRecords]);
  
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
      Toast.show({
        type: 'error',
        text1: 'Failed to Resume',
        text2: 'Please try again',
      });
    }
  }, [resumeJob, navigation]);
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Icon name="pause-circle" size={64} color="#f59e0b" />
          <Text style={styles.headerTitle}>RIDE PAUSED</Text>
          <Text style={styles.headerSubtitle}>Waiting time is being tracked</Text>
        </View>
        
        {/* ✅ NEW: Auto-Resume Info */}
        <View style={styles.autoResumeInfo}>
          <Icon name="information" size={20} color="#3b82f6" />
          <Text style={styles.autoResumeText}>
            Will auto-resume if you start moving above 5 km/h
          </Text>
        </View>
        
        {/* Stats */}
        <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>CURRENT FARE</Text>
          <Text style={styles.statValue}>${currentFare.toFixed(2)}</Text>
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statSmallCard}>
            <Icon name="map-marker-distance" size={24} color="#10b981" />
            <Text style={styles.statSmallLabel}>Distance</Text>
            <Text style={styles.statSmallValue}>
              {((timer?.distanceMeters || 0) / 1000).toFixed(2)} km
            </Text>
          </View>
          
          <View style={styles.statSmallCard}>
            <Icon name="clock-outline" size={24} color="#3b82f6" />
            <Text style={styles.statSmallLabel}>Duration</Text>
            <Text style={styles.statSmallValue}>
              {formatTime(timer?.elapsedSeconds || 0)}
            </Text>
          </View>
        </View>
        
        <View style={styles.statsRow}>
          <View style={styles.statSmallCard}>
            <Icon name="timer-sand" size={24} color="#f59e0b" />
            <Text style={styles.statSmallLabel}>Waiting</Text>
            <Text style={styles.statSmallValue}>
              {formatTime(timer?.waitingSeconds || 0)}
            </Text>
          </View>
          
          <View style={styles.statSmallCard}>
            <Icon name="pause" size={24} color="#f59e0b" />
            <Text style={styles.statSmallLabel}>Current Pause</Text>
            <Text style={styles.statSmallValue}>
              {formatTime(currentPauseDuration)}
            </Text>
          </View>
        </View>
      </View>
        
        {/* Passenger Info */}
        <View style={styles.passengerCard}>
          <Text style={styles.passengerLabel}>PASSENGER</Text>
          <Text style={styles.passengerName}>
            {currentJob?.passenger?.name || 'Passenger'}
          </Text>
        </View>
        
        {/* Resume Button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.resumeButton}
            onPress={handleResume}
            activeOpacity={0.8}
          >
            <Icon name="play-circle" size={32} color="#fff" />
            <Text style={styles.resumeText}>Resume Ride</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 30,
    gap: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f59e0b',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
  },
  autoResumeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 8,
    padding: 16,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#3b82f6',
  },
  autoResumeText: {
    flex: 1,
    fontSize: 13,
    color: '#94a3b8',
    lineHeight: 18,
  },
  statsContainer: {
    padding: 20,
    gap: 16,
  },
  statCard: {
    backgroundColor: '#1e293b',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#f59e0b',
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 8,
  },
  statValue: {
    fontSize: 48,
    fontWeight: '800',
    color: '#fbbf24',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statSmallCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  statSmallLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  statSmallValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  passengerCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 12,
    padding: 20,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    alignItems: 'center',
  },
  passengerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 8,
  },
  passengerName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  buttonContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  resumeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#22c55e',
    paddingVertical: 20,
    borderRadius: 16,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  resumeText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
});

export default JobPausedScreen;
