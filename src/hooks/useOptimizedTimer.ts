/**
 * useOptimizedTimer - Lightweight timer hook that doesn't cause parent re-renders
 * 
 * Problem: JobContext timer updates every second, causing entire context tree to re-render
 * Solution: This hook manages its own state and only subscribes to timer updates,
 * preventing unnecessary re-renders in parent components.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { globalJobTimer, TimerState } from '../utils/enhancedJobTimer';

interface TimerDisplayState {
  elapsedSeconds: number;
  waitingSeconds: number;
  distanceMeters: number;
  speedKmh: number;
  isRunning: boolean;
  isPaused: boolean;
}

interface FormattedTimerDisplay {
  elapsed: string;
  waiting: string;
  distance: string;
  speed: string;
}

interface UseOptimizedTimerOptions {
  /** Update interval in ms (default: 1000) */
  updateInterval?: number;
  /** Only update display values, not raw numbers */
  displayOnly?: boolean;
  /** Disable auto-updates */
  manualOnly?: boolean;
}

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
};

const formatSpeed = (kmh: number): string => {
  if (!Number.isFinite(kmh) || kmh < 0) return '0 km/h';
  return `${Math.round(kmh)} km/h`;
};

export const useOptimizedTimer = (
  options: UseOptimizedTimerOptions = {}
): {
  state: TimerDisplayState;
  formatted: FormattedTimerDisplay;
  refresh: () => void;
} => {
  const { updateInterval = 1000, manualOnly = false } = options;
  
  const [state, setState] = useState<TimerDisplayState>({
    elapsedSeconds: 0,
    waitingSeconds: 0,
    distanceMeters: 0,
    speedKmh: 0,
    isRunning: false,
    isPaused: false,
  });
  
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastStateRef = useRef<TimerState | null>(null);

  const syncFromTimer = useCallback(() => {
    const timerState = globalJobTimer.getState();
    if (!timerState) {
      if (state.isRunning || state.elapsedSeconds > 0) {
        setState({
          elapsedSeconds: 0,
          waitingSeconds: 0,
          distanceMeters: 0,
          speedKmh: 0,
          isRunning: false,
          isPaused: false,
        });
      }
      return;
    }

    // Get snapshot for all metrics (speed, distance, etc.)
    const metrics = globalJobTimer.snapshot();

    // Calculate elapsed from timestamps for accuracy
    let elapsedSeconds = 0;
    if (timerState.startTime && timerState.lastUpdateTime) {
      elapsedSeconds = Math.max(0, (timerState.lastUpdateTime - timerState.startTime) / 1000);
    }

    // Determine if timer is running (has start time and not paused)
    const isRunning = !!timerState.startTime && !timerState.isPaused;

    // Only update state if values actually changed (prevents re-renders)
    const newState: TimerDisplayState = {
      elapsedSeconds,
      waitingSeconds: timerState.totalWaitingSeconds ?? 0,
      distanceMeters: timerState.totalDistanceMeters ?? 0,
      speedKmh: metrics.speedKmh ?? 0,
      isRunning,
      isPaused: timerState.isPaused ?? false,
    };

    // Compare with previous to avoid unnecessary state updates
    if (
      Math.abs(newState.elapsedSeconds - state.elapsedSeconds) >= 1 ||
      Math.abs(newState.waitingSeconds - state.waitingSeconds) >= 1 ||
      Math.abs(newState.distanceMeters - state.distanceMeters) >= 1 ||
      newState.isRunning !== state.isRunning ||
      newState.isPaused !== state.isPaused
    ) {
      setState(newState);
    }
    
    lastStateRef.current = timerState;
  }, [state]);

  const refresh = useCallback(() => {
    syncFromTimer();
  }, [syncFromTimer]);

  useEffect(() => {
    if (manualOnly) return;

    // Initial sync
    syncFromTimer();

    // Set up interval for updates
    intervalRef.current = setInterval(syncFromTimer, updateInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [syncFromTimer, updateInterval, manualOnly]);

  // Pre-formatted values to avoid formatting in render
  const formatted: FormattedTimerDisplay = {
    elapsed: formatTime(state.elapsedSeconds),
    waiting: formatTime(state.waitingSeconds),
    distance: formatDistance(state.distanceMeters),
    speed: formatSpeed(state.speedKmh),
  };

  return { state, formatted, refresh };
};

/**
 * useLightweightJobStatus - Get job status without full context subscription
 * 
 * This hook provides only the status string, avoiding re-renders from
 * timer/location changes in the full JobContext.
 */
export const useLightweightJobStatus = (): string => {
  const [status, setStatus] = useState<string>('IDLE');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Check timer state for job activity
    const checkStatus = () => {
      const timerState = globalJobTimer.getState();
      if (timerState?.startTime) {
        setStatus(timerState.isPaused ? 'PAUSED' : 'STARTED');
      }
    };

    checkStatus();
    intervalRef.current = setInterval(checkStatus, 2000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return status;
};

export default useOptimizedTimer;
