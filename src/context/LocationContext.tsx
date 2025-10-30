import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
    LocationUpdate,
    startLocationService,
    stopLocationService,
    subscribeToLocations
} from '../native/locationService';
import { appStateService } from '../services/appStateService'; // ✨ NEW: App state tracking
import {
    disconnectDriverSocket,
    emitAppStateChange,
    emitDriverLocation,
    ensureDriverSocket
} from '../services/driverSocket';
import { requestAllPermissions } from '../utils/permissions';
import { useAuth } from './AuthContext';
import { useShift } from './ShiftContext';

interface LocationContextValue {
  location: LocationUpdate | null;
  tracking: boolean;
  startTracking: () => Promise<boolean>;
  stopTracking: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

export const LocationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [location, setLocation] = useState<LocationUpdate | null>(null);
  const [tracking, setTracking] = useState(false);
  const [starting, setStarting] = useState(false);
  const { isAuthenticated, driver } = useAuth();
  const { selectedVehicle, activeShift } = useShift();

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (tracking || starting) {
      return true;
    }
    setStarting(true);
    const granted = await requestAllPermissions();
    if (!granted) {
      setStarting(false);
      return false;
    }

    try {
      await startLocationService();
      setTracking(true);
      return true;
    } catch (error) {
      console.error('Failed to start location service', error);
      Toast.show({ type: 'error', text1: 'Location', text2: 'Unable to start location service.' });
      return false;
    } finally {
      setStarting(false);
    }
  }, [starting, tracking]);

  const stopTracking = useCallback(async () => {
    if (!tracking && !starting) {
      return;
    }
    try {
      await stopLocationService();
    } catch (error) {
      console.error('Failed to stop location service', error);
    }
    setTracking(false);
    setStarting(false);
  }, [starting, tracking]);

  useEffect(() => {
    const subscription = subscribeToLocations((update) => {
      console.log('📍 LOCATION UPDATE RECEIVED:', {
        latitude: update.latitude?.toFixed(6),
        longitude: update.longitude?.toFixed(6),
        speed: update.speed,
        accuracy: update.accuracy,
        timestamp: new Date(update.timestamp).toLocaleTimeString(),
      });
      
      setLocation(update);

      if (driver?.id) {
        // ✨ NEW: Include app state in location updates
        const appState = appStateService.getState();
        console.log('📡 ATTEMPTING TO EMIT LOCATION:', {
          driverId: driver.id,
          appState,
          hasLocation: !!update,
        });
        emitDriverLocation(update, appState);
      } else {
        console.warn('⚠️ Location update received but no driver ID - not emitting');
      }
    });
    return () => {
      subscription.remove();
    };
  }, [driver?.id]);

  // ✅ CRITICAL: Ensure socket is connected and properly initialized
  useEffect(() => {
    if (isAuthenticated && driver?.id) {
      const companyId = driver.companyId || driver.company?.id;
      
      console.log('🔌 Ensuring socket connection:', {
        driverId: driver.id,
        companyId,
        isAuthenticated,
      });
      
      ensureDriverSocket({ driverId: driver.id, companyId: companyId || undefined });
    } else {
      console.log('🔌 Disconnecting socket (not authenticated)');
      disconnectDriverSocket();
    }
  }, [isAuthenticated, driver?.id, driver?.companyId, driver?.company?.id]);

  // ✨ CRITICAL FIX: Restart location tracking AND socket when app returns to foreground
  useEffect(() => {
    if (!driver?.id) return;
    
    const companyId = driver.companyId || driver.company?.id;
    
    // Send app state changes to dispatcher AND restart location tracking & socket
    const unsubscribe = appStateService.addListener((newState) => {
      emitAppStateChange(newState);
      
      // Log for debugging
      if (newState === 'BACKGROUND') {
        console.log('📱 Driver minimized app - dispatcher notified');
        // DON'T stop tracking - let it continue in background
      } else if (newState === 'ACTIVE') {
        console.log('📱 Driver returned to app - dispatcher notified');
        
        // ✅ CRITICAL FIX 1: Re-establish socket connection
        console.log('🔌 Re-establishing socket connection...');
        ensureDriverSocket({ driverId: driver.id, companyId: companyId || undefined });
        
        // ✅ CRITICAL FIX 2: Restart location tracking if shift is active
        if (activeShift && tracking === false) {
          console.log('🔄 Restarting location tracking (app returned to foreground)');
          startTracking().catch((error) => {
            console.error('Failed to restart location tracking:', error);
          });
        } else if (activeShift && tracking === true) {
          console.log('✅ Location tracking already active');
        } else if (!activeShift) {
          console.log('ℹ️ No active shift - skipping location restart');
        }
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [driver?.id, driver?.companyId, driver?.company?.id, activeShift, tracking, startTracking]);

  useEffect(() => {
    const shouldTrack = Boolean(
      isAuthenticated && driver?.id && (selectedVehicle || activeShift)
    );

    if (shouldTrack) {
      startTracking().catch((error) => {
        console.error('Auto start tracking failed', error);
      });
    } else {
      stopTracking().catch((error) => {
        console.error('Auto stop tracking failed', error);
      });
    }
  }, [
    activeShift,
    driver?.id,
    isAuthenticated,
    selectedVehicle,
    startTracking,
    stopTracking
  ]);

  const value = useMemo(
    () => ({
      location,
      tracking,
      startTracking,
      stopTracking
    }),
    [location, tracking, startTracking, stopTracking]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
};

export const useLocation = (): LocationContextValue => {
  const context = React.useContext(LocationContext);
  if (!context) {
    // ✅ FIX: During app state transitions, provider might be temporarily unavailable
    // Return safe defaults instead of throwing error
    console.warn('⚠️ LocationContext not available yet, returning safe defaults');
    return {
      location: null,
      tracking: false,
      starting: false,
      startTracking: async () => false,
      stopTracking: async () => {},
    };
  }
  return context;
};
