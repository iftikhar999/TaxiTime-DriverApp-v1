import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { navigationRef as sharedNavRef } from './navigationRef';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import { useAuth } from '../context/AuthContext';
import { useJob } from '../context/JobContext';
import LoginScreen from '../screens/Auth/LoginScreen';
import RegisterScreen from '../screens/Auth/RegisterScreen';
import HomeScreen from '../screens/Home/HomeScreen';
import ActiveRideScreen from '../screens/Jobs/ActiveRideScreen'; // ✅ RESTORED: This is the one we want!
import EnhancedJobTrackingScreen from '../screens/Jobs/EnhancedJobTrackingScreen';
import JobOfferScreen from '../screens/Jobs/JobOfferScreen';
import JobPausedScreen from '../screens/Jobs/JobPausedScreen';
// import JobProgressScreen from '../screens/Jobs/JobProgressScreen'; // ✅ ARCHIVED: User doesn't want this one
import PaymentCollectionScreen from '../screens/Jobs/PaymentCollectionScreen';
import TariffSelectionScreen from '../screens/Shift/TariffSelectionScreen';
import JobHistoryScreen from '../screens/Wallet/JobHistoryScreen';
import WalletScreen from '../screens/Wallet/WalletScreen';
import PassengerChatScreen from '../screens/Chat/PassengerChatScreen';
import DispatcherChatScreen from '../screens/Chat/DispatcherChatScreen';
import DocumentsScreen from '../screens/Profile/DocumentsScreen';
import { Colors } from '../theme/colors';
import { RideSummary } from '../types/rides';
import ActiveJobResumeBanner from '../components/ActiveJobResumeBanner';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  TariffSelection: {
    vehicleId?: string;
    mode?: 'start' | 'change';
  };
  JobOffer: {
    job: RideSummary;
  };
  // JobProgress: undefined; // ✅ ARCHIVED: User doesn't want this screen
  EnhancedJobTracking: undefined;
  ActiveRide: undefined; // ✅ RESTORED: This is the screen user wants!
  JobPaused: undefined;
  PaymentCollection: {
    jobId: string;
    amount: number;
    customerId?: string | null;
    customerName?: string;
    driverId?: string;
  };
  Wallet: undefined;
  JobHistory: undefined;
  PassengerChat: {
    jobId: string;
    passengerId: string;
    passengerName?: string;
  };
  DispatcherChat: undefined;
  RatePassenger: {
    jobId: string;
    tripId?: string;
    passengerId: string;
    passengerName?: string;
  };
  Documents: undefined;
  Profile: undefined;
  OperatingPrinciples: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

const AuthNavigator = () => (
  <AuthStack.Navigator>
    <AuthStack.Screen
      name="Login"
      component={LoginScreen}
      options={{ headerShown: false }}
    />
    <AuthStack.Screen
      name="Register"
      component={RegisterScreen}
      options={{ headerShown: false }}
    />
  </AuthStack.Navigator>
);

