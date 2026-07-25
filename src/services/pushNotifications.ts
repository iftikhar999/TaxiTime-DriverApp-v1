/**
 * Firebase Cloud Messaging (FCM) setup for the driver app.
 *
 * Responsibilities:
 *   1. Request permission (Android 13+ needs POST_NOTIFICATIONS).
 *   2. Fetch the FCM token and register it with the backend.
 *   3. Subscribe to foreground / background / quit-state message handlers.
 *   4. Re-register on token rotation.
 *
 * The backend stores the token under user.preferences.fcmToken and uses
 * `firebase-admin` to send push when the app is backgrounded or closed.
 */
import { Platform, PermissionsAndroid, AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../config/environment';

const FCM_TOKEN_KEY = '@driver_fcm_token';

/** Ask Android 13+ for POST_NOTIFICATIONS permission. */
const requestAndroidPushPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android' || Platform.Version < 33) return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    console.warn('[FCM] POST_NOTIFICATIONS request failed:', err);
    return false;
  }
};

/** Ask iOS/firebase for authorisation. */
const requestUserPermission = async (): Promise<boolean> => {
  const androidOk = await requestAndroidPushPermission();
  if (!androidOk) {
    console.log('[FCM] Android notification permission denied');
    return false;
  }
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;
  return enabled;
};

/** POST the token to /api/notifications/register-device so the backend can push to it. */
const registerTokenWithBackend = async (token: string, authToken: string | null) => {
  if (!authToken) {
    console.log('[FCM] No auth token yet — skipping backend register');
    return;
  }
  try {
    await axios.post(
      `${API_BASE_URL}/notifications/register-device`,
      { fcmToken: token, platform: Platform.OS },
      { headers: { Authorization: `Bearer ${authToken}` } },
    );
    console.log('[FCM] Token registered with backend');
  } catch (err: any) {
    console.warn('[FCM] Backend token-registration failed:', err?.message);
  }
};

/**
 * Call this AFTER login (when we have the auth token). Idempotent.
 */
export const initPushNotifications = async (authToken: string | null): Promise<string | null> => {
  try {
    const ok = await requestUserPermission();
    if (!ok) return null;

    const token = await messaging().getToken();
    if (!token) {
      console.warn('[FCM] getToken returned empty');
      return null;
    }

    const cached = await AsyncStorage.getItem(FCM_TOKEN_KEY);
    if (cached !== token) {
      await AsyncStorage.setItem(FCM_TOKEN_KEY, token);
      await registerTokenWithBackend(token, authToken);
    } else if (authToken) {
      // Re-register each login so the backend updates the user<->token mapping
      await registerTokenWithBackend(token, authToken);
    }

    // Token may rotate over time — re-register when it does
    messaging().onTokenRefresh(async (newToken) => {
      console.log('[FCM] token refreshed');
      await AsyncStorage.setItem(FCM_TOKEN_KEY, newToken);
      await registerTokenWithBackend(newToken, authToken);
    });

    return token;
  } catch (err: any) {
    console.warn('[FCM] init failed:', err?.message);
    return null;
  }
};

/**
 * Register foreground + quit-state handlers. Call ONCE at app start.
 * Background handler must be registered at the top of index.js (AppRegistry
 * runs it in a headless JS context when a push arrives while the app is killed).
 */
export const setupForegroundHandlers = (onMessage?: (m: any) => void) => {
  return messaging().onMessage(async (remoteMessage) => {
    console.log('[FCM] Foreground message:', remoteMessage?.notification?.title);
    if (onMessage) onMessage(remoteMessage);
  });
};

/** Check if the app was opened by tapping a notification. */
export const getInitialNotification = async () => {
  return messaging().getInitialNotification();
};

/** Subscribe to notification taps while app is in background (but not killed). */
export const onNotificationOpenedApp = (handler: (msg: any) => void) => {
  return messaging().onNotificationOpenedApp(handler);
};

// Register the headless background handler name so index.js can point at it.
export const BACKGROUND_MESSAGE_HANDLER_NAME = 'driverBackgroundMessage';

/**
 * Call from index.js BEFORE AppRegistry.registerComponent:
 *   import { registerBackgroundHandler } from './src/services/pushNotifications';
 *   registerBackgroundHandler();
 */
export const registerBackgroundHandler = () => {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('[FCM] Background message:', remoteMessage?.notification?.title);
    // If we need to do work here (e.g. local DB write, local notification
    // display), do it fast (<10s) and return. Android shuts down the JS VM
    // afterwards.
  });
};
