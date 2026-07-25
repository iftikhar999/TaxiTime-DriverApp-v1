import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { Alert } from "react-native";
import {
    login as loginService,
    logout as logoutService,
    registerDriver,
    RegisterPayload,
} from "../services/authService";
import { clearAllAppCache } from "../services/cacheCleanup";
import { fetchDriverProfile } from "../services/driverService";
import { registerKickedListener } from "../services/driverSocket";
import { registerLogoutCallback } from "../services/httpClient";
import { DriverProfile } from "../types/driver";

interface AuthContextValue {
  loading: boolean;
  isAuthenticated: boolean;
  token: string | null;
  driver: DriverProfile | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refreshDriver: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  isAuthenticated: false,
  token: null,
  driver: null,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  refreshDriver: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverProfile | null>(null);

  const loadStoredSession = useCallback(async () => {
    try {
      const [storedToken, storedDriver] = await Promise.all([
        AsyncStorage.getItem("authToken"),
        AsyncStorage.getItem("driverProfile"),
      ]);

      if (storedToken) {
        setToken(storedToken);
      }

      // ✅ FIX: Always refresh profile from server if we have a token
      // This ensures we get latest data including companyId
      if (storedToken) {
        try {
          console.log("🔄 Refreshing driver profile from server...");
          const profile = await fetchDriverProfile();
          setDriver(profile);
          await AsyncStorage.setItem("driverProfile", JSON.stringify(profile));
          console.log("✅ Driver profile refreshed:", {
            id: profile.id,
            email: profile.email,
            companyId: profile.companyId,
            hasCompany: !!profile.company
          });
        } catch (error) {
          console.error(
            "Failed to fetch driver profile during bootstrap",
            error
          );
          // Fallback to cached profile if server fetch fails
          if (storedDriver) {
            console.log("⚠️ Using cached driver profile as fallback");
            setDriver(JSON.parse(storedDriver));
          }
        }
      } else if (storedDriver) {
        // No token but have cached profile (shouldn't happen normally)
        setDriver(JSON.parse(storedDriver));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStoredSession().catch((error) => {
      console.error("Bootstrap session error", error);
      setLoading(false);
    });
  }, [loadStoredSession]);

  // Whenever we hold a valid session (fresh login OR rehydrated from
  // AsyncStorage on app start), ensure the notifee keep-alive service is
  // running. This is what stops Android freezing the JS thread when the
  // app goes to background — socket.io stays connected, dispatcher
  // messages fire in real time, and we can display the HIGH-importance
  // heads-up without depending on FCM.
  useEffect(() => {
    if (!token || !driver) return;
    let cancelled = false;
    (async () => {
      try {
        const { startBackgroundKeepalive, primeNotificationPermission } = await import('../services/localNotifications');
        if (cancelled) return;
        // Prime permission from foreground — safe on re-login / rehydrate.
        primeNotificationPermission().catch(() => {});
        const label = driver?.firstName
          ? `${driver.firstName}${driver.lastName ? ` ${driver.lastName}` : ''}`
          : undefined;
        await startBackgroundKeepalive(label);

        // Make sure the OS-level "show on top of other apps" permission
        // is granted. Without it, our `bringToFront` call after a job
        // offer is silently ignored on Android 10+, so the driver only
        // ever hears the notification sound — the app never opens. We
        // ask once per app session (the OS settings page is a hard
        // manual-grant flow, can't be done programmatically).
        try {
          const { NativeModules, Alert, Linking } = require('react-native');
          const { AppBringToFront } = NativeModules || {};
          if (AppBringToFront?.hasOverlayPermission) {
            const hasOverlay = await AppBringToFront.hasOverlayPermission();
            if (!hasOverlay) {
              Alert.alert(
                'Allow display over other apps',
                'Grant this so new job offers pop up immediately even when you\'re on another screen.',
                [
                  { text: 'Later', style: 'cancel' },
                  {
                    text: 'Open Settings',
                    onPress: () => {
                      AppBringToFront.requestOverlayPermission().catch(() => {});
                    },
                  },
                ],
              );
            }
          }
          if (AppBringToFront?.isBatteryOptimizationIgnored) {
            const exempt = await AppBringToFront.isBatteryOptimizationIgnored();
            if (!exempt) {
              // Don't dialog the user twice in a row; just deep-link
              // (most OEMs let the user toggle without confirmation).
              AppBringToFront.requestBatteryOptimizationExemption?.().catch(() => {});
            }
          }
        } catch (_e) { /* native module not available — ignore */ }
      } catch (_) { /* ignore — degrades to toast-only */ }
    })();
    return () => { cancelled = true; };
  }, [token, driver?.id]);

  // ✅ Register kicked listener to force logout when kicked by dispatch
  useEffect(() => {
    if (!token || !driver) return;
    
    const handleKicked = (data: { reason: string; kickedBy?: string; timestamp: string; message: string }) => {
      console.error('🚨 DRIVER KICKED - Forcing logout:', data);
      
      // Show alert to driver
      Alert.alert(
        'Session Terminated',
        data.message || 'Your session has been terminated by dispatch.',
        [
          {
            text: 'OK',
            onPress: async () => {
              // Force logout
              try {
                await handleLogout();
              } catch (error) {
                console.error('Error during kicked logout:', error);
                // Force clear state anyway
                setToken(null);
                setDriver(null);
              }
            }
          }
        ],
        { cancelable: false }
      );
    };
    
    registerKickedListener(handleKicked);
    console.log('🚨 Kicked listener registered for driver:', driver.id);
  }, [token, driver?.id]);

  const refreshDriver = useCallback(async () => {
    if (!token) return;
    try {
      const profile = await fetchDriverProfile();
      setDriver(profile);
      await AsyncStorage.setItem("driverProfile", JSON.stringify(profile));
    } catch (error) {
      console.error("Failed to refresh driver profile", error);
    }
  }, [token]);

  const handleLogin = async (email: string, password: string) => {
    const result = await loginService({ email, password });
    if (result.token) {
      setToken(result.token);
    }
    console.log("✅ Login successful, token stored", result.driver);
    if (result.driver) {
      setDriver(result.driver);
    } else {
      try {
        const profile = await fetchDriverProfile();
        setDriver(profile);
        await AsyncStorage.setItem("driverProfile", JSON.stringify(profile));
      } catch (error) {
        console.error("Failed to load driver profile after login", error);
      }
    }

    // 🔥 Register this device for FCM pushes. Fire-and-forget — never block login.
    try {
      const { initPushNotifications } = await import('../services/pushNotifications');
      initPushNotifications(result.token).catch(() => {});
    } catch (e) { /* ignore */ }

    // 🟢 Kick off the notifee foreground-service keep-alive so the socket
    // stays connected while the app is backgrounded. Persistent LOW-importance
    // notification is the price; the payoff is real-time dispatcher messages
    // even when the driver's phone is locked / app minimised.
    try {
      const { startBackgroundKeepalive, primeNotificationPermission } = await import('../services/localNotifications');
      // Prime permission while we are definitely foreground (just logged in).
      primeNotificationPermission().catch(() => {});
      const label = result.user?.firstName
        ? `${result.user.firstName}${result.user.lastName ? ` ${result.user.lastName}` : ''}`
        : undefined;
      startBackgroundKeepalive(label).catch(() => {});
    } catch (e) { /* ignore */ }
  };

  const handleRegister = async (payload: RegisterPayload) => {
    await registerDriver(payload);
  };

  const handleLogout = async () => {
    console.log('🚪 Starting logout process - clearing all data...');

    // Stop the keep-alive foreground service first so the persistent
    // notification goes away before React state resets.
    try {
      const { stopBackgroundKeepalive } = await import('../services/localNotifications');
      await stopBackgroundKeepalive();
    } catch (_) { /* ignore */ }

    try {
      // ✅ 1. Call backend logout API
      await logoutService();

      // ✅ 2. Clear React state
      setToken(null);
      setDriver(null);

      // ✅ 3. Clear ALL app cache (AsyncStorage, socket, foreground service, etc.)
      await clearAllAppCache();

      console.log('✅ Logout complete - all data cleared');
    } catch (error) {
      console.error('❌ Logout error:', error);
      
      // ✅ Fallback: Clear React state even if cleanup fails
      setToken(null);
      setDriver(null);
      
      // Try to clear critical keys at minimum
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        if (allKeys.length > 0) {
          await AsyncStorage.multiRemove(allKeys);
        }
      } catch (storageError) {
        console.error('❌ AsyncStorage cleanup failed:', storageError);
      }
    }
  };

  // ✅ Register logout callback with httpClient for automatic logout on 401
  useEffect(() => {
    registerLogoutCallback(async () => {
      console.log('🚨 Auto-logout triggered by 401 error');
      await handleLogout();
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      isAuthenticated: !!token,
      token,
      driver,
      login: handleLogin,
      register: handleRegister,
      logout: handleLogout,
      refreshDriver,
    }),
    [driver, loading, token, refreshDriver]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => useContext(AuthContext);
