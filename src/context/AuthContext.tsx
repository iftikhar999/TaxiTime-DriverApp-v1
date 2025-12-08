import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import {
    login as loginService,
    logout as logoutService,
    registerDriver,
    RegisterPayload,
} from "../services/authService";
import { clearAllAppCache } from "../services/cacheCleanup";
import { fetchDriverProfile } from "../services/driverService";
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
  };

  const handleRegister = async (payload: RegisterPayload) => {
    await registerDriver(payload);
  };

  const handleLogout = async () => {
    console.log('🚪 Starting logout process - clearing all data...');
    
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
