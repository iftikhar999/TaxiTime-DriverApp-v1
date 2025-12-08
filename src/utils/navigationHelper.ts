import { Linking, Platform } from "react-native";
import Toast from "react-native-toast-message";

export type NavigationTarget = {
  latitude?: number | null;
  longitude?: number | null;
  label?: string | null;
};

const hasCoordinate = (value?: number | null): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const openExternalNavigation = async (
  target: NavigationTarget | null | undefined,
  options?: { silent?: boolean }
): Promise<boolean> => {
  const silent = options?.silent ?? false;

  if (!target || !hasCoordinate(target.latitude) || !hasCoordinate(target.longitude)) {
    if (!silent) {
      Toast.show({
        type: "info",
        text1: "Destination missing",
        text2: "Add a drop-off to launch navigation.",
      });
    }
    return false;
  }

  const { latitude, longitude, label } = target;
  const preferredUrl = Platform.select({
    ios: `maps://app?daddr=${latitude},${longitude}`,
    android: `google.navigation:q=${latitude},${longitude}`,
  });
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;

  const openUrl = async (url?: string | null) => {
    if (!url) {
      return false;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        return false;
      }
      await Linking.openURL(url);
      return true;
    } catch (error) {
      console.warn("Failed to open navigation URL:", url, error);
      return false;
    }
  };

  const openedPreferred = await openUrl(preferredUrl);
  if (openedPreferred) {
    if (!silent) {
      Toast.show({
        type: "success",
        text1: "Navigation",
        text2: label ? `Guiding to ${label}` : "Opening external navigation app",
      });
    }
    return true;
  }

  const openedFallback = await openUrl(fallbackUrl);
  if (openedFallback) {
    if (!silent) {
      Toast.show({
        type: "success",
        text1: "Navigation",
        text2: "Opening Google Maps",
      });
    }
    return true;
  }

  if (!silent) {
    Toast.show({
      type: "error",
      text1: "Navigation unavailable",
      text2: "Install Google Maps or try again later.",
    });
  }
  return false;
};
