import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
import { Colors } from '../theme/colors';
import { RideSummary } from '../types/rides';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

export type AppStackParamList = {
  Home: undefined;
  TariffSelection: {
    vehicleId: string;
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
  </AppStack.Navigator>
);

const RootNavigator = () => {
  const { isAuthenticated, loading } = useAuth();
  const { currentJob, status } = useJob();
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const hasRestoredJob = useRef(false);

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
    <NavigationContainer ref={navigationRef} key={isAuthenticated ? 'app' : 'auth'}>
      {isAuthenticated ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
};

export default RootNavigator;
