/**
 * useThrottledLocation - Optimized location hook with throttling
 * 
 * Purpose: Reduces re-renders by only updating location at controlled intervals
 * Instead of updating on every GPS tick (which can be 1-5 seconds), this hook
 * throttles updates to UI components while still allowing real-time updates
 * to the socket layer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LocationUpdate } from '../native/locationService';
import { useLocation } from '../context/LocationContext';

interface ThrottledLocationOptions {
  /** Minimum milliseconds between UI updates (default: 3000ms) */
  throttleMs?: number;
  /** Only update when distance moved exceeds this (meters) */
  minDistanceMeters?: number;
  /** Enable debug logging */
  debug?: boolean;
}

interface ThrottledLocationResult {
  /** Current location (throttled for UI) */
  location: LocationUpdate | null;
  /** Raw location (unthrottled, for calculations) */
  rawLocation: LocationUpdate | null;
  /** Whether tracking is active */
  tracking: boolean;
  /** Last update timestamp */
  lastUpdate: number;
  /** Force immediate update */
  forceUpdate: () => void;
}

const calculateDistanceBetween = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const useThrottledLocation = (
  options: ThrottledLocationOptions = {}
): ThrottledLocationResult => {
  const { throttleMs = 3000, minDistanceMeters = 5, debug = false } = options;
  
  const { location: rawLocation, tracking } = useLocation();
  const [throttledLocation, setThrottledLocation] = useState<LocationUpdate | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  
  const lastEmittedRef = useRef<LocationUpdate | null>(null);
  const lastEmitTimeRef = useRef(0);
  const pendingUpdateRef = useRef<LocationUpdate | null>(null);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const shouldUpdate = useCallback(
    (newLocation: LocationUpdate | null): boolean => {
      if (!newLocation) return false;
      if (!lastEmittedRef.current) return true;
      
      const now = Date.now();
      const timeSinceLastEmit = now - lastEmitTimeRef.current;
      
      // Always allow if enough time has passed
      if (timeSinceLastEmit >= throttleMs) return true;
      
      // Check distance moved
      const distance = calculateDistanceBetween(
        lastEmittedRef.current.latitude,
        lastEmittedRef.current.longitude,
        newLocation.latitude,
        newLocation.longitude
      );
      
      // Allow if moved significantly (even if throttle time hasn't passed)
      if (distance >= minDistanceMeters * 2) return true;
      
      return false;
    },
    [throttleMs, minDistanceMeters]
  );

  const emitUpdate = useCallback(
    (loc: LocationUpdate) => {
      if (debug) {
        console.log('🎯 [ThrottledLocation] Emitting update:', {
          lat: loc.latitude.toFixed(6),
          lng: loc.longitude.toFixed(6),
        });
      }
      setThrottledLocation(loc);
      setLastUpdate(Date.now());
      lastEmittedRef.current = loc;
      lastEmitTimeRef.current = Date.now();
      pendingUpdateRef.current = null;
    },
    [debug]
  );

  const forceUpdate = useCallback(() => {
    if (rawLocation) {
      emitUpdate(rawLocation);
    }
  }, [rawLocation, emitUpdate]);

  useEffect(() => {
    if (!rawLocation) return;

    if (shouldUpdate(rawLocation)) {
      // Clear any pending throttled update
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      emitUpdate(rawLocation);
    } else {
      // Store pending update and schedule throttled emission
      pendingUpdateRef.current = rawLocation;
      
      if (!throttleTimerRef.current) {
        const timeUntilNextEmit = throttleMs - (Date.now() - lastEmitTimeRef.current);
        
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingUpdateRef.current) {
            emitUpdate(pendingUpdateRef.current);
          }
        }, Math.max(timeUntilNextEmit, 100));
      }
    }

    return () => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
    };
  }, [rawLocation, shouldUpdate, emitUpdate, throttleMs]);

  return {
    location: throttledLocation,
    rawLocation,
    tracking,
    lastUpdate,
    forceUpdate,
  };
};

export default useThrottledLocation;
