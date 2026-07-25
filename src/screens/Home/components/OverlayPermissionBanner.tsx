/**
 * OverlayPermissionBanner
 *
 * Persistent red banner shown on the driver Home screen until the user
 * has granted "Display over other apps" + "Battery optimisation
 * exemption". Without those two, Android 10+ silently ignores our
 * `startActivity` calls when a job offer arrives — the notification
 * fires + chime plays, but the app never pulls up. We re-poll every
 * 3 s while the screen is mounted so the banner self-clears as soon as
 * the user toggles the setting and returns to the app.
 */
import React, { useEffect, useState } from 'react';
import { AppState, Linking, NativeModules, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';

type Status = {
  hasOverlay: boolean;
  ignoresBattery: boolean;
};

const POLL_MS = 3000;

const checkStatus = async (): Promise<Status> => {
  const { AppBringToFront } = NativeModules || {};
  if (!AppBringToFront) return { hasOverlay: true, ignoresBattery: true };
  try {
    const [hasOverlay, ignoresBattery] = await Promise.all([
      AppBringToFront.hasOverlayPermission?.() ?? Promise.resolve(true),
      AppBringToFront.isBatteryOptimizationIgnored?.() ?? Promise.resolve(true),
    ]);
    return { hasOverlay: !!hasOverlay, ignoresBattery: !!ignoresBattery };
  } catch {
    return { hasOverlay: true, ignoresBattery: true };
  }
};

export const OverlayPermissionBanner: React.FC = () => {
  const [status, setStatus] = useState<Status>({ hasOverlay: true, ignoresBattery: true });

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const next = await checkStatus();
      if (mounted) setStatus(next);
    };
    refresh();
    const id = setInterval(refresh, POLL_MS);
    // Re-check the moment the user comes back from the Settings page.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      mounted = false;
      clearInterval(id);
      sub.remove();
    };
  }, []);

  const allGood = status.hasOverlay && status.ignoresBattery;
  if (allGood) return null;

  const requestOverlay = () => {
    const { AppBringToFront } = NativeModules || {};
    AppBringToFront?.requestOverlayPermission?.().catch(() => {
      // Fallback: deep-link to app settings if the specific intent fails
      Linking.openSettings().catch(() => {});
    });
  };
  const requestBattery = () => {
    const { AppBringToFront } = NativeModules || {};
    AppBringToFront?.requestBatteryOptimizationExemption?.().catch(() => {
      Linking.openSettings().catch(() => {});
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <MCIcon name="alert-octagon" size={22} color="#fff" />
        <Text style={styles.title}>Permission needed for job alerts</Text>
      </View>
      <Text style={styles.body}>
        Without these, the app won't pop up when a new job comes in — you'll only hear the chime.
      </Text>
      <View style={styles.buttonRow}>
        {!status.hasOverlay && (
          <TouchableOpacity style={styles.button} onPress={requestOverlay} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Allow display over other apps</Text>
          </TouchableOpacity>
        )}
        {!status.ignoresBattery && (
          <TouchableOpacity style={styles.button} onPress={requestBattery} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Disable battery optimisation</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#dc2626',
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 4,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 8 },
  body: { color: 'rgba(255,255,255,0.9)', fontSize: 12, marginTop: 4 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  button: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  buttonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});

export default OverlayPermissionBanner;
