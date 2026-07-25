/**
 * 💳 PROFESSIONAL PAYMENT COLLECTION SCREEN
 * 
 * Professional black theme matching ActiveRideScreen and JobPausedScreen
 * - Real data display from multiple sources
 * - All payment methods: Cash, Card, EFTPOS, Account, Gift Card
 * - Total Mobility 50% discount support
 * - Extra charges and discounts
 * - Clean, taxi-meter aesthetic
 */

import { useNavigation, useRoute } from '@react-navigation/native';
import { useStripe } from '@stripe/stripe-react-native';
import {
    requestNeededAndroidPermissions,
    useStripeTerminal,
} from '@stripe/stripe-terminal-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Dimensions,
    Modal,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useJob } from '../../context/JobContext';
import { useLocation } from '../../context/LocationContext';
import { CURRENCY_CODE, CURRENCY_SYMBOL } from '../../config/currency';
import { useShift } from '../../context/ShiftContext';
import httpClient from '../../services/httpClient';
import {
    createTapToPayIntent,
    getTerminalLocationId,
} from '../../services/stripeTerminalService';

const { width } = Dimensions.get('window');

type PaymentMethod = 'CASH' | 'CARD' | 'TAP_TO_PAY' | 'EFTPOS' | 'ACCOUNT' | 'GIFT_CARD';

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
    id: 'TAP_TO_PAY',
    label: 'Tap to Pay',
    icon: 'contactless-payment-circle',
    color: '#0ea5e9',
    description: 'Contactless credit, debit, EFTPOS, or prepaid Visa/Mastercard gift card'
  },
  {
    id: 'CARD',
    label: 'Card (Online)',
    icon: 'credit-card-outline',
    color: '#3b82f6',
    description: 'Enter card details (also for prepaid Visa/Mastercard gift cards)'
  },
  {
    id: 'EFTPOS',
    label: 'EFTPOS (External)',
    icon: 'contactless-payment',
    color: '#8b5cf6',
    description: 'Payment taken on a separate EFTPOS terminal — log the receipt'
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
    label: 'Fleet Gift Card',
    icon: 'gift-outline',
    color: '#ec4899',
    description: 'AB Taxi-issued gift card code'
  },
];

