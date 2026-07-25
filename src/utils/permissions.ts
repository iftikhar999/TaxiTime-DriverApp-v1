import { PermissionsAndroid, Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import { ensureOverlayPermission } from '../native/locationService';

const BASE_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
].filter((permission): permission is string => Boolean(permission));

const BACKGROUND_PERMISSION = PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION;
const NOTIFICATION_PERMISSION = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

const requestIfNeeded = async (permission?: string): Promise<boolean> => {
  if (!permission) {
    const overlayGranted = await ensureOverlayPermission();
    if (!overlayGranted) {
      Toast.show({
        type: 'error',
        text1: 'Overlay permission',
        text2: 'Enable “display over other apps” for TaxiTime Driver, then try again.'
      });
      return false;
    }

    return true;
  }

  const alreadyGranted = await PermissionsAndroid.check(permission);
  if (alreadyGranted) {
    return true;
  }

  try {
    const result = await PermissionsAndroid.request(permission);
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (error) {
    console.error(`Permission request failed for ${permission}`, error);
    return false;
  }
};

export const requestAllPermissions = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') {
    return true;
  }

  try {
    const toRequest: string[] = [];

    for (const permission of BASE_PERMISSIONS) {
      const granted = await PermissionsAndroid.check(permission);
      if (!granted) {
        toRequest.push(permission);
      }
    }

    if (Platform.Version >= 33 && NOTIFICATION_PERMISSION) {
      const hasNotification = await PermissionsAndroid.check(NOTIFICATION_PERMISSION);
      if (!hasNotification) {
        toRequest.push(NOTIFICATION_PERMISSION);
      }
    }

    if (toRequest.length > 0) {
      const result = await PermissionsAndroid.requestMultiple(toRequest);
      const deniedEntries = Object.entries(result).filter(
        ([, value]) => value !== PermissionsAndroid.RESULTS.GRANTED
      );

      const hardDenied = deniedEntries
        .map(([key]) => key)
        .filter((key) => key !== NOTIFICATION_PERMISSION);

      if (hardDenied.length > 0) {
        Toast.show({
          type: 'error',
          text1: 'Permissions required',
          text2: 'Please grant location access to continue.'
        });
        return false;
      }

      if (
        deniedEntries.some(([key]) => key === NOTIFICATION_PERMISSION)
      ) {
        Toast.show({
          type: 'info',
          text1: 'Notifications disabled',
          text2: 'Enable notifications later to receive live job alerts.'
        });
      }
    }

    if (Platform.Version >= 29) {
      const backgroundGranted = await requestIfNeeded(BACKGROUND_PERMISSION);
      if (!backgroundGranted) {
        Toast.show({
          type: 'info',
          text1: 'Background location disabled',
          text2: 'Grant background access later to keep tracking when the app is closed.'
        });
      }
    }

    return true;
  } catch (error) {
    console.error('Permission request failed', error);
    Toast.show({
      type: 'error',
      text1: 'Permissions',
      text2: 'Unable to request permissions.'
    });
    return false;
  }
};

// Camera runtime permission (needed before launchCamera on Android 6+).
export const ensureCameraPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  const perm = PermissionsAndroid.PERMISSIONS.CAMERA;
  const already = await PermissionsAndroid.check(perm);
  if (already) return true;
  try {
    const res = await PermissionsAndroid.request(perm, {
      title: 'Camera access',
      message: 'TaxiTime Driver needs camera access to capture document photos.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });
    if (res === PermissionsAndroid.RESULTS.GRANTED) return true;
    Toast.show({
      type: 'error',
      text1: 'Camera blocked',
      text2:
        res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? 'Enable Camera for TaxiTime Driver in Settings → Apps, then try again.'
          : 'Camera access was denied. Tap Allow next time to capture a photo.',
      visibilityTime: 5000,
    });
    return false;
  } catch (error) {
    console.error('Camera permission request failed', error);
    return false;
  }
};

// Gallery / photo-library runtime permission. On Android 13+ (API 33) the
// scoped READ_MEDIA_IMAGES replaces READ_EXTERNAL_STORAGE. react-native-image-
// picker itself handles the picker intent, but if the OS prompts at all we
// surface a clean, consistent toast on denial.
export const ensureMediaLibraryPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return true;
  const perm =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
  if (!perm) return true;
  const already = await PermissionsAndroid.check(perm);
  if (already) return true;
  try {
    const res = await PermissionsAndroid.request(perm, {
      title: 'Photos access',
      message: 'TaxiTime Driver needs access to your photos so you can attach documents.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    });
    if (res === PermissionsAndroid.RESULTS.GRANTED) return true;
    Toast.show({
      type: 'error',
      text1: 'Photos blocked',
      text2:
        res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? 'Enable Photos for TaxiTime Driver in Settings → Apps, then try again.'
          : 'Photos access was denied. Tap Allow next time to pick an image.',
      visibilityTime: 5000,
    });
    return false;
  } catch (error) {
    console.error('Media permission request failed', error);
    return false;
  }
};
