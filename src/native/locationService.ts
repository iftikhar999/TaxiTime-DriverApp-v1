import {
  DeviceEventEmitter,
  EmitterSubscription,
  NativeModules,
} from "react-native";

type LocationServiceNativeModule = {
  startService?: () => Promise<void>;
  stopService?: () => Promise<void>;
  checkOverlayPermission?: () => Promise<boolean>;
  requestOverlayPermission?: () => Promise<boolean>;
  updateLocationInterval?: (intervalSeconds: number) => Promise<void>;
};

const LocationServiceModule =
  NativeModules.LocationServiceModule as LocationServiceNativeModule;

export type LocationUpdate = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number;
};

if (!LocationServiceModule) {
  console.warn("LocationServiceModule native module not found");
}

export const startLocationService = async (): Promise<void> => {
  if (!LocationServiceModule?.startService) {
    return;
  }
  await LocationServiceModule.startService();
};

export const stopLocationService = async (): Promise<void> => {
  if (!LocationServiceModule?.stopService) {
    return;
  }
  await LocationServiceModule.stopService();
};

export const subscribeToLocations = (
  listener: (update: LocationUpdate) => void
): EmitterSubscription => {
  return DeviceEventEmitter.addListener("DriverLocationUpdate", listener);
};

export const ensureOverlayPermission = async (): Promise<boolean> => {
  if (!LocationServiceModule?.checkOverlayPermission) {
    return true;
  }

  const hasPermission = await LocationServiceModule.checkOverlayPermission();
  if (hasPermission) {
    return true;
  }

  await LocationServiceModule.requestOverlayPermission?.();
  return false;
};

export const updateLocationInterval = async (
  intervalSeconds: number
): Promise<void> => {
  if (!LocationServiceModule?.updateLocationInterval) {
    console.warn("updateLocationInterval not available on this platform");
    return;
  }
  await LocationServiceModule.updateLocationInterval(intervalSeconds);
};
