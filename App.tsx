import React from 'react';
import { StatusBar } from 'react-native';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { Colors } from './src/theme/colors';
import { AuthProvider } from './src/context/AuthContext';
import { ShiftProvider } from './src/context/ShiftContext';
import { JobProvider } from './src/context/JobContext';
import { LocationProvider } from './src/context/LocationContext';
import { ZoneProvider } from './src/context/ZoneContext';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import { StripeProvider } from '@stripe/stripe-react-native';
import { getStripePublishableKey } from './src/config/stripe';

function App(): React.ReactElement {
  return (
    <ErrorBoundary>
      <StripeProvider
        publishableKey={getStripePublishableKey()}
        merchantIdentifier="merchant.com.abtaxi.driver"
        urlScheme="abtaxi-driver"
      >
        <ThemeProvider>
          <AuthProvider>
            <ShiftProvider>
              <LocationProvider>
                <ZoneProvider>
                  <JobProvider>
                    <StatusBar barStyle="light-content" backgroundColor={Colors.primary[900]} />
                    <RootNavigator />
                    <Toast />
                  </JobProvider>
                </ZoneProvider>
              </LocationProvider>
            </ShiftProvider>
          </AuthProvider>
        </ThemeProvider>
      </StripeProvider>
    </ErrorBoundary>
  );
}

export default App;
