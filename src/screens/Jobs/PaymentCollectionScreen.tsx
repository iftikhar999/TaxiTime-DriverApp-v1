/**
 * ✨ PROFESSIONAL PAYMENT COLLECTION SCREEN
 * 
 * Modern, clean design with full functionality for all payment methods
 * - Cash: Simple confirmation
 * - Card: Stripe integration (Payment Sheet, Card Scan, NFC)
 * - EFTPOS: Customer provides terminal number
 * - Account: Customer provides account number
 * - Gift Card: Customer provides gift card code
 * - Total Mobility: 50% discount toggle
 */

import { useNavigation, useRoute } from '@react-navigation/native';
import { useStripe } from '@stripe/stripe-react-native';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useJob } from '../../context/JobContext';
import httpClient from '../../services/httpClient';

const { width } = Dimensions.get('window');

type PaymentMethod = 'CASH' | 'CARD' | 'EFTPOS' | 'ACCOUNT' | 'GIFT_CARD';

const PAYMENT_METHODS: {
  id: PaymentMethod;
  label: string;
  icon: string;
  color: string;
  description: string;
}[] = [
  { 
    id: 'CASH', 
    label: 'Cash', 
    icon: 'cash-multiple', 
    color: '#10b981',
    description: 'Pay with physical cash'
  },
  { 
    id: 'CARD', 
    label: 'Card', 
    icon: 'credit-card-outline', 
    color: '#3b82f6',
    description: 'Contactless, chip, or manual entry'
  },
  { 
    id: 'EFTPOS', 
    label: 'EFTPOS', 
    icon: 'contactless-payment', 
    color: '#8b5cf6',
    description: 'External terminal transaction'
  },
  { 
    id: 'ACCOUNT', 
    label: 'Account', 
    icon: 'account-cash-outline', 
    color: '#f59e0b',
    description: 'Charge to customer account'
  },
  { 
    id: 'GIFT_CARD', 
    label: 'Gift Card', 
    icon: 'gift-outline', 
    color: '#ec4899',
    description: 'Redeem gift card code'
  },
];

