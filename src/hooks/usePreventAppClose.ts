/**
 * Hook to prevent app from being closed when driver has active shift
 * Only allows closure when:
 * 1. Driver ends shift AND logs out
 * 2. App is force-closed by system/user
 */

import { useEffect } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';
import { ActiveShift } from '../types/shift';

interface UsePreventAppCloseOptions {
  activeShift: ActiveShift | null;
  onEndShift?: () => void;
  onLogout?: () => void;
}

export const usePreventAppClose = ({
  activeShift,
  onEndShift,
  onLogout,
}: UsePreventAppCloseOptions) => {
  useEffect(() => {
    // Only prevent closure on Android (iOS has different app lifecycle)
    if (Platform.OS !== 'android') {
      return;
    }

    const backAction = () => {
      // If no active shift, allow normal back navigation
      if (!activeShift) {
        return false; // Allow default back behavior
      }

      // If active shift exists, show warning
      Alert.alert(
        '⚠️ Active Shift Running',
        'You have an active shift. Closing the app may cause you to miss job assignments.\n\nTo close the app safely:',
        [
          {
            text: 'Stay Online',
            onPress: () => null,
            style: 'cancel',
          },
          {
            text: 'End Shift & Logout',
            onPress: () => {
              Alert.alert(
                'End Shift?',
                'Are you sure you want to end your shift and logout?',
                [
                  {
                    text: 'Cancel',
                    style: 'cancel',
                  },
                  {
                    text: 'Yes, End Shift',
                    style: 'destructive',
                    onPress: async () => {
                      console.log('🛑 User confirmed shift end and logout');
                      if (onEndShift) {
                        await onEndShift();
                      }
                      if (onLogout) {
                        await onLogout();
                      }
                    },
                  },
                ],
              );
            },
            style: 'destructive',
          },
          {
            text: 'Minimize App',
            onPress: () => {
              // Move app to background instead of closing
              BackHandler.exitApp();
            },
          },
        ],
        { cancelable: true }
      );

      return true; // Prevent default back behavior
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [activeShift, onEndShift, onLogout]);
};

