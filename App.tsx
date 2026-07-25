import { StripeProvider } from '@stripe/stripe-react-native';
import { StripeTerminalProvider } from '@stripe/stripe-terminal-react-native';
import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import ErrorBoundary from './src/components/ErrorBoundary';
import { ThemedAlertProvider } from './src/components/ThemedAlert';
import { toastConfig } from './src/components/toastConfig';
import { getStripePublishableKey } from './src/config/stripe';
import { tokenProvider } from './src/services/stripeTerminalService';
import { AuthProvider } from './src/context/AuthContext';
import { JobProvider } from './src/context/JobContext';
import { JobQueueProvider } from './src/context/JobQueueContext';
import { LocationProvider } from './src/context/LocationContext';
import { ShiftProvider } from './src/context/ShiftContext';
import { UnreadDispatcherProvider } from './src/context/UnreadDispatcherContext';
import { ZoneProvider } from './src/context/ZoneContext';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { Colors } from './src/theme/colors';

function App(): React.ReactElement {
  return (
    // SafeAreaProvider must wrap the whole tree so every screen's
    // useSafeAreaInsets / SafeAreaView gets correct top + bottom values
    // for the status bar / notch / system gesture bar. Without this
    // the insets default to {top:0, bottom:0} and the top bar bleeds
    // over the screen header.
    <SafeAreaProvider>
      <ErrorBoundary>
        <StripeProvider
          publishableKey={getStripePublishableKey()}
          merchantIdentifier="merchant.com.abtaxi.driver"
          urlScheme="abtaxi-driver"
        >
          <StripeTerminalProvider
            tokenProvider={tokenProvider}
            logLevel="verbose"
          >
          <ThemeProvider>
            <AuthProvider>
              <ShiftProvider>
                <LocationProvider>
                  <ZoneProvider>
                    <JobProvider>
                      <JobQueueProvider>
                        <UnreadDispatcherProvider>
                          <ThemedAlertProvider>
                            <StatusBar barStyle="light-content" backgroundColor={Colors.primary[900]} />
                            <RootNavigator />
                            <Toast config={toastConfig} />
                          </ThemedAlertProvider>
                        </UnreadDispatcherProvider>
                      </JobQueueProvider>
                    </JobProvider>
                  </ZoneProvider>
                </LocationProvider>
              </ShiftProvider>
            </AuthProvider>
          </ThemeProvider>
          </StripeTerminalProvider>
        </StripeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

export default App;