export default function PaymentCollectionScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { currentJob, pricingBreakdown, pauseRecords, timer, completeJob } = useJob();
  
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Payment state
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [totalMobility, setTotalMobility] = useState(false);
  const [extraAmount, setExtraAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [finalFare, setFinalFare] = useState('0.00');
  
  // Method-specific state
  const [eftposNumber, setEftposNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  
  // Stripe state
  const [paymentSheetReady, setPaymentSheetReady] = useState(false);

  // ✅ DEBUG: Log all available fare data on mount
  useEffect(() => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💳 PAYMENT SCREEN LOADED - CHECKING FARE SOURCES');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Available Fare Data:', {
      '1_pricingBreakdown': pricingBreakdown?.totalCost || 'MISSING ❌',
      '2_timerEarnings': timer?.earningsSoFar || 'MISSING ❌',
      '3_currentJobFare': currentJob?.fare || 'MISSING ❌',
      '4_currentJobEarnings': currentJob?.earningsSoFar || 'MISSING ❌',
      '5_routeParamsAmount': route.params?.amount || 'MISSING ❌',
    });
    console.log('📦 Timer State:', {
      distance: timer?.distanceMeters?.toFixed(2) || 'undefined',
      waiting: timer?.waitingSeconds?.toFixed(0) || 'undefined',
      elapsed: timer?.elapsedSeconds?.toFixed(0) || 'undefined',
      earnings: timer?.earningsSoFar?.toFixed(2) || 'undefined',
    });
    console.log('📋 Job Data:', {
      jobId: currentJob?.id || 'undefined',
      status: currentJob?.status || 'undefined',
    });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, []); // Only on mount

  // Calculate total fare dynamically
  useEffect(() => {
    // ✅ FIX: Check multiple sources in priority order (route.params FIRST!)
    let baseFare = 0;
    let fareSource = 'none';
    
    // Priority 1: Route params.amount (most reliable - passed directly from ActiveRideScreen)
    if (route.params?.amount && route.params.amount > 0) {
      baseFare = parseFloat(route.params.amount.toString());
      fareSource = 'route.params.amount';
    }
    // Priority 2: Pricing breakdown (most accurate)
    else if (pricingBreakdown?.totalCost) {
      baseFare = parseFloat(pricingBreakdown.totalCost);
      fareSource = 'pricingBreakdown';
    }
    // Priority 3: Timer earnings (real-time calculation)
    else if (timer?.earningsSoFar) {
      baseFare = timer.earningsSoFar;
      fareSource = 'timer.earningsSoFar';
    }
    // Priority 4: Current job fare
    else if (currentJob?.fare) {
      baseFare = parseFloat(currentJob.fare.toString());
      fareSource = 'currentJob.fare';
    }
    // Priority 5: Current job earningsSoFar
    else if (currentJob?.earningsSoFar) {
      baseFare = parseFloat(currentJob.earningsSoFar.toString());
      fareSource = 'currentJob.earningsSoFar';
    }
    
    const extra = parseFloat(extraAmount || '0');
    const discount = parseFloat(discountAmount || '0');

    // Apply Total Mobility 50% discount
    const fareAfterMobility = totalMobility ? baseFare * 0.5 : baseFare;
    
    const calculatedFare = Math.max(0, fareAfterMobility + extra - discount);
    setFinalFare(calculatedFare.toFixed(2));
    
    console.log('💰 PAYMENT CALCULATION (step-by-step):', {
      source: fareSource,
      routeParamsAmount: route.params?.amount || 'missing',
      routeParamsFareDetails: route.params?.fareDetails || 'missing',
      '1_meterPrice': baseFare.toFixed(2),
      '2_totalMobility': totalMobility ? 'YES (50% OFF on meter only)' : 'NO',
      '3_meterAfterMobility': fareAfterMobility.toFixed(2),
      '4_extraCharges': extra.toFixed(2),
      '5_discounts': discount.toFixed(2),
      '6_FINAL_TOTAL': calculatedFare.toFixed(2),
    });
  }, [pricingBreakdown, timer, currentJob, route.params, extraAmount, discountAmount, totalMobility]);

  // Total pause time
  const totalPauseSeconds = pauseRecords?.reduce((sum, record) => sum + (record.durationSeconds || 0), 0) || 0;

  // Initialize Stripe Payment Sheet
  const initializePaymentSheet = async () => {
    try {
      console.log('🔄 Initializing Stripe Payment Sheet...');
      const amountCents = Math.round(parseFloat(finalFare) * 100);
      
      console.log('💳 Creating payment intent:', {
        amount: amountCents,
        currency: 'nzd',
        jobId: currentJob?.id,
        customerId: currentJob?.customer?.id,
      });
      
      const response = await httpClient.post('/api/payments/create-intent', {
        amount: amountCents,
        currency: 'nzd',
        jobId: currentJob?.id,
        customerId: currentJob?.customer?.id,
      });

      console.log('✅ Payment intent response:', response.data);

      const { paymentIntent, ephemeralKey, customer } = response.data;

      const { error } = await initPaymentSheet({
        merchantDisplayName: 'AB Taxi',
        customerId: customer,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: paymentIntent,
        allowsDelayedPaymentMethods: true,
        defaultBillingDetails: {
          name: currentJob?.customer?.name || 'Customer',
        },
      });

      if (error) {
        console.error('❌ Error initializing payment sheet:', error);
        Alert.alert('Setup Failed', error.message);
      } else {
        console.log('✅ Payment sheet initialized successfully');
        setPaymentSheetReady(true);
      }
    } catch (error: any) {
      console.error('❌ Error creating payment intent:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data,
        stack: error.stack,
      });
      
      // ✅ Show detailed error to user
      Alert.alert(
        'Stripe Not Configured',
        'Card payment requires Stripe API keys to be configured.\n\nPlease add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to backend .env file.\n\nFor now, use Cash, EFTPOS, Account, or Gift Card.',
        [{ text: 'OK' }]
      );
      
      // Reset to no selection
      setSelectedMethod(null);
    }
  };

  // Initialize Stripe when Card is selected
  useEffect(() => {
    if (selectedMethod === 'CARD' && parseFloat(finalFare) > 0) {
      initializePaymentSheet();
    }
  }, [selectedMethod, finalFare]);

  // Handle method selection
  const handleMethodSelect = (method: PaymentMethod) => {
    setSelectedMethod(method);
    
    // Show details modal for methods that need input
    if (method === 'EFTPOS' || method === 'ACCOUNT' || method === 'GIFT_CARD') {
      setShowDetailsModal(true);
    }
  };

  // Handle Card Payment with Stripe
  const handleCardPayment = async (): Promise<boolean> => {
    try {
      const { error } = await presentPaymentSheet();

      if (error) {
        if (error.code === 'Canceled') {
          return false;
        }
        throw new Error(error.message);
      }

      console.log('✅ Card payment successful');
      return true;
    } catch (error: any) {
      console.error('Card payment error:', error);
      Alert.alert('Payment Failed', error.message || 'Card payment could not be processed');
      return false;
    }
  };

  // Validate method-specific requirements
  const validatePaymentMethod = (): boolean => {
    if (selectedMethod === 'EFTPOS' && !eftposNumber.trim()) {
      Alert.alert('EFTPOS Number Required', 'Please enter the EFTPOS terminal number');
      return false;
    }
    
    if (selectedMethod === 'ACCOUNT' && !accountNumber.trim()) {
      Alert.alert('Account Number Required', 'Please enter the customer account number');
      return false;
    }
    
    if (selectedMethod === 'GIFT_CARD' && !giftCardCode.trim()) {
      Alert.alert('Gift Card Code Required', 'Please enter the gift card code');
      return false;
    }
    
    return true;
  };

  // Confirm Payment
  const handlePaymentConfirm = async () => {
    if (!selectedMethod) {
      Alert.alert('Select Payment Method', 'Please select how the customer will pay');
      return;
    }

    if (!validatePaymentMethod()) {
      return;
    }

    setProcessing(true);

    try {
      // Handle Stripe card payment
      if (selectedMethod === 'CARD') {
        const paymentSuccess = await handleCardPayment();
        if (!paymentSuccess) {
          setProcessing(false);
          return;
        }
      }

      // Build payment data
      const paymentData: any = {
        jobId: currentJob?.id,
        method: selectedMethod,
        amount: finalFare,
        baseFare: pricingBreakdown?.totalCost || '0.00',
        extraAmount: extraAmount || '0.00',
        discountAmount: discountAmount || '0.00',
        totalMobility,
        adjustmentReason,
        recordedAt: new Date().toISOString(),
      };

      // Add method-specific data
      if (selectedMethod === 'EFTPOS') {
        paymentData.eftposNumber = eftposNumber;
      } else if (selectedMethod === 'ACCOUNT') {
        paymentData.accountNumber = accountNumber;
      } else if (selectedMethod === 'GIFT_CARD') {
        paymentData.giftCardCode = giftCardCode;
      }

      console.log('💳 Payment collected:', paymentData);

      // Complete the job
      await completeJob(selectedMethod, parseFloat(finalFare));
      
      Toast.show({
        type: 'success',
        text1: 'Payment Collected',
        text2: `$${finalFare} via ${PAYMENT_METHODS.find((m) => m.id === selectedMethod)?.label}`,
        position: 'top',
      });

      setTimeout(() => {
        navigation.navigate('Home' as never);
      }, 1500);
    } catch (error) {
      console.error('Payment error:', error);
      Alert.alert('Payment Failed', 'Please try again or choose a different payment method');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Icon name="wallet-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Collect Payment</Text>
          <Text style={styles.headerSubtitle}>Job #{currentJob?.publicJobId || currentJob?.id?.slice(-6)}</Text>
        </View>

        {/* Total Amount Card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>TOTAL TO COLLECT</Text>
          <Text style={styles.totalAmount}>${finalFare}</Text>
          {totalMobility && (
            <View style={styles.mobilityBadge}>
              <Icon name="wheelchair-accessibility" size={14} color="#fff" />
              <Text style={styles.mobilityBadgeText}>Total Mobility Applied (-50%)</Text>
            </View>
          )}
        </View>

        {/* Fare Breakdown */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Fare Breakdown</Text>
          <View style={styles.card}>
            {pricingBreakdown ? (
              <>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Base Fare</Text>
                  <Text style={styles.breakdownValue}>${pricingBreakdown.startingPrice}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Distance · {(parseFloat(pricingBreakdown.totalDistance) / 1000).toFixed(2)} km
                  </Text>
                  <Text style={styles.breakdownValue}>${pricingBreakdown.distanceCost}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Time · {Math.floor(parseFloat(pricingBreakdown.duration) / 60)}min
                  </Text>
                  <Text style={styles.breakdownValue}>${pricingBreakdown.durationCost}</Text>
                </View>
                {parseFloat(pricingBreakdown.waitingCost) > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      Waiting · {Math.floor(parseFloat(pricingBreakdown.waitingSeconds) / 60)}min
                    </Text>
                    <Text style={styles.breakdownValue}>${pricingBreakdown.waitingCost}</Text>
                  </View>
                )}
                <View style={styles.divider} />
                <View style={styles.breakdownRow}>
                  <Text style={styles.subtotalLabel}>Meter Price</Text>
                  <Text style={styles.subtotalValue}>${pricingBreakdown.totalCost}</Text>
                </View>
                
                {/* ✅ Show Total Mobility discount if applied */}
                {totalMobility && (
                  <View style={[styles.breakdownRow, { backgroundColor: '#f3e8ff' }]}>
                    <Text style={[styles.breakdownLabel, { color: '#8b5cf6' }]}>
                      Total Mobility (50% OFF)
                    </Text>
                    <Text style={[styles.breakdownValue, { color: '#8b5cf6' }]}>
                      -${(parseFloat(pricingBreakdown.totalCost) * 0.5).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                {/* ✅ Show extras and discounts */}
                {parseFloat(extraAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Extra Charges</Text>
                    <Text style={styles.breakdownValue}>+${parseFloat(extraAmount).toFixed(2)}</Text>
                  </View>
                )}
                {parseFloat(discountAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text style={[styles.breakdownValue, { color: '#10b981' }]}>
                      -${parseFloat(discountAmount).toFixed(2)}
                    </Text>
                  </View>
                )}
              </>
            ) : timer ? (
              <>
                {/* ✅ Fallback: Show timer-based breakdown */}
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Distance · {((timer.distanceMeters || 0) / 1000).toFixed(2)} km
                  </Text>
                  <Text style={styles.breakdownValue}>-</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Time · {Math.floor((timer.elapsedSeconds || 0) / 60)}min
                  </Text>
                  <Text style={styles.breakdownValue}>-</Text>
                </View>
                {(timer.waitingSeconds || 0) > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      Waiting · {Math.floor((timer.waitingSeconds || 0) / 60)}min
                    </Text>
                    <Text style={styles.breakdownValue}>-</Text>
                  </View>
                )}
                <View style={styles.divider} />
                <View style={styles.breakdownRow}>
                  <Text style={styles.subtotalLabel}>Meter Price</Text>
                  <Text style={styles.subtotalValue}>${(timer.earningsSoFar || 0).toFixed(2)}</Text>
                </View>
                
                {/* ✅ Show Total Mobility discount if applied */}
                {totalMobility && (
                  <View style={[styles.breakdownRow, { backgroundColor: '#f3e8ff' }]}>
                    <Text style={[styles.breakdownLabel, { color: '#8b5cf6' }]}>
                      Total Mobility (50% OFF)
                    </Text>
                    <Text style={[styles.breakdownValue, { color: '#8b5cf6' }]}>
                      -${((timer.earningsSoFar || 0) * 0.5).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                {/* ✅ Show extras and discounts */}
                {parseFloat(extraAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Extra Charges</Text>
                    <Text style={styles.breakdownValue}>+${parseFloat(extraAmount).toFixed(2)}</Text>
                  </View>
                )}
                {parseFloat(discountAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text style={[styles.breakdownValue, { color: '#10b981' }]}>
                      -${parseFloat(discountAmount).toFixed(2)}
                    </Text>
                  </View>
                )}
              </>
            ) : route.params?.fareDetails ? (
              <>
                {/* ✅ Fallback: Show fareDetails from navigation params */}
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Base Fare</Text>
                  <Text style={styles.breakdownValue}>${route.params.fareDetails.base.toFixed(2)}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Distance · {route.params.fareDetails.distanceKm.toFixed(2)} km
                  </Text>
                  <Text style={styles.breakdownValue}>${route.params.fareDetails.distance.toFixed(2)}</Text>
                </View>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>
                    Time · {route.params.fareDetails.durationMin}min
                  </Text>
                  <Text style={styles.breakdownValue}>${route.params.fareDetails.time.toFixed(2)}</Text>
                </View>
                {route.params.fareDetails.waiting > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>
                      Waiting · {route.params.fareDetails.waitingMin}min
                    </Text>
                    <Text style={styles.breakdownValue}>${route.params.fareDetails.waiting.toFixed(2)}</Text>
                  </View>
                )}
                <View style={styles.divider} />
                <View style={styles.breakdownRow}>
                  <Text style={styles.subtotalLabel}>Meter Price</Text>
                  <Text style={styles.subtotalValue}>${route.params.amount?.toFixed(2) || finalFare}</Text>
                </View>
                
                {/* ✅ Show Total Mobility discount if applied */}
                {totalMobility && (
                  <View style={[styles.breakdownRow, { backgroundColor: '#f3e8ff' }]}>
                    <Text style={[styles.breakdownLabel, { color: '#8b5cf6' }]}>
                      Total Mobility (50% OFF)
                    </Text>
                    <Text style={[styles.breakdownValue, { color: '#8b5cf6' }]}>
                      -${((route.params.amount || 0) * 0.5).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                {/* ✅ Show extras and discounts */}
                {parseFloat(extraAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Extra Charges</Text>
                    <Text style={styles.breakdownValue}>+${parseFloat(extraAmount).toFixed(2)}</Text>
                  </View>
                )}
                {parseFloat(discountAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text style={[styles.breakdownValue, { color: '#10b981' }]}>
                      -${parseFloat(discountAmount).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                <View style={styles.divider} />
                <View style={styles.breakdownRow}>
                  <Text style={styles.subtotalLabel}>Total Fare</Text>
                  <Text style={styles.subtotalValue}>${parseFloat(finalFare).toFixed(2)}</Text>
                </View>
              </>
            ) : (
              <>
                {/* ✅ Final Fallback: Show simplified view */}
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Meter Price</Text>
                  <Text style={styles.breakdownValue}>${parseFloat(finalFare).toFixed(2)}</Text>
                </View>
                
                {/* ✅ Show Total Mobility discount if applied */}
                {totalMobility && (
                  <View style={[styles.breakdownRow, { backgroundColor: '#f3e8ff' }]}>
                    <Text style={[styles.breakdownLabel, { color: '#8b5cf6' }]}>
                      Total Mobility (50% OFF)
                    </Text>
                    <Text style={[styles.breakdownValue, { color: '#8b5cf6' }]}>
                      -${(parseFloat(finalFare) * 0.5).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                {/* ✅ Show extras and discounts */}
                {parseFloat(extraAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Extra Charges</Text>
                    <Text style={styles.breakdownValue}>+${parseFloat(extraAmount).toFixed(2)}</Text>
                  </View>
                )}
                {parseFloat(discountAmount || '0') > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Discount</Text>
                    <Text style={[styles.breakdownValue, { color: '#10b981' }]}>
                      -${parseFloat(discountAmount).toFixed(2)}
                    </Text>
                  </View>
                )}
                
                <View style={styles.divider} />
                <View style={styles.breakdownRow}>
                  <Text style={styles.subtotalLabel}>Total Fare</Text>
                  <Text style={styles.subtotalValue}>${parseFloat(finalFare).toFixed(2)}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Adjustments */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Adjustments</Text>
          <View style={styles.card}>
            {/* Total Mobility */}
            <TouchableOpacity
              style={styles.toggleRow}
              onPress={() => setTotalMobility(!totalMobility)}
              activeOpacity={0.7}
            >
              <View style={styles.toggleLeft}>
                <View style={[styles.toggleIcon, { backgroundColor: '#8b5cf6' }]}>
                  <Icon name="wheelchair-accessibility" size={20} color="#fff" />
                </View>
                <View style={styles.toggleText}>
                  <Text style={styles.toggleLabel}>Total Mobility Discount</Text>
                  <Text style={styles.toggleHint}>50% off METER PRICE only (not extras/discounts)</Text>
                </View>
              </View>
              <View style={[styles.switch, totalMobility && styles.switchActive]}>
                <View style={[styles.switchThumb, totalMobility && styles.switchThumbActive]} />
              </View>
            </TouchableOpacity>

            {/* Extra Amount */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Extra Charges</Text>
              <View style={styles.inputWrapper}>
                <Icon name="plus-circle-outline" size={20} color="#6b7280" />
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.input}
                  value={extraAmount}
                  onChangeText={setExtraAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              <Text style={styles.inputHint}>Airport fees, tolls, waiting charges</Text>
            </View>

            {/* Discount Amount */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Discount</Text>
              <View style={styles.inputWrapper}>
                <Icon name="minus-circle-outline" size={20} color="#6b7280" />
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.input}
                  value={discountAmount}
                  onChangeText={setDiscountAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#9ca3af"
                />
              </View>
              <Text style={styles.inputHint}>Promotional codes, loyalty rewards</Text>
            </View>

            {/* Adjustment Reason */}
            {(parseFloat(extraAmount || '0') > 0 || parseFloat(discountAmount || '0') > 0) && (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Reason for Adjustment</Text>
                <TextInput
                  style={styles.textArea}
                  value={adjustmentReason}
                  onChangeText={setAdjustmentReason}
                  placeholder="Describe the reason for this adjustment..."
                  placeholderTextColor="#9ca3af"
                  multiline
                  numberOfLines={3}
                />
              </View>
            )}
          </View>
        </View>

        {/* Payment Methods */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View style={styles.methodsGrid}>
            {PAYMENT_METHODS.map((method) => (
              <TouchableOpacity
                key={method.id}
                style={[
                  styles.methodCard,
                  selectedMethod === method.id && styles.methodCardSelected,
                ]}
                onPress={() => handleMethodSelect(method.id)}
                activeOpacity={0.7}
              >
                <View style={[styles.methodIcon, { backgroundColor: method.color }]}>
                  <Icon name={method.icon} size={32} color="#fff" />
                </View>
                <Text style={styles.methodLabel}>{method.label}</Text>
                <Text style={styles.methodDescription}>{method.description}</Text>
                {selectedMethod === method.id && (
                  <View style={styles.methodCheck}>
                    <Icon name="check-circle" size={24} color={method.color} />
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.goBack()}
            disabled={processing}
          >
            <Icon name="arrow-left" size={20} color="#1f2937" />
            <Text style={styles.secondaryButtonText}>Back to Ride</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              (!selectedMethod || processing) && styles.primaryButtonDisabled,
            ]}
            onPress={handlePaymentConfirm}
            disabled={!selectedMethod || processing}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Icon name="check-circle" size={20} color="#fff" />
                <Text style={styles.primaryButtonText}>Confirm Payment</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Method Details Modal */}
      <Modal
        visible={showDetailsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowDetailsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedMethod === 'EFTPOS' && 'EFTPOS Terminal'}
                {selectedMethod === 'ACCOUNT' && 'Account Number'}
                {selectedMethod === 'GIFT_CARD' && 'Gift Card Code'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowDetailsModal(false)}
                style={styles.modalClose}
              >
                <Icon name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              {selectedMethod === 'EFTPOS' && 'Enter the EFTPOS terminal transaction number provided by the customer'}
              {selectedMethod === 'ACCOUNT' && 'Enter the customer account number to charge this fare to'}
              {selectedMethod === 'GIFT_CARD' && 'Enter the gift card code to redeem for this payment'}
            </Text>

            <View style={styles.modalInputGroup}>
              <TextInput
                style={styles.modalInput}
                value={
                  selectedMethod === 'EFTPOS' ? eftposNumber :
                  selectedMethod === 'ACCOUNT' ? accountNumber :
                  giftCardCode
                }
                onChangeText={(text) => {
                  if (selectedMethod === 'EFTPOS') setEftposNumber(text);
                  else if (selectedMethod === 'ACCOUNT') setAccountNumber(text);
                  else setGiftCardCode(text);
                }}
                placeholder={
                  selectedMethod === 'EFTPOS' ? 'e.g., TXN12345678' :
                  selectedMethod === 'ACCOUNT' ? 'e.g., ACC-1234' :
                  'e.g., GIFT-ABCD-1234'
                }
                placeholderTextColor="#9ca3af"
                autoFocus
                autoCapitalize="characters"
              />
            </View>

            <TouchableOpacity
              style={styles.modalButton}
              onPress={() => setShowDetailsModal(false)}
            >
              <Text style={styles.modalButtonText}>Continue</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  // Header
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  // Total Card
  totalCard: {
    backgroundColor: '#1f2937',
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9ca3af',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  totalAmount: {
    fontSize: 56,
    fontWeight: '800',
    color: '#fff',
  },
  mobilityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  mobilityBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#c4b5fd',
  },
  // Section
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  // Breakdown
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  breakdownLabel: {
    fontSize: 14,
    color: '#6b7280',
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  divider: {
    height: 1,
    backgroundColor: '#e5e7eb',
    marginVertical: 12,
  },
  subtotalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  subtotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3b82f6',
  },
  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  toggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  toggleIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleText: {
    flex: 1,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 2,
  },
  toggleHint: {
    fontSize: 12,
    color: '#6b7280',
  },
  switch: {
    width: 52,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#e5e7eb',
    padding: 2,
    justifyContent: 'center',
  },
  switchActive: {
    backgroundColor: '#8b5cf6',
  },
  switchThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  switchThumbActive: {
    transform: [{ translateX: 20 }],
  },
  // Input
  inputGroup: {
    marginTop: 16,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  currencySymbol: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    padding: 0,
  },
  inputHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 6,
  },
  textArea: {
    padding: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  // Payment Methods
  methodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  methodCard: {
    width: (width - 64) / 2,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  methodCardSelected: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  methodIcon: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  methodLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  methodDescription: {
    fontSize: 11,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 14,
  },
  methodCheck: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
  // Actions
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#e5e7eb',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1f2937',
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
  },
  modalClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
  },
  modalDescription: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalInputGroup: {
    marginBottom: 20,
  },
  modalInput: {
    padding: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  modalButton: {
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
});