const AppNavigator = () => (
  <AppStack.Navigator>
    <AppStack.Screen
      name="Home"
      component={HomeScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="TariffSelection"
      component={TariffSelectionScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="JobOffer"
      component={JobOfferScreen}
      options={{ headerShown: false }}
    />
    {/* ✅ ARCHIVED: User doesn't want this screen - using ActiveRide instead
    <AppStack.Screen
      name="JobProgress"
      component={JobProgressScreen}
      options={{ headerShown: false }}
    />
    */}
    <AppStack.Screen
      name="EnhancedJobTracking"
      component={EnhancedJobTrackingScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="ActiveRide"
      component={ActiveRideScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="JobPaused"
      component={JobPausedScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="PaymentCollection"
      component={PaymentCollectionScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="Wallet"
      component={WalletScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="JobHistory"
      component={JobHistoryScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="PassengerChat"
      component={PassengerChatScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="DispatcherChat"
      component={DispatcherChatScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="RatePassenger"
      component={require('../screens/Rate/RatePassengerScreen').default}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="Documents"
      component={DocumentsScreen}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="Profile"
      component={require('../screens/Profile/ProfileScreen').default}
      options={{ headerShown: false }}
    />
    <AppStack.Screen
      name="OperatingPrinciples"
      component={require('../screens/Policies/OperatingPrinciplesScreen').default}
      options={{ headerShown: false }}
    />
  </AppStack.Navigator>
);

const RootNavigator = () => {
  const { isAuthenticated, loading } = useAuth();
  const { currentJob, status } = useJob();
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const hasRestoredJob = useRef(false);

  // ─────────────────────────────────────────────────────────────────────
  // 🔔 FCM tap handling — route to JobOffer when user taps a job push
  //
  // Two entry points:
  //   1. `getInitialNotification()` — fires once on app start if the user
  //      tapped an FCM notification to open the app FROM KILLED state.
  //   2. `onNotificationOpenedApp()` — fires every time the user taps an
  //      FCM notification to bring a BACKGROUNDED app back to foreground.
  //
  // Both expect `data.type === 'NEW_JOB_OFFER'` with jobId + pickup/dropoff
  // fields sent by backend `sendJobOfferPushToDriver`. We navigate to the
  // JobOffer screen regardless of which state we were in.
  // ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;

    const handleJobOfferTap = (remoteMessage: any) => {
      const data = remoteMessage?.data || {};
      if (data.type !== 'NEW_JOB_OFFER') return;
      const jobId = data.jobId || data.publicJobId;
      if (!jobId) return;
      try {
        navigationRef.current?.navigate('JobOffer', {
          job: {
            id: data.jobId,
            jobId: data.publicJobId || data.jobId,
            pickupAddress: data.pickupAddress,
            dropoffAddress: data.dropoffAddress,
            pickupLatitude: data.pickupLatitude ? Number(data.pickupLatitude) : undefined,
            pickupLongitude: data.pickupLongitude ? Number(data.pickupLongitude) : undefined,
            estimatedFare: data.estimatedFare ? Number(data.estimatedFare) : 0,
            vehicleType: data.vehicleType,
            serviceType: data.serviceType,
          } as any,
        });
      } catch (err) {
        console.warn('[FCM] Failed to navigate to JobOffer from push tap:', err);
      }
    };

    // Case 1: app opened from killed state by tapping a notification
    messaging()
      .getInitialNotification()
      .then((msg) => { if (msg) handleJobOfferTap(msg); })
      .catch(() => {});

    // Case 2: app in background, tapped → brought to foreground
    const unsub = messaging().onNotificationOpenedApp(handleJobOfferTap);
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [isAuthenticated]);

  // ✅ DISABLED: Auto-navigation on restore - HomeScreen handles this based on job status
  // This was causing the wrong screen to appear after the correct one loaded
  /*
  useEffect(() => {
    if (hasRestoredJob.current || !isAuthenticated || !currentJob) return;

    // Check if job is in an active state (not completed/rejected/cancelled)
    const activeStatuses = ['ASSIGNED', 'ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'STARTED', 'ACTIVE', 'REACHED'];

    if (activeStatuses.includes(status)) {
      // Wait for navigation to be ready
      const timer = setTimeout(() => {
        if (navigationRef.current?.isReady()) {
          console.log('🔄 Restoring active job screen:', {
            jobId: currentJob.id,
            status,
            timer: { ...currentJob },
          });

          hasRestoredJob.current = true;
          navigationRef.current?.navigate('ActiveRide');
        }
      }, 800); // Wait for navigation to fully initialize

      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, currentJob, status]);
  */

  if (loading) {
    return (
      <NavigationContainer>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface.default }}>
          <ActivityIndicator size="large" color={Colors.primary[600]} />
        </View>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer
      ref={(ref) => {
        navigationRef.current = ref;
        (sharedNavRef as any).current = ref;
      }}
      key={isAuthenticated ? 'app' : 'auth'}>
      {isAuthenticated ? <AppNavigator /> : <AuthNavigator />}
      {/* Floating "Resume active job" affordance — visible on every non-job
          screen whenever the driver has an in-progress job. Must be a sibling
          of the navigator, not inside it, so it can overlay any screen. */}
      {isAuthenticated ? <ActiveJobResumeBanner /> : null}
    </NavigationContainer>
  );
};

export default RootNavigator;