export default function PaymentCollectionScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { currentJob, pricingBreakdown, pauseRecords, timer, completeJob } = useJob();
  const { location } = useLocation();
  const { selectedTariff } = useShift();
  
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  // Payment state
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [totalMobility, setTotalMobility] = useState(false);
  const [extraAmount, setExtraAmount] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [finalFare, setFinalFare] = useState('0.00');
  
  // ✅ FIX: Preserve initial route params amount so it doesn't get lost on re-renders
  const [initialAmount] = useState(() => {
    const amount = route.params?.amount;
    return amount && amount > 0 ? parseFloat(amount.toString()) : 0;
  });
  
  // Method-specific state
  const [eftposNumber, setEftposNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  
  // Stripe state.
  // `paymentSheetReady` drives UI; `initPromiseRef` lets Confirm await an
  // in-flight initPaymentSheet call so the first tap works. Previously the
  // first Confirm could fire before init resolved, showing an error and only
  // succeeding on the second tap.
  const [paymentSheetReady, setPaymentSheetReady] = useState(false);
  const initPromiseRef = useRef<Promise<boolean> | null>(null);

  // Stripe Terminal (Tap to Pay) state.
  // tapStatus drives the modal UI; connectedReaderRef tracks whether we're
  // already connected so we don't re-discover on every tap.
  const [tapModalVisible, setTapModalVisible] = useState(false);
  const [tapStatus, setTapStatus] = useState<
    'idle' | 'permissions' | 'discovering' | 'connecting' | 'ready' | 'collecting' | 'processing' | 'success' | 'error'
  >('idle');
  const [tapError, setTapError] = useState<string | null>(null);
  const [tapReceipt, setTapReceipt] = useState<{ amount: number; last4?: string; brand?: string } | null>(null);
  const terminalLocationIdRef = useRef<string | null>(null);
  const tapIntentIdRef = useRef<string | null>(null);
  // Mirrors connectedReader so async loops read the latest value instead of
  // the render-time closure.
  const connectedReaderRef = useRef<any>(null);

  const {
    initialize: initializeTerminal,
    discoverReaders,
    connectReader,
    connectedReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    confirmPaymentIntent,
    cancelCollectPaymentMethod,
    disconnectReader,
  } = useStripeTerminal({
    onUpdateDiscoveredReaders: async (readers) => {
      // Tap-to-Pay discovery returns exactly one reader (this device). Connect
      // as soon as we see it; if we're already connected, do nothing.
      if (!readers || readers.length === 0) return;
      if (connectedReaderRef.current) return;
      try {
        const locationId = terminalLocationIdRef.current;
        if (!locationId) return;
        setTapStatus('connecting');
        const { error } = await connectReader({
          discoveryMethod: 'tapToPay',
          reader: readers[0],
          locationId,
          merchantDisplayName: 'AB Taxi',
        });
        if (error) throw new Error(error.message);
        setTapStatus('ready');
      } catch (err: any) {
        setTapStatus('error');
        setTapError(err?.message || 'Failed to connect reader');
      }
    },
  });

  const safeParse = (val: any) => {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return Number.isNaN(val) ? 0 : val;
    const parsed = Number.parseFloat(val.toString());
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  // Calculate total fare dynamically
  useEffect(() => {
    // ✅ FIX: Check multiple sources in priority order (initialAmount FIRST!)
    let baseFare = 0;
    let fareSource = 'none';
    
    // Priority 1: Initial amount from route params (preserved on mount - most reliable)
    if (initialAmount > 0) {
      baseFare = initialAmount;
      fareSource = 'initialAmount (from route.params)';
    }
    // Priority 2: Pricing breakdown (most accurate)
    else if (pricingBreakdown?.totalCost) {
      const val = safeParse(pricingBreakdown.totalCost);
      if (val > 0) {
        baseFare = val;
        fareSource = 'pricingBreakdown';
      }
    }
    // Priority 3: Timer earnings (real-time calculation)
    else if (timer?.earningsSoFar) {
      const val = safeParse(timer.earningsSoFar);
      if (val > 0) {
        baseFare = val;
        fareSource = 'timer.earningsSoFar';
      }
    }
    // Priority 4: Current job fare
    else if (currentJob?.fare) {
      const val = safeParse(currentJob.fare);
      if (val > 0) {
        baseFare = val;
        fareSource = 'currentJob.fare';
      }
    }
    // Priority 5: Current job earningsSoFar
    else if (currentJob?.earningsSoFar) {
      const val = safeParse(currentJob.earningsSoFar);
      if (val > 0) {
        baseFare = val;
        fareSource = 'currentJob.earningsSoFar';
      }
    }

    // ✅ FIX: If all fare sources are 0, fall back to tariff base fare
    // This ensures the minimum charge is always the tariff's base/flag-drop fare
    if (baseFare <= 0) {
      const tariffBaseFare = safeParse(
        selectedTariff?.baseFare ??
        (currentJob as any)?.tariff?.baseFare ??
        (currentJob as any)?.tariff?.base_fare ??
        pricingBreakdown?.startingPrice
      );
      if (tariffBaseFare > 0) {
        baseFare = tariffBaseFare;
        fareSource = 'tariff baseFare (minimum fallback)';
      }
    }
    
    const extra = safeParse(extraAmount);
    const discount = safeParse(discountAmount);

    // Apply Total Mobility 50% discount
    const fareAfterMobility = totalMobility ? baseFare * 0.5 : baseFare;
    
    const calculatedFare = Math.max(0, fareAfterMobility + extra - discount);
    const newFinalFare = calculatedFare.toFixed(2);
    
    // ✅ FIX: Only update if fare actually changed (prevent render loop)
    if (newFinalFare !== finalFare) {
      console.log('💰 Fare Recalculated:', {
        source: fareSource,
        base: baseFare,
        extra,
        discount,
        mobility: totalMobility,
        final: newFinalFare
      });
      setFinalFare(newFinalFare);
    }
  }, [initialAmount, extraAmount, discountAmount, totalMobility, finalFare, pricingBreakdown?.totalCost, pricingBreakdown?.startingPrice, timer?.earningsSoFar, currentJob?.fare, currentJob?.earningsSoFar, selectedTariff?.baseFare]);

  // Total pause time
  const totalPauseSeconds = pauseRecords?.reduce((sum, record) => sum + (record.durationSeconds || 0), 0) || 0;

  // Initialize Stripe Payment Sheet. Returns true when the sheet is ready.
  // We store the in-flight promise in a ref so handleCardPayment can await it
  // if the user taps Confirm before init resolves (otherwise the first tap
  // would fail with "payment sheet not initialized" and only the second
  // succeed).
  const initializePaymentSheet = async (): Promise<boolean> => {
    try {
      const amountCents = Math.round(safeParse(finalFare) * 100);

      const response = await httpClient.post('/payments/create-intent', {
        amount: amountCents,
        currency: CURRENCY_CODE.toLowerCase(),
        jobId: currentJob?.id,
        customerId: currentJob?.customer?.id,
      });

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
        console.error('Error initializing payment sheet:', error);
        Alert.alert('Setup Failed', error.message);
        return false;
      }

      setPaymentSheetReady(true);
      return true;
    } catch (error: any) {
      console.error('Error creating payment intent:', error);
      Alert.alert(
        'Stripe Not Configured',
        'Card payment requires Stripe API keys to be configured.\n\nPlease add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to backend .env file.\n\nFor now, use Cash, EFTPOS, Account, or Gift Card.',
        [{ text: 'OK' }]
      );
      setSelectedMethod(null);
      return false;
    } finally {
      initPromiseRef.current = null;
    }
  };

  // Initialize Stripe when Card is selected
  useEffect(() => {
    if (selectedMethod === 'CARD' && safeParse(finalFare) > 0 && !initPromiseRef.current) {
      setPaymentSheetReady(false);
      initPromiseRef.current = initializePaymentSheet();
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

  // Handle Card Payment with Stripe.
  // If init is still in flight (driver tapped Confirm quickly), await it so
  // the first tap works instead of erroring and forcing a retry.
  const handleCardPayment = async (): Promise<boolean> => {
    try {
      if (!paymentSheetReady) {
        const pending = initPromiseRef.current;
        if (pending) {
          const ok = await pending;
          if (!ok) return false;
        } else {
          // No in-flight init (e.g., finalFare was 0 when selected). Kick one off.
          initPromiseRef.current = initializePaymentSheet();
          const ok = await initPromiseRef.current;
          if (!ok) return false;
        }
      }

      const { error } = await presentPaymentSheet();

      if (error) {
        if (error.code === 'Canceled') {
          return false;
        }
        throw new Error(error.message);
      }

      return true;
    } catch (error: any) {
      console.error('Card payment error:', error);
      Alert.alert('Payment Failed', error.message || 'Card payment could not be processed');
      return false;
    }
  };

  // -------- Tap to Pay (Stripe Terminal) --------

  // Ensure Android runtime perms + Terminal location + a connected reader
  // before we try to collect a tap. Idempotent: safe to call repeatedly.
  const ensureTapToPayReady = async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'android') {
        setTapStatus('permissions');
        const { error: permErr } = await requestNeededAndroidPermissions({
          accessFineLocation: {
            title: 'Location permission',
            message: 'Stripe Tap to Pay requires location to process payments.',
            buttonPositive: 'OK',
          },
        });
        if (permErr) {
          setTapStatus('error');
          setTapError('Location / Bluetooth permissions are required for Tap to Pay.');
          return false;
        }
      }

      if (connectedReaderRef.current) {
        setTapStatus('ready');
        return true;
      }

      // Stripe Terminal requires an explicit SDK initialisation before any
      // discover/connect call. Safe to call repeatedly — it's a no-op after
      // the first success.
      const initResult = await initializeTerminal();
      if (initResult?.error) {
        throw new Error(initResult.error.message || 'Terminal SDK init failed');
      }

      if (!terminalLocationIdRef.current) {
        terminalLocationIdRef.current = await getTerminalLocationId();
      }

      setTapStatus('discovering');
      const { error } = await discoverReaders({
        discoveryMethod: 'tapToPay',
        simulated: false,
      });
      if (error) throw new Error(error.message);
      // onUpdateDiscoveredReaders will flip tapStatus to 'connecting' → 'ready'.
      return true;
    } catch (err: any) {
      setTapStatus('error');
      setTapError(err?.message || 'Tap to Pay setup failed');
      return false;
    }
  };

  const runTapToPayPayment = async (): Promise<boolean> => {
    setTapError(null);
    setTapReceipt(null);
    setTapModalVisible(true);

    const ready = await ensureTapToPayReady();
    if (!ready) return false;

    // Wait (briefly) for the reader to finish connecting if not yet connected.
    // connectedReader updates via the provider.
    const deadline = Date.now() + 15_000;
    while (!connectedReaderRef.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!connectedReaderRef.current) {
      setTapStatus('error');
      setTapError('Could not connect reader in time.');
      return false;
    }

    try {
      const amountCents = Math.round(safeParse(finalFare) * 100);
      if (!amountCents || amountCents <= 0) {
        throw new Error('Fare must be greater than zero.');
      }

      const intent = await createTapToPayIntent({
        amount: amountCents,
        currency: CURRENCY_CODE.toLowerCase(),
        jobId: currentJob?.id,
        customerId: currentJob?.customer?.id,
      });
      tapIntentIdRef.current = intent.paymentIntentId;

      const retrieved = await retrievePaymentIntent(intent.clientSecret);
      if (retrieved.error || !retrieved.paymentIntent) {
        throw new Error(retrieved.error?.message || 'Failed to retrieve PaymentIntent');
      }

      setTapStatus('collecting');
      const collected = await collectPaymentMethod({
        paymentIntent: retrieved.paymentIntent,
        skipTipping: true,
      });
      if (collected.error || !collected.paymentIntent) {
        throw new Error(collected.error?.message || 'Card tap was cancelled');
      }

      setTapStatus('processing');
      const confirmed = await confirmPaymentIntent({
        paymentIntent: collected.paymentIntent,
      });
      if (confirmed.error || !confirmed.paymentIntent) {
        throw new Error(confirmed.error?.message || 'Payment confirmation failed');
      }

      const pi: any = confirmed.paymentIntent;
      const charge = pi.charges?.data?.[0];
      const cardDetails = charge?.paymentMethodDetails?.cardPresent || charge?.payment_method_details?.card_present;
      setTapReceipt({
        amount: (pi.amount || amountCents) / 100,
        last4: cardDetails?.last4,
        brand: cardDetails?.brand,
      });
      setTapStatus('success');
      return true;
    } catch (err: any) {
      setTapStatus('error');
      setTapError(err?.message || 'Tap to Pay failed');
      // Best-effort cancel so the SDK isn't left collecting.
      try { await cancelCollectPaymentMethod(); } catch (_) {}
      return false;
    }
  };

  useEffect(() => {
    connectedReaderRef.current = connectedReader || null;
  }, [connectedReader]);

  // Clean up Terminal connection when leaving the screen.
  useEffect(() => {
    return () => {
      if (connectedReaderRef.current) {
        disconnectReader().catch(() => {});
      }
    };
  }, [disconnectReader]);

  // Validate method-specific requirements.
  // EFTPOS transaction number is optional — drivers often collect the physical
  // receipt instead of typing the TXN number. Account and gift card codes are
  // still required because those are the only way to identify the payer.
  const validatePaymentMethod = (): boolean => {
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
  const toNumeric = (value: number | string | undefined | null, fallback = 0) => {
    if (value === null || value === undefined || value === '') {
      return fallback;
    }
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const buildBreakdownPayload = () => {
    const distanceMeters = toNumeric(timer?.distanceMeters, pricingBreakdown?.totalDistance || 0);
    const elapsedSeconds = toNumeric(timer?.elapsedSeconds, pricingBreakdown?.duration || 0);
    const waitingSeconds = toNumeric(timer?.waitingSeconds, pricingBreakdown?.waitingSeconds || 0);

    const normalizedPricing = pricingBreakdown
      ? {
          startingPrice: toNumeric(pricingBreakdown.startingPrice),
          distanceCost: toNumeric(pricingBreakdown.distanceCost),
          durationCost: toNumeric(pricingBreakdown.durationCost),
          waitingCost: toNumeric(pricingBreakdown.waitingCost),
          totalCost: toNumeric(pricingBreakdown.totalCost),
        }
      : null;

    return {
      totalDistanceMeters: distanceMeters,
      totalDistanceKm: Number((distanceMeters / 1000).toFixed(3)),
      totalDurationSeconds: elapsedSeconds,
      waitingSeconds,
      pricing: normalizedPricing,
    };
  };

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
      if (!currentJob?.id) {
        Alert.alert('Missing Job', 'No active job found for payment.');
        setProcessing(false);
        return;
      }

      const numericFare = toNumeric(finalFare);
      const numericExtra = toNumeric(extraAmount);
      const numericDiscount = toNumeric(discountAmount);

      // Handle Stripe online card payment
      if (selectedMethod === 'CARD') {
        const paymentSuccess = await handleCardPayment();
        if (!paymentSuccess) {
          setProcessing(false);
          return;
        }
      }

      // Handle Stripe Tap to Pay (contactless via driver's phone as reader)
      if (selectedMethod === 'TAP_TO_PAY') {
        const paymentSuccess = await runTapToPayPayment();
        if (!paymentSuccess) {
          setProcessing(false);
          return;
        }
      }

      const breakdownPayload = buildBreakdownPayload();

      // Build payment data
      const paymentData: any = {
        jobId: currentJob.id,
        customerId: currentJob.customer?.id,
        paymentMethod: selectedMethod,
        amount: numericFare,
        baseFare: toNumeric(pricingBreakdown?.startingPrice),
        extraAmount: numericExtra,
        discountAmount: numericDiscount,
        totalMobility,
        adjustmentReason,
        recordedAt: new Date().toISOString(),
        collectedAt: new Date().toISOString(),
        breakdown: breakdownPayload,
        pauseRecords: Array.isArray(pauseRecords) && pauseRecords.length > 0 ? pauseRecords : undefined,
      };

      if (location?.latitude && location?.longitude) {
        paymentData.dropoffLocation = {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          heading: location.heading ?? null,
          speed: location.speed ?? null,
          address:
            currentJob.dropoffAddress ||
            (currentJob as any)?.destination?.address ||
            null,
          timestamp: new Date().toISOString(),
        };
      }

      // Add method-specific data
      if (selectedMethod === 'EFTPOS') {
        paymentData.eftposNumber = eftposNumber;
      } else if (selectedMethod === 'ACCOUNT') {
        paymentData.accountNumber = accountNumber;
      } else if (selectedMethod === 'GIFT_CARD') {
        paymentData.giftCardCode = giftCardCode;
      } else if (selectedMethod === 'TAP_TO_PAY') {
        paymentData.stripePaymentIntentId = tapIntentIdRef.current || undefined;
        paymentData.cardBrand = tapReceipt?.brand || undefined;
        paymentData.cardLast4 = tapReceipt?.last4 || undefined;
      }

      await httpClient.post('/mobile/driver/jobs/payment', paymentData);

      // Complete the job
      await completeJob(selectedMethod, numericFare);
      
      Toast.show({
        type: 'success',
        text1: 'Payment Collected',
        text2: `${CURRENCY_SYMBOL} ${finalFare} via ${PAYMENT_METHODS.find((m) => m.id === selectedMethod)?.label}`,
        position: 'top',
      });

      // After payment succeeds, offer to rate the passenger before going home.
      // The rate screen has its own Skip button, so this never blocks the driver.
      setTimeout(() => {
        // Resolve the jobId from the active job first, then fall back to the
        // navigation params. Previously referenced an undefined `routeJobId`
        // symbol which threw at runtime and aborted the success path.
        const resolvedJobId =
          currentJob?.id ||
          currentJob?.jobId ||
          route.params?.jobId ||
          route.params?.id ||
          '';

        // Resolve customer identity from the active job. Walk-in (guest) jobs
        // have no registered customer row — `currentJob.customer` is null —
        // so there's nothing to rate. Earlier this code referenced bare
        // `customerId` / `customerName` identifiers that were never declared,
        // which threw "ReferenceError: Property 'customerId' doesn't exist"
        // under Hermes and aborted the success path.
        const isWalkIn =
          !!currentJob && (currentJob as any).isWalkIn === true;
        const resolvedCustomerId = currentJob?.customer?.id || null;
        const resolvedCustomerName =
          currentJob?.customer?.name ||
          [currentJob?.customer?.firstName, currentJob?.customer?.lastName]
            .filter(Boolean)
            .join(' ')
            .trim() ||
          (isWalkIn ? 'Walk-in passenger' : null);

        const params: any = { jobId: resolvedJobId };
        if (currentJob?.tripId) params.tripId = currentJob.tripId;
        if (resolvedCustomerId) params.passengerId = resolvedCustomerId;
        if (resolvedCustomerName) params.passengerName = resolvedCustomerName;
        // Forward a flag so RatePassenger can choose to auto-skip or show a
        // simplified "rate the trip" UI instead of a passenger-profile view.
        if (isWalkIn) params.isWalkIn = true;

        // Skip rating screen entirely for walk-ins (no customer record to
        // attach the rating to) OR when we have no customer at all.
        if (params.passengerId) {
          (navigation as any).reset({
            index: 0,
            routes: [{ name: 'Home' }, { name: 'RatePassenger', params }],
          });
        } else {
          navigation.navigate('Home' as never);
        }
      }, 1500);
    } catch (error: any) {
      console.error('Payment error:', error);
      
      // Handle specific error cases
      let errorTitle = 'Payment Failed';
      let errorMessage = 'Please try again or choose a different payment method';
      
      if (error?.response?.status === 403) {
        errorTitle = 'Job Assignment Error';
        errorMessage = error?.response?.data?.message || 
                      'This job is not assigned to you. Please check if you have the correct job selected.';
      } else if (error?.response?.status === 404) {
        errorTitle = 'Job Not Found';
        errorMessage = 'The job could not be found. It may have been cancelled.';
      } else if (error?.response?.status === 400) {
        errorTitle = 'Invalid Payment Data';
        errorMessage = error?.response?.data?.message || 
                      'Missing required payment information. Please check all fields.';
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      Alert.alert(errorTitle, errorMessage, [
        {
          text: 'OK',
          style: 'cancel',
        },
        ...(error?.response?.status === 403 ? [{
          text: 'Go Back',
          onPress: () => navigation.goBack(),
        }] : []),
      ]);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      {/* Compact Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>PAYMENT</Text>
          <Text style={styles.headerJobId}>#{currentJob?.publicJobId || currentJob?.id?.slice(-6)}</Text>
        </View>
        <Icon name="wallet-outline" size={20} color="#fbbf24" />
      </View>

      {/* Main Content - Non-scrolling layout */}
      <View style={styles.mainContent}>
        {/* Large Total Amount */}
        <View style={styles.totalSection}>
          <Text style={styles.totalLabel}>COLLECT</Text>
          <Text style={styles.totalAmount}>{CURRENCY_SYMBOL} {finalFare}</Text>
        </View>

        {/* Compact Fare Summary - Single Row */}
        <View style={styles.fareSummaryRow}>
          <View style={styles.fareSummaryItem}>
            <Text style={styles.fareSummaryValue}>
              {(() => {
                const meters = pricingBreakdown?.totalDistance ?? timer?.distanceMeters ?? 0;
                const km = safeParse(meters) / 1000;
                return km.toFixed(2);
              })()}
            </Text>
            <Text style={styles.fareSummaryLabel}>KM</Text>
          </View>
          <View style={styles.fareSummaryDivider} />
          <View style={styles.fareSummaryItem}>
            <Text style={styles.fareSummaryValue}>
              {(() => {
                const totalSeconds = pricingBreakdown?.duration ?? timer?.elapsedSeconds ?? 0;
                const seconds = safeParse(totalSeconds);
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              })()}
            </Text>
            <Text style={styles.fareSummaryLabel}>MIN</Text>
          </View>
          <View style={styles.fareSummaryDivider} />
          <View style={styles.fareSummaryItem}>
            <Text style={styles.fareSummaryValue}>
              {CURRENCY_SYMBOL} {pricingBreakdown?.totalCost || safeParse(timer?.earningsSoFar || initialAmount).toFixed(2)}
            </Text>
            <Text style={styles.fareSummaryLabel}>METER</Text>
          </View>
        </View>

        {/* Fare Breakdown Section */}
        <View style={styles.fareBreakdownContainer}>
          <View style={styles.fareBreakdownRow}>
            <View style={styles.fareBreakdownItem}>
              <Text style={styles.fareBreakdownLabel}>Distance Cost</Text>
              <Text style={styles.fareBreakdownValue}>
                {CURRENCY_SYMBOL} {safeParse(pricingBreakdown?.distanceCost).toFixed(2)}
              </Text>
            </View>
            <View style={styles.fareBreakdownItem}>
              <Text style={styles.fareBreakdownLabel}>Time Cost</Text>
              <Text style={styles.fareBreakdownValue}>
                {CURRENCY_SYMBOL} {safeParse(pricingBreakdown?.durationCost).toFixed(2)}
              </Text>
            </View>
          </View>
          <View style={styles.fareBreakdownRow}>
            <View style={styles.fareBreakdownItem}>
              <Text style={styles.fareBreakdownLabel}>Wait Cost</Text>
              <Text style={styles.fareBreakdownValue}>
                {CURRENCY_SYMBOL} {safeParse(pricingBreakdown?.waitingCost).toFixed(2)}
              </Text>
            </View>
            <View style={styles.fareBreakdownItem}>
              <Text style={styles.fareBreakdownLabel}>Base Fare</Text>
              <Text style={styles.fareBreakdownValue}>
                {CURRENCY_SYMBOL} {safeParse(pricingBreakdown?.startingPrice).toFixed(2)}
              </Text>
            </View>
          </View>
          {/* Wait Time Display */}
          <View style={styles.fareBreakdownWaitRow}>
            <Text style={styles.fareBreakdownWaitLabel}>Wait Time:</Text>
            <Text style={styles.fareBreakdownWaitValue}>
              {(() => {
                const waitSecs = safeParse(pricingBreakdown?.waitingSeconds ?? timer?.waitingSeconds ?? 0);
                const mins = Math.floor(waitSecs / 60);
                const secs = Math.floor(waitSecs % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
              })()}
            </Text>
          </View>
        </View>

        {/* Compact Adjustments Row */}
        <View style={styles.adjustmentsRow}>
          {/* Total Mobility Toggle */}
          <TouchableOpacity
            style={[styles.adjustmentChip, totalMobility && styles.adjustmentChipActive]}
            onPress={() => setTotalMobility(!totalMobility)}
            activeOpacity={0.7}
          >
            <Icon name="wheelchair-accessibility" size={14} color={totalMobility ? '#fbbf24' : '#666'} />
            <Text style={[styles.adjustmentChipText, totalMobility && styles.adjustmentChipTextActive]}>
              -50%
            </Text>
          </TouchableOpacity>

          {/* Extra Amount */}
          <View style={styles.compactInputWrapper}>
            <Icon name="plus" size={12} color="#666" />
            <Text style={styles.compactCurrency}>$</Text>
            <TextInput
              style={styles.compactInput}
              value={extraAmount}
              onChangeText={setExtraAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#555"
            />
          </View>

          {/* Discount Amount */}
          <View style={styles.compactInputWrapper}>
            <Icon name="minus" size={12} color="#666" />
            <Text style={styles.compactCurrency}>$</Text>
            <TextInput
              style={styles.compactInput}
              value={discountAmount}
              onChangeText={setDiscountAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#555"
            />
          </View>
        </View>

        {/* Compact Payment Methods - All in one row */}
        <View style={styles.methodsRow}>
          {PAYMENT_METHODS.map((method) => (
            <TouchableOpacity
              key={method.id}
              style={[
                styles.methodChip,
                selectedMethod === method.id && styles.methodChipSelected,
                { borderColor: selectedMethod === method.id ? method.color : '#333' }
              ]}
              onPress={() => handleMethodSelect(method.id)}
              activeOpacity={0.7}
            >
              <Icon 
                name={method.icon} 
                size={18} 
                color={selectedMethod === method.id ? method.color : '#888'} 
              />
              <Text style={[
                styles.methodChipLabel,
                selectedMethod === method.id && { color: method.color }
              ]}>
                {method.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Action Buttons - Always visible */}
        <View style={styles.actionsContainer}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            disabled={processing}
          >
            <Icon name="arrow-left" size={18} color="#fff" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.confirmButton,
              (!selectedMethod || processing) && styles.confirmButtonDisabled,
            ]}
            onPress={handlePaymentConfirm}
            disabled={!selectedMethod || processing}
          >
            {processing ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <>
                <Icon name="check-bold" size={18} color="#000" />
                <Text style={styles.confirmButtonText}>Complete Payment</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

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
                {selectedMethod === 'EFTPOS' && 'EFTPOS (External Terminal)'}
                {selectedMethod === 'ACCOUNT' && 'Account Number'}
                {selectedMethod === 'GIFT_CARD' && 'Fleet Gift Card'}
              </Text>
              <TouchableOpacity
                onPress={() => setShowDetailsModal(false)}
                style={styles.modalClose}
              >
                <Icon name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              {selectedMethod === 'EFTPOS' && 'Use this only for a separate/external EFTPOS terminal. For debit cards tapped on this phone, pick Tap to Pay instead. Receipt number is optional.'}
              {selectedMethod === 'ACCOUNT' && 'Enter the customer account number to charge this fare to'}
              {selectedMethod === 'GIFT_CARD' && 'Enter an AB Taxi-issued gift card code. For Visa/Mastercard prepaid gift cards (Apple, AWS, mall cards), use Tap to Pay or Card (Online) instead.'}
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
                  selectedMethod === 'EFTPOS' ? 'Optional — e.g., TXN12345678' :
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

      {/* Tap to Pay modal — state machine UI. The actual card-tap prompt is
          rendered full-screen by the Stripe SDK during collectPaymentMethod. */}
      <Modal
        visible={tapModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (tapStatus === 'success' || tapStatus === 'error' || tapStatus === 'idle') {
            setTapModalVisible(false);
          }
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {tapStatus === 'success' ? 'Payment Received' :
                 tapStatus === 'error' ? 'Tap to Pay Failed' :
                 'Contactless Payment'}
              </Text>
              {(tapStatus === 'success' || tapStatus === 'error') && (
                <TouchableOpacity
                  onPress={() => setTapModalVisible(false)}
                  style={styles.modalClose}
                >
                  <Icon name="close" size={24} color="#6b7280" />
                </TouchableOpacity>
              )}
            </View>

            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              {tapStatus === 'success' ? (
                <Icon name="check-circle" size={64} color="#10b981" />
              ) : tapStatus === 'error' ? (
                <Icon name="alert-circle" size={64} color="#ef4444" />
              ) : (
                <ActivityIndicator size="large" color="#0ea5e9" />
              )}

              <Text style={{ marginTop: 16, fontSize: 16, color: '#374151', textAlign: 'center' }}>
                {tapStatus === 'permissions' && 'Requesting permissions…'}
                {tapStatus === 'discovering' && 'Preparing this phone as a reader…'}
                {tapStatus === 'connecting' && 'Connecting reader…'}
                {tapStatus === 'ready' && 'Ready. Ask customer to hold their card or phone to the back of yours.'}
                {tapStatus === 'collecting' && 'Hold customer’s card or phone to the back of this device.'}
                {tapStatus === 'processing' && 'Processing payment…'}
                {tapStatus === 'success' && tapReceipt && (
                  `${CURRENCY_SYMBOL} ${tapReceipt.amount.toFixed(2)} charged` +
                  (tapReceipt.brand || tapReceipt.last4
                    ? ` · ${tapReceipt.brand || 'card'}${tapReceipt.last4 ? ` ••${tapReceipt.last4}` : ''}`
                    : '')
                )}
                {tapStatus === 'error' && (tapError || 'Something went wrong.')}
              </Text>
            </View>

            {(tapStatus === 'error') && (
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#0ea5e9' }]}
                onPress={() => {
                  setTapStatus('idle');
                  setTapError(null);
                  setTapModalVisible(false);
                }}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    paddingTop: 40,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingBottom: 40,
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
  walletIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Main Content Area
  mainContent: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  // Compact Total Section
  totalSection: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    letterSpacing: 2,
    marginBottom: 4,
  },
  totalAmount: {
    fontSize: 52,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: 'Courier New',
  },
  // Fare Summary Row (KM / MIN / METER)
  fareSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  fareSummaryItem: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  fareSummaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'Courier New',
  },
  fareSummaryLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 1,
    marginTop: 2,
  },
  fareSummaryDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#333',
  },
  // Fare Breakdown Section
  fareBreakdownContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  fareBreakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  fareBreakdownItem: {
    flex: 1,
    alignItems: 'center',
  },
  fareBreakdownLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fareBreakdownValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'Courier New',
  },
  fareBreakdownWaitRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  fareBreakdownWaitLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.5,
  },
  fareBreakdownWaitValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: 'Courier New',
  },
  // Compact Adjustments Row
  adjustmentsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  adjustmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
  },
  adjustmentChipActive: {
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  adjustmentChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#666',
  },
  adjustmentChipTextActive: {
    color: '#fbbf24',
  },
  compactInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
  },
  compactCurrency: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fbbf24',
    fontFamily: 'Courier New',
  },
  compactInput: {
    width: 40,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'Courier New',
    padding: 0,
    textAlign: 'center',
  },
  // Compact Payment Methods Row
  methodsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  methodChip: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#333',
    minWidth: 58,
  },
  methodChipSelected: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
  },
  methodChipLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#888',
    marginTop: 4,
    letterSpacing: 0.3,
  },
  // Actions Container
  actionsContainer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 'auto',
    paddingTop: 16,
    paddingBottom: 20,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#333',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#fbbf24',
    borderRadius: 6,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
  },
  // Modal (Black Theme)
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  modalClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalDescription: {
    fontSize: 12,
    color: '#888',
    lineHeight: 17,
    marginBottom: 16,
  },
  modalInputGroup: {
    marginBottom: 16,
  },
  modalInput: {
    padding: 12,
    backgroundColor: '#000',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#333',
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    fontFamily: 'Courier New',
  },
  modalButton: {
    paddingVertical: 14,
    borderRadius: 4,
    backgroundColor: '#fbbf24',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.5,
  },
});
