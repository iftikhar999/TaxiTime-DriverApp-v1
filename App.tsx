import { StripeProvider } from '@stripe/stripe-react-native';
import React from 'react';
import { StatusBar } from 'react-native';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import { toastConfig } from './src/components/toastConfig';
import { getStripePublishableKey } from './src/config/stripe';
import { AuthProvider } from './src/context/AuthContext';
import { JobProvider } from './src/context/JobContext';
import { JobQueueProvider } from './src/context/JobQueueContext';
import { LocationProvider } from './src/context/LocationContext';
import { ShiftProvider } from './src/context/ShiftContext';
import { ZoneProvider } from './src/context/ZoneContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { Colors } from './src/theme/colors';

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
                    <JobQueueProvider>
                      <StatusBar barStyle="light-content" backgroundColor={Colors.primary[900]} />
                      <RootNavigator />
                      <Toast config={toastConfig} />
                    </JobQueueProvider>
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
