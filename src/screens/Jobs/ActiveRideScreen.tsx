/**
 * 🚕 ACTIVE RIDE SCREEN - ROBUST JOB TRACKING
 * 
 * Professional taxi meter screen for tracking active rides.
 * 
 * Features:
 * - Large, real-time fare meter
 * - Live distance, time, speed tracking
 * - 3D map with driver position
 * - Pause/Resume functionality
 * - Professional driver-focused UI
 * - Real-time pricing breakdown
 */

import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RideMap from '../../components/RideMap';
import { useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { useShift } from '../../context/ShiftContext';

const { width, height } = Dimensions.get('window');

interface ActiveRideScreenProps {}

const ActiveRideScreen: React.FC<ActiveRideScreenProps> = () => {
  const navigation = useNavigation<any>();
  const { 
    currentJob, 
    status, 
    timer, 
    routePoints,
    pricingBreakdown,
    pauseJob,
    resumeJob,
    prepareJobForPayment, // ✅ Use prepare instead of complete
    changeTariff, // ✅ NEW: For changing tariff mid-ride
  } = useJob();
  
  const { location } = useLocation();
  const { selectedTariff, tariffs: driverTariffs } = useShift(); // ✅ FIX: Use 'tariffs' from ShiftContext
  
  // Animation for pulsing meter
  const pulseAnim = useRef(new Animated.Value(1)).current;
  
  // Speed calculation
  const [currentSpeed, setCurrentSpeed] = useState(0);
  
  // ✅ NEW: Movement detection status for real-time debugging
  const [movementStatus, setMovementStatus] = useState<{
    isMoving: boolean;
    speed: number;
    method: string;
    distanceMoved: number;
    lastUpdate: number;
  }>({
    isMoving: false,
    speed: 0,
    method: 'unknown',
    distanceMoved: 0,
    lastUpdate: Date.now(),
  });
  
  // ✅ NEW: Local waiting time counter (for real-time display and debugging)
  const [localWaitingSeconds, setLocalWaitingSeconds] = useState(0);
  const waitingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // ✅ NEW: Tariff change modal
  const [showTariffModal, setShowTariffModal] = useState(false);
  
  // 🔍 DEBUG: Log tariffs when modal opens
  useEffect(() => {
    if (showTariffModal) {
      console.log('🔍 Tariff Modal Opened - Available Tariffs:', {
        count: driverTariffs?.length || 0,
        tariffs: driverTariffs?.map(t => ({
          id: t.id,
          name: t.name,
          baseFare: t.baseFare,
          perKm: t.perKmRate,
          perMin: t.perMinuteRate,
        })),
        selectedTariff: selectedTariff?.name,
      });
    }
  }, [showTariffModal, driverTariffs, selectedTariff]);
  
  useEffect(() => {
    // Pulse animation for live fare
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.05,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);
  
  useEffect(() => {
    if (location?.speedKmh) {
      setCurrentSpeed(location.speedKmh);
    }
  }, [location?.speedKmh]);
  
  // ✅ NEW: Track real-time movement status for debugging waiting time
  const lastLocationRef = useRef<any>(null);
  
  useEffect(() => {
    if (!location) {
      setMovementStatus(prev => ({
        ...prev,
        method: 'no location',
        lastUpdate: Date.now(),
      }));
      return;
    }
    
    // Calculate distance from last location
    let distanceMoved = 0;
    if (lastLocationRef.current) {
      const R = 6371000; // Earth's radius in meters
      const dLat = (location.latitude - lastLocationRef.current.latitude) * Math.PI / 180;
      const dLon = (location.longitude - lastLocationRef.current.longitude) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lastLocationRef.current.latitude * Math.PI / 180) * 
        Math.cos(location.latitude * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      distanceMoved = R * c; // Distance in meters
    }
    
    // Determine if moving based on distance (< 3m = stopped)
    const isMovingByDistance = distanceMoved >= 3;
    
    // Determine if moving based on speed (< 5 km/h = stopped)
    const speed = location.speed || location.speedKmh || 0;
    const isMovingBySpeed = speed >= 5;
    
    // Use coordinate-based detection as primary method
    const isMoving = lastLocationRef.current ? isMovingByDistance : isMovingBySpeed;
    const method = lastLocationRef.current 
      ? `coords (${distanceMoved.toFixed(1)}m)` 
      : `gps speed (${speed.toFixed(1)} km/h)`;
    
    setMovementStatus({
      isMoving,
      speed,
      method,
      distanceMoved,
      lastUpdate: Date.now(),
    });
    
    // Store current location for next comparison
    lastLocationRef.current = location;
  }, [location?.latitude, location?.longitude, location?.speed, location?.speedKmh]);
  
  // ✅ NEW: Start/stop waiting time counter based on movement status
  useEffect(() => {
    // Clear any existing interval
    if (waitingIntervalRef.current) {
      clearInterval(waitingIntervalRef.current);
      waitingIntervalRef.current = null;
    }
    
    // If stopped and job is active, start counting waiting time
    if (!movementStatus.isMoving && (status === 'STARTED' || status === 'ACTIVE')) {
      console.log('🛑 Vehicle STOPPED - Starting waiting time counter');
      
      waitingIntervalRef.current = setInterval(() => {
        setLocalWaitingSeconds(prev => {
          const newValue = prev + 1;
          console.log(`⏱️ Waiting time: ${newValue}s`);
          return newValue;
        });
      }, 1000); // Increment every second
    } else if (movementStatus.isMoving) {
      console.log('🚗 Vehicle MOVING - Stopping waiting time counter');
      // Don't reset, just stop incrementing
    }
    
    // Cleanup on unmount
    return () => {
      if (waitingIntervalRef.current) {
        clearInterval(waitingIntervalRef.current);
        waitingIntervalRef.current = null;
      }
    };
  }, [movementStatus.isMoving, status]);
  
  // Reset local waiting time when job status changes to STARTED
  useEffect(() => {
    if (status === 'STARTED') {
      setLocalWaitingSeconds(0);
      console.log('🔄 Job started - Reset local waiting time to 0');
    }
  }, [status]);
  
  // ✅ FIX: Don't auto-navigate away - let HomeScreen handle navigation based on status
  // This was causing glitches when status changed to PENDING_PAYMENT
  // HomeScreen's useEffect will navigate to the correct screen based on job status
  /*
  useEffect(() => {
    if (!currentJob || !['STARTED', 'ACTIVE', 'PAUSED'].includes(status)) {
      navigation.goBack();
    }
  }, [currentJob, status, navigation]);
  */
  
  // Calculate coordinates
  const pickupCoord = useMemo(() => {
    if (currentJob?.pickupLatitude && currentJob?.pickupLongitude) {
      return {
        latitude: currentJob.pickupLatitude,
        longitude: currentJob.pickupLongitude,
      };
    }
    return undefined;
  }, [currentJob]);
  
  const dropoffCoord = useMemo(() => {
    if (currentJob?.dropoffLatitude && currentJob?.dropoffLongitude) {
      return {
        latitude: currentJob.dropoffLatitude,
        longitude: currentJob.dropoffLongitude,
      };
    }
    return undefined;
  }, [currentJob]);
  
  const driverCoord = useMemo(() => {
    if (location?.latitude && location?.longitude) {
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        heading: location.heading || 0, // ✅ Add heading for map rotation
        speed: location.speed || 0,     // ✅ Add speed for dynamic camera
      };
    }
    return undefined;
  }, [location]);
  
  const routeCoordinates = useMemo(
    () => routePoints.map(({ latitude, longitude }) => ({ latitude, longitude })),
    [routePoints]
  );
  
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
  
  // Get fare from pricing breakdown or calculate manually
  const currentFare = useMemo(() => {
    if (pricingBreakdown) {
      const fareFromBreakdown = parseFloat(pricingBreakdown.totalCost || '0');
      console.log('💰 CurrentFare (from pricingBreakdown):', fareFromBreakdown);
      return fareFromBreakdown;
    }
    
    // Fallback calculation
    const base = selectedTariff?.baseFare || 0;
    const distanceCost = ((timer?.distanceMeters || 0) / 1000) * (selectedTariff?.perKmRate || 0);
    const timeCost = ((timer?.elapsedSeconds || 0) / 60) * (selectedTariff?.perMinuteRate || 0);
    const waitingCost = ((localWaitingSeconds / 60) * (selectedTariff?.waitingTimeRate || 0)); // ✅ Use local waiting time
    const total = base + distanceCost + timeCost + waitingCost;
    
    console.log('💰 CurrentFare (calculated):', {
      base,
      distanceCost,
      timeCost,
      waitingCost,
      total,
      timer: {
        distanceMeters: timer?.distanceMeters,
        elapsedSeconds: timer?.elapsedSeconds,
        localWaitingSeconds: localWaitingSeconds, // ✅ Show local waiting time
      },
      tariff: {
        baseFare: selectedTariff?.baseFare,
        perKmRate: selectedTariff?.perKmRate,
        perMinuteRate: selectedTariff?.perMinuteRate,
        waitingTimeRate: selectedTariff?.waitingTimeRate,
      }
    });
    
    return total;
  }, [pricingBreakdown, timer, selectedTariff, localWaitingSeconds]);
  
  // Fare breakdown
  const fareDetails = useMemo(() => {
    if (pricingBreakdown) {
      return {
        base: parseFloat(pricingBreakdown.startingPrice || '0'),
        distance: parseFloat(pricingBreakdown.distanceCost || '0'),
        time: parseFloat(pricingBreakdown.durationCost || '0'),
        waiting: parseFloat(pricingBreakdown.waitingCost || '0'),
      };
    }
    
    return {
      base: selectedTariff?.baseFare || 0,
      distance: ((timer?.distanceMeters || 0) / 1000) * (selectedTariff?.perKmRate || 0),
      time: ((timer?.elapsedSeconds || 0) / 60) * (selectedTariff?.perMinuteRate || 0),
      waiting: ((localWaitingSeconds / 60) * (selectedTariff?.waitingTimeRate || 0)), // ✅ Use local waiting time
    };
  }, [pricingBreakdown, timer, selectedTariff]);
  
  // Handlers
  const handlePause = useCallback(async () => {
    try {
      await pauseJob();
      navigation.navigate('JobPaused');
      Toast.show({
        type: 'info',
        text1: 'Ride Paused',
        text2: 'Waiting time will be tracked',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Failed to Pause',
        text2: 'Please try again',
      });
    }
  }, [pauseJob, navigation]);
  
  const handleComplete = useCallback(async () => {
    try {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💰 COMPLETING JOB - PAYMENT FLOW START');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 Current State:', {
        currentFare: currentFare.toFixed(2),
        timerEarnings: timer?.earningsSoFar?.toFixed(2) || 'undefined',
        timerDistance: timer?.distanceMeters?.toFixed(2) || 'undefined',
        timerWaiting: timer?.waitingSeconds?.toFixed(0) || 'undefined',
        timerElapsed: timer?.elapsedSeconds?.toFixed(0) || 'undefined',
        pricingBreakdownTotal: pricingBreakdown?.totalCost || 'undefined',
        selectedTariff: selectedTariff?.name || 'undefined',
      });
      
      const preparedJob = await prepareJobForPayment(); // ✅ Prepare (not complete yet!)
      
      if (!preparedJob) {
        console.error('❌ PreparedJob is null!');
        Toast.show({
          type: 'error',
          text1: 'Failed to Prepare',
          text2: 'No job data available',
        });
        return;
      }

      // ✅ FIX: Use currentFare directly (already calculated correctly above)
      const finalAmount = currentFare > 0 ? currentFare : 0;

      console.log('💸 NAVIGATING TO PAYMENT SCREEN:', {
        jobId: preparedJob.id,
        amount: finalAmount.toFixed(2),
        customerId: preparedJob.customer?.id || null,
      });

      // ✅ Navigate with required params
      navigation.navigate('PaymentCollection', {
        jobId: preparedJob.id,
        amount: finalAmount,
        customerId: preparedJob.customer?.id || null,
      });
      
      console.log('✅ Navigation completed - payment screen should show');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      Toast.show({
        type: 'success',
        text1: 'Ride Ended',
        text2: `Collect $${finalAmount.toFixed(2)}`,
      });
    } catch (error) {
      console.error('❌ Failed to prepare job for payment:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Prepare',
        text2: 'Please try again',
      });
    }
  }, [prepareJobForPayment, navigation, currentFare, timer, pricingBreakdown, selectedTariff]);
  
  // ✅ NEW: Handle tariff change during active ride
  const handleTariffChange = useCallback(async (newTariff: any) => {
    try {
      // Call changeTariff from JobContext
      await changeTariff(newTariff);
      
      setShowTariffModal(false);
      
      Toast.show({
        type: 'success',
        text1: 'Tariff Changed',
        text2: `Now using: ${newTariff.name}. Pricing recalculated.`,
        position: 'top',
      });
      
      console.log('✅ Tariff changed successfully:', {
        from: selectedTariff?.name,
        to: newTariff.name,
        newRates: {
          perKm: newTariff.perKmRate,
          perMin: newTariff.perMinuteRate,
          waiting: newTariff.waitingTimeRate,
        },
      });
    } catch (error) {
      console.error('❌ Failed to change tariff:', error);
      Toast.show({
        type: 'error',
        text1: 'Failed to Change Tariff',
        text2: 'Please try again',
        position: 'top',
      });
    }
  }, [changeTariff, selectedTariff]);
  
  const handleNavigation = useCallback(() => {
    if (dropoffCoord) {
      // Open external navigation apps
      const url = Platform.select({
        ios: `maps://app?daddr=${dropoffCoord.latitude},${dropoffCoord.longitude}`,
        android: `google.navigation:q=${dropoffCoord.latitude},${dropoffCoord.longitude}`,
      });
      
      if (url) {
        // TODO: Implement Linking.openURL(url)
        Toast.show({
          type: 'info',
          text1: 'Navigation',
          text2: 'Opening external navigation app',
        });
      }
    }
  }, [dropoffCoord]);
  
  const isPaused = status === 'PAUSED';
  
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Icon name="taxi" size={28} color="#fbbf24" />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>RIDE IN PROGRESS</Text>
            <Text style={styles.headerSubtitle}>
              {currentJob?.publicJobId || currentJob?.id || 'Job'}
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.navButton}
          onPress={handleNavigation}
          activeOpacity={0.7}
        >
          <Icon name="navigation" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
      
      {/* ✅ NEW: Movement Status Debug Bar */}
      <View style={[
        styles.movementStatusBar,
        movementStatus.isMoving ? styles.movementStatusMoving : styles.movementStatusStopped
      ]}>
        <View style={styles.movementStatusLeft}>
          <Text style={styles.movementStatusIcon}>
            {movementStatus.isMoving ? '🚗' : '🛑'}
          </Text>
          <View>
            <Text style={styles.movementStatusText}>
              {movementStatus.isMoving ? 'MOVING' : 'STOPPED'}
            </Text>
            <Text style={styles.movementStatusSubtext}>
              {movementStatus.method}
            </Text>
          </View>
        </View>
        <View style={styles.movementStatusRight}>
          <Text style={styles.movementStatusSpeed}>
            {movementStatus.speed.toFixed(1)} km/h
          </Text>
          <Text style={styles.movementStatusSubtext}>
            Current Speed
          </Text>
        </View>
      </View>
      
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Live Map */}
        <View style={styles.mapContainer}>
          <RideMap
            pickup={pickupCoord}
            dropoff={dropoffCoord}
            driver={driverCoord}
            route={routeCoordinates}
            style={styles.map}
            enable3D={true}
            followDriver={true}
            height={280}
          />
          
          {/* Speed Badge */}
          {currentSpeed > 0 && (
            <View style={styles.speedBadge}>
              <Icon name="speedometer" size={16} color="#fff" />
              <Text style={styles.speedText}>{Math.round(currentSpeed)} km/h</Text>
            </View>
          )}
        </View>
        
        {/* MEGA FARE METER */}
        <Animated.View style={[styles.meterCard, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={styles.meterLabel}>CURRENT FARE</Text>
          <Text style={styles.meterAmount}>${currentFare.toFixed(2)}</Text>
          <View style={styles.meterStatus}>
            <View style={[styles.statusDot, isPaused && styles.statusDotPaused]} />
            <Text style={styles.meterStatusText}>
              {isPaused ? 'PAUSED - Waiting' : 'LIVE - Tracking'}
            </Text>
          </View>
        </Animated.View>
        
        {/* Stats Grid */}
        <View style={styles.statsGrid}>
          {/* Distance */}
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#10b981' }]}>
              <Icon name="map-marker-distance" size={24} color="#fff" />
            </View>
            <Text style={styles.statLabel}>Distance</Text>
            <Text style={styles.statValue}>
              {((timer?.distanceMeters || 0) / 1000).toFixed(2)} km
            </Text>
            <Text style={styles.statCost}>${fareDetails.distance.toFixed(2)}</Text>
          </View>
          
          {/* Time */}
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#3b82f6' }]}>
              <Icon name="clock-outline" size={24} color="#fff" />
            </View>
            <Text style={styles.statLabel}>Duration</Text>
            <Text style={styles.statValue}>{formatTime(timer?.elapsedSeconds || 0)}</Text>
            <Text style={styles.statCost}>${fareDetails.time.toFixed(2)}</Text>
          </View>
          
          {/* Waiting */}
          <View style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: '#f59e0b' }]}>
              <Icon name="timer-sand" size={24} color="#fff" />
            </View>
            <Text style={styles.statLabel}>Waiting</Text>
            <Text style={styles.statValue}>{formatTime(localWaitingSeconds)}</Text>
            <Text style={styles.statCost}>
              ${(((localWaitingSeconds / 60) * (selectedTariff?.waitingTimeRate || 0))).toFixed(2)}
            </Text>
          </View>
        </View>
        
        {/* Fare Breakdown */}
        <View style={styles.breakdownCard}>
          <Text style={styles.breakdownTitle}>FARE BREAKDOWN</Text>
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Base Fare</Text>
            <Text style={styles.breakdownValue}>${fareDetails.base.toFixed(2)}</Text>
          </View>
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Distance ({((timer?.distanceMeters || 0) / 1000).toFixed(2)} km × ${selectedTariff?.perKmRate || 0}/km)
            </Text>
            <Text style={styles.breakdownValue}>${fareDetails.distance.toFixed(2)}</Text>
          </View>
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>
              Duration ({Math.floor((timer?.elapsedSeconds || 0) / 60)} min × ${selectedTariff?.perMinuteRate || 0}/min)
            </Text>
            <Text style={styles.breakdownValue}>${fareDetails.time.toFixed(2)}</Text>
          </View>
          
          {fareDetails.waiting > 0 && (
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>
                Waiting ({Math.floor(localWaitingSeconds / 60)} min × ${selectedTariff?.waitingTimeRate || 0}/min)
              </Text>
              <Text style={styles.breakdownValue}>${fareDetails.waiting.toFixed(2)}</Text>
            </View>
          )}
          
          <View style={styles.breakdownDivider} />
          
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownTotal}>TOTAL</Text>
            <Text style={styles.breakdownTotalValue}>${currentFare.toFixed(2)}</Text>
          </View>
        </View>
        
        {/* Rider Info */}
        <View style={styles.riderCard}>
          <Text style={styles.riderTitle}>PASSENGER</Text>
          <View style={styles.riderRow}>
            <Icon name="account" size={20} color="#64748b" />
            <Text style={styles.riderText}>
              {currentJob?.passenger?.name || 'Passenger'}
            </Text>
          </View>
          {currentJob?.passenger?.phone && (
            <View style={styles.riderRow}>
              <Icon name="phone" size={20} color="#64748b" />
              <Text style={styles.riderText}>{currentJob.passenger.phone}</Text>
            </View>
          )}
        </View>
        
        {/* Destination */}
        <View style={styles.destinationCard}>
          <View style={styles.destinationRow}>
            <Icon name="flag-checkered" size={24} color="#ef4444" />
            <View style={styles.destinationText}>
              <Text style={styles.destinationLabel}>DROP-OFF</Text>
              <Text style={styles.destinationAddress}>
                {currentJob?.dropoffAddress || 'Destination'}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
      
      {/* Action Buttons */}
      <View style={styles.actions}>
        <View style={styles.actionsRow}>
          {/* ✅ NEW: Change Tariff Button */}
          <TouchableOpacity
            style={[styles.actionButton, styles.tariffButton]}
            onPress={() => setShowTariffModal(true)}
            activeOpacity={0.8}
          >
            <Icon name="swap-horizontal" size={20} color="#fff" />
            <Text style={styles.actionTextSmall}>Change Tariff</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.pauseButton]}
            onPress={handlePause}
            activeOpacity={0.8}
          >
            <Icon name="pause-circle" size={24} color="#fff" />
            <Text style={styles.actionText}>Pause</Text>
          </TouchableOpacity>
        </View>
        
        {/* Full width Complete button */}
        <TouchableOpacity
          style={[styles.actionButton, styles.completeButton, styles.completeButtonFull]}
          onPress={handleComplete}
          activeOpacity={0.8}
        >
          <Icon name="check-circle" size={28} color="#fff" />
          <Text style={styles.actionText}>Complete Ride</Text>
        </TouchableOpacity>
      </View>
      
      {/* ✅ NEW: Tariff Change Modal */}
      <Modal
        visible={showTariffModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowTariffModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Tariff</Text>
              <TouchableOpacity
                onPress={() => setShowTariffModal(false)}
                style={styles.modalCloseButton}
              >
                <Icon name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              Current: {selectedTariff?.name || 'Unknown'}
            </Text>
            
            <ScrollView style={styles.tariffList}>
              {!driverTariffs || driverTariffs.length === 0 ? (
                <View style={styles.emptyState}>
                  <Icon name="information-outline" size={48} color="#64748b" />
                  <Text style={styles.emptyStateText}>No tariffs available</Text>
                  <Text style={styles.emptyStateSubtext}>
                    Please ensure you have tariffs configured for your zone
                  </Text>
                </View>
              ) : (
                driverTariffs.map((tariff) => {
                  const isSelected = tariff.id === selectedTariff?.id;
                  return (
                    <TouchableOpacity
                      key={tariff.id}
                      style={[
                        styles.tariffOption,
                        isSelected && styles.tariffOptionSelected,
                      ]}
                      onPress={() => handleTariffChange(tariff)}
                      disabled={isSelected}
                      activeOpacity={0.7}
                    >
                      <View style={styles.tariffOptionHeader}>
                        <Text style={styles.tariffOptionName}>{tariff.name}</Text>
                        {isSelected && (
                          <View style={styles.currentBadge}>
                            <Text style={styles.currentBadgeText}>CURRENT</Text>
                          </View>
                        )}
                      </View>
                      
                      <View style={styles.tariffOptionRates}>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Base Fare:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.baseFare?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Per KM:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.perKmRate?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                        <View style={styles.tariffRate}>
                          <Text style={styles.tariffRateLabel}>Per Min:</Text>
                          <Text style={styles.tariffRateValue}>
                            ${tariff.perMinuteRate?.toFixed(2) || '0.00'}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            
            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowTariffModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a', // Dark blue-gray
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 2,
    borderBottomColor: '#fbbf24',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerText: {
    gap: 2,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fbbf24',
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  mapContainer: {
    position: 'relative',
  },
  map: {
    width: '100%',
    height: 280,
  },
  speedBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  speedText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  meterCard: {
    margin: 20,
    padding: 24,
    backgroundColor: '#1e293b',
    borderRadius: 20,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fbbf24',
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  meterLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 2,
    marginBottom: 8,
  },
  meterAmount: {
    fontSize: 56,
    fontWeight: '800',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  meterStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22c55e',
  },
  statusDotPaused: {
    backgroundColor: '#f59e0b',
  },
  meterStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#cbd5e1',
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    gap: 8,
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  statCost: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fbbf24',
  },
  breakdownCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 20,
    backgroundColor: '#1e293b',
    borderRadius: 16,
  },
  breakdownTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#cbd5e1',
    letterSpacing: 1,
    marginBottom: 16,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#94a3b8',
    flex: 1,
  },
  breakdownValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#f1f5f9',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  breakdownTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fbbf24',
  },
  breakdownTotalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fbbf24',
  },
  riderCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 16,
  },
  riderTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 12,
  },
  riderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  riderText: {
    fontSize: 14,
    color: '#e2e8f0',
  },
  destinationCard: {
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 16,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  destinationRow: {
    flexDirection: 'row',
    gap: 12,
  },
  destinationText: {
    flex: 1,
    gap: 4,
  },
  destinationLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
  },
  destinationAddress: {
    fontSize: 14,
    color: '#e2e8f0',
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 16,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  pauseButton: {
    backgroundColor: '#f59e0b',
  },
  completeButton: {
    backgroundColor: '#22c55e',
    flex: undefined, // ✅ FIX: Remove flex when full width
  },
  completeButtonFull: {
    width: '100%',
    flex: undefined, // ✅ FIX: Remove flex constraint for full width button
  },
  tariffButton: {
    backgroundColor: '#8b5cf6',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  actionTextSmall: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
  },
  // ✅ NEW: Tariff Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 32,
    maxHeight: height * 0.8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  modalCloseButton: {
    padding: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tariffList: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    minHeight: 200,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  tariffOption: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#334155',
  },
  tariffOptionSelected: {
    borderColor: '#8b5cf6',
    backgroundColor: '#1e1b4b',
  },
  tariffOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  tariffOptionName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  currentBadge: {
    backgroundColor: '#8b5cf6',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  currentBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 1,
  },
  tariffOptionRates: {
    flexDirection: 'row',
    gap: 16,
  },
  tariffRate: {
    flex: 1,
  },
  tariffRateLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
  },
  tariffRateValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fbbf24',
  },
  modalCancelButton: {
    marginHorizontal: 24,
    marginTop: 16,
    paddingVertical: 16,
    backgroundColor: '#334155',
    borderRadius: 16,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  // ✅ NEW: Movement Status Debug Bar
  movementStatusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 2,
  },
  movementStatusMoving: {
    backgroundColor: '#059669', // Green when moving
    borderBottomColor: '#10b981',
  },
  movementStatusStopped: {
    backgroundColor: '#dc2626', // Red when stopped
    borderBottomColor: '#ef4444',
  },
  movementStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  movementStatusIcon: {
    fontSize: 28,
  },
  movementStatusText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.5,
  },
  movementStatusSubtext: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 2,
  },
  movementStatusRight: {
    alignItems: 'flex-end',
  },
  movementStatusSpeed: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
  },
});

export default ActiveRideScreen;

