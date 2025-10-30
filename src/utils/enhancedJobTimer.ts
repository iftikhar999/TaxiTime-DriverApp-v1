/**
 * Enhanced Job Timer
 * 
 * Sophisticated timer system for taxi rides that tracks:
 * - Elapsed time
 * - Distance traveled (with GPS noise filtering)
 * - Waiting time (when stopped)
 * - Movement state
 * 
 * Features:
 * - GPS noise filtering (ignores movements < threshold)
 * - Separate distance and waiting time tracking
 * - State persistence and restoration
 * - ✅ SMART Movement detection (coordinate-based + speed fallback)
 * - Accurate Haversine distance calculation
 * 
 * Movement Detection Logic:
 * 1. PRIMARY: Calculates actual movement from GPS coordinates
 *    - Measures distance between consecutive GPS points
 *    - Calculates effective speed: (distance / time)
 *    - More accurate than GPS-provided speed
 * 2. FALLBACK: Uses GPS-provided speed if coordinate data unavailable
 * 3. Threshold: Vehicle is "stopped" if moved < 3 meters between updates
 */

import { calculateHaversineDistance } from './haversineDistance';

// Configuration constants
const GPS_NOISE_FILTER_METERS = 10; // Ignore GPS movements below this threshold
const MIN_MOVING_SPEED_KMH = 5; // ✅ FIX: Increased from 1 to 5 km/h (GPS drift can show 1-3 km/h when stationary)
const MIN_MOVEMENT_DISTANCE_METERS = 3; // Minimum distance to be considered moving (between GPS updates)
const MOVEMENT_DETECTION_WINDOW_SECONDS = 10; // Time window to average movement detection

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number; // in km/h
  heading?: number;
  timestamp?: number;
}

export interface TimerMetrics {
  distance: number; // Total distance in meters
  waiting: number; // Total waiting time in seconds
  elapsed: number; // Total elapsed time in seconds
  isMoving: boolean; // Current movement state
}

export interface TimerState {
  startTime: number | null;
  lastUpdateTime: number | null;
  totalWaitingSeconds: number;
  totalDistanceMeters: number;
  lastKnownCoordinate: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    timestamp?: number;
  } | null;
}

export class EnhancedJobTimer {
  private startTime: number | null = null;
  private lastUpdateTime: number | null = null;
  private totalWaitingSeconds: number = 0;
  private totalDistanceMeters: number = 0;
  private lastKnownCoordinate: LocationUpdate | null = null;
  private initializedFromStore: boolean = false;
  private logPrefix: string = '[EnhancedJobTimer]';

  /**
   * Initialize timer from persisted job data
   * This allows the timer to restore its state after app restart/crash
   * 
   * @param jobData Job object containing previous timer state
   */
  initializeFromJob(jobData: any): void {
    if (this.initializedFromStore || !jobData) {
      if (this.initializedFromStore) {
        console.log(`${this.logPrefix} Already initialized from store`);
      }
      return;
    }

    // Restore start time
    if (jobData.driver_job_start_time) {
      this.startTime = new Date(jobData.driver_job_start_time).getTime();
      console.log(
        `${this.logPrefix} Start time restored: ${new Date(this.startTime).toISOString()}`
      );
    }

    // Restore accumulated metrics
    this.totalDistanceMeters = parseFloat(jobData.totalAccumulatedDistanceMeters) || 0;
    this.totalWaitingSeconds = parseFloat(jobData.totalAccumulatedWaitingSeconds) || 0;

    console.log(`${this.logPrefix} Metrics restored:`, {
      distance: `${this.totalDistanceMeters.toFixed(2)}m`,
      waiting: `${this.totalWaitingSeconds.toFixed(2)}s`,
    });

    // Restore last known coordinate
    if (
      jobData.lastKnownCoordinate?.latitude &&
      jobData.lastKnownCoordinate?.longitude
    ) {
      this.lastKnownCoordinate = {
        latitude: jobData.lastKnownCoordinate.latitude,
        longitude: jobData.lastKnownCoordinate.longitude,
        accuracy: jobData.lastKnownCoordinate.accuracy,
        timestamp: jobData.lastKnownCoordinate.timestamp,
      };
      console.log(`${this.logPrefix} Last coordinate restored`);
    }

    this.initializedFromStore = true;
    console.log(`${this.logPrefix} ✅ Timer initialization complete`);
  }

  /**
   * Start the timer (sets start time if not already set)
   */
  start(): void {
    if (!this.startTime) {
      this.startTime = Date.now();
      this.lastUpdateTime = this.startTime;
      console.log(`${this.logPrefix} ⏱️ Timer started at ${new Date(this.startTime).toISOString()}`);
    }
  }

  /**
   * Update timer with current location
   * Calculates distance traveled and waiting time based on movement
   * 
   * @param currentLocation Current GPS location
   * @returns Updated metrics
   */
  update(currentLocation: LocationUpdate | null): TimerMetrics {
    const now = Date.now();

    // Initialize lastUpdateTime if missing
    if (!this.lastUpdateTime) {
      this.lastUpdateTime = now;
    }

    // Calculate time difference in whole seconds
    const timeDiffSeconds = Math.floor((now - this.lastUpdateTime) / 1000);

    // Defensive: handle negative time diff (clock changes)
    if (timeDiffSeconds < 0) {
      console.warn(`${this.logPrefix} Negative time diff detected, resetting update time`);
      this.lastUpdateTime = now;
      return this.getCurrentMetrics(currentLocation);
    }

    // Skip update if no time has passed
    if (timeDiffSeconds === 0) {
      return this.getCurrentMetrics(currentLocation);
    }

    let distanceMovedThisTick = 0;

    // Calculate distance only if we have both coordinates
    if (
      currentLocation &&
      this.lastKnownCoordinate &&
      (currentLocation.latitude !== this.lastKnownCoordinate.latitude ||
        currentLocation.longitude !== this.lastKnownCoordinate.longitude)
    ) {
      distanceMovedThisTick = calculateHaversineDistance(
        this.lastKnownCoordinate,
        currentLocation
      );
    }

    // ✅ SMARTER MOVEMENT DETECTION: Calculate from GPS coordinates
    const isMoving = this.isVehicleMoving(
      currentLocation, 
      distanceMovedThisTick, 
      timeDiffSeconds
    );

    // 🔍 DEBUG: Log movement detection details
    console.log(
      `${this.logPrefix} 🔍 Update - Time: ${timeDiffSeconds.toFixed(1)}s, ` +
      `Moved: ${distanceMovedThisTick.toFixed(2)}m, ` +
      `IsMoving: ${isMoving ? '🚗 YES' : '🛑 NO'}, ` +
      `Total Distance: ${this.totalDistanceMeters.toFixed(2)}m, ` +
      `Total Waiting: ${this.totalWaitingSeconds.toFixed(0)}s, ` +
      `Location: ${currentLocation ? `(${currentLocation.latitude.toFixed(6)}, ${currentLocation.longitude.toFixed(6)})` : 'null'}`
    );

    if (isMoving) {
      // Add distance if movement is significant (filter GPS noise)
      if (distanceMovedThisTick > GPS_NOISE_FILTER_METERS) {
        this.totalDistanceMeters += distanceMovedThisTick;
        
        // Log significant movements
        console.log(
          `${this.logPrefix} ✅ Distance added: +${distanceMovedThisTick.toFixed(2)}m (total: ${this.totalDistanceMeters.toFixed(2)}m)`
        );
      } else if (distanceMovedThisTick > 0 && distanceMovedThisTick <= GPS_NOISE_FILTER_METERS) {
        // GPS noise detected but filtered
        console.log(
          `${this.logPrefix} ⚠️ GPS noise filtered: ${distanceMovedThisTick.toFixed(2)}m (< ${GPS_NOISE_FILTER_METERS}m threshold)`
        );
      }
      // Don't add waiting time when moving
    } else {
      // Add waiting time when not moving
      this.totalWaitingSeconds += timeDiffSeconds;
      
      // Log waiting time accumulation (every update when stopped)
      const speedInfo = currentLocation?.speed !== undefined 
        ? `speed: ${currentLocation.speed.toFixed(1)} km/h` 
        : 'no speed data';
      console.log(
        `${this.logPrefix} ⏱️ WAITING TIME ADDED: +${timeDiffSeconds.toFixed(1)}s (total: ${this.totalWaitingSeconds.toFixed(0)}s, ${speedInfo}, moved: ${distanceMovedThisTick.toFixed(2)}m)`
      );
    }

    // Update last update time for next cycle
    this.lastUpdateTime = now;

    // Update last known coordinate
    if (currentLocation) {
      this.lastKnownCoordinate = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracy: currentLocation.accuracy,
        speed: currentLocation.speed,
        heading: currentLocation.heading,
        timestamp: currentLocation.timestamp || now,
      };
    }

    return this.getCurrentMetrics(currentLocation);
  }

  /**
   * ✅ SMARTER MOVEMENT DETECTION
   * Determine if vehicle is moving based on:
   * 1. PRIMARY: Distance traveled between GPS coordinates (more accurate)
   * 2. FALLBACK: GPS-provided speed (if coordinate-based detection unavailable)
   * 
   * @param location Current location with speed data
   * @param distanceMoved Distance moved since last update (meters) - optional
   * @param timeDiff Time elapsed since last update (seconds) - optional
   * @returns true if moving, false if stopped
   */
  private isVehicleMoving(
    location: LocationUpdate | null, 
    distanceMoved: number = 0, 
    timeDiff: number = 0
  ): boolean {
    // ✅ PRIORITY 1: Coordinate-based detection (MOST ACCURATE!)
    // If we have both time diff and distance data, use it
    if (timeDiff > 0) {
      // If vehicle moved less than 3 meters, it's DEFINITELY stopped
      if (distanceMoved < MIN_MOVEMENT_DISTANCE_METERS) {
        // Log when stopped (for debugging waiting time)
        if (Math.random() < 0.05) { // 5% sample to avoid spam
          console.log(
            `${this.logPrefix} 🛑 STOPPED: moved only ${distanceMoved.toFixed(2)}m in ${timeDiff.toFixed(1)}s (< ${MIN_MOVEMENT_DISTANCE_METERS}m threshold)`
          );
        }
        return false; // ✅ STOPPED
      }
      
      // Moved >= 3 meters, calculate speed
      const calculatedSpeedKmh = (distanceMoved / timeDiff) * 3.6;
      
      // Vehicle is moving if calculated speed is above 5 km/h
      const isMovingByCoordinates = calculatedSpeedKmh >= MIN_MOVING_SPEED_KMH;
      
      // Log movement detection (sampled to avoid spam)
      if (Math.random() < 0.05) {
        console.log(
          `${this.logPrefix} ${isMovingByCoordinates ? '🚗 MOVING' : '🛑 STOPPED'}: ${distanceMoved.toFixed(1)}m in ${timeDiff.toFixed(1)}s = ${calculatedSpeedKmh.toFixed(1)} km/h`
        );
      }
      
      return isMovingByCoordinates;
    }

    // ✅ PRIORITY 2: Fallback to GPS-provided speed (less reliable due to drift)
    if (location && location.speed !== undefined && location.speed !== null) {
      const isMovingBySpeed = location.speed >= MIN_MOVING_SPEED_KMH;
      
      // Log speed-based detection (sampled)
      if (!isMovingBySpeed && Math.random() < 0.05) {
        console.log(
          `${this.logPrefix} 🛑 STOPPED (by GPS speed): ${location.speed.toFixed(1)} km/h < ${MIN_MOVING_SPEED_KMH} km/h`
        );
      }
      
      return isMovingBySpeed;
    }

    // No movement data available - assume stopped (safer for waiting time accumulation)
    console.log(`${this.logPrefix} ⚠️ No movement data - assuming STOPPED`);
    return false;
  }

  /**
   * Get current metrics without updating
   * @param currentLocation Current location (for isMoving state)
   * @returns Current timer metrics
   */
  private getCurrentMetrics(currentLocation: LocationUpdate | null): TimerMetrics {
    const now = Date.now();
    const elapsed = this.startTime ? (now - this.startTime) / 1000 : 0;
    const isMoving = this.isVehicleMoving(currentLocation);

    return {
      distance: this.totalDistanceMeters || 0,
      waiting: this.totalWaitingSeconds || 0,
      elapsed: elapsed || 0,
      isMoving,
    };
  }

  /**
   * Reset all timer states
   * Call this when starting a new job
   */
  reset(): void {
    console.log(`${this.logPrefix} 🔄 Timer reset`);
    this.startTime = null;
    this.lastUpdateTime = null;
    this.totalWaitingSeconds = 0;
    this.totalDistanceMeters = 0;
    this.lastKnownCoordinate = null;
    this.initializedFromStore = false;
  }

  /**
   * Get current timer state for persistence
   * @returns Timer state object
   */
  getState(): TimerState {
    return {
      startTime: this.startTime,
      lastUpdateTime: this.lastUpdateTime,
      totalWaitingSeconds: this.totalWaitingSeconds,
      totalDistanceMeters: this.totalDistanceMeters,
      lastKnownCoordinate: this.lastKnownCoordinate,
    };
  }

  /**
   * Restore timer state from persisted data
   * @param state Previously saved timer state
   */
  restoreState(state: TimerState): void {
    this.startTime = state.startTime;
    this.lastUpdateTime = state.lastUpdateTime;
    this.totalWaitingSeconds = state.totalWaitingSeconds || 0;
    this.totalDistanceMeters = state.totalDistanceMeters || 0;
    this.lastKnownCoordinate = state.lastKnownCoordinate;
    this.initializedFromStore = true;

    console.log(`${this.logPrefix} ✅ State restored from persistence`);
  }

  /**
   * Get current accumulated distance
   * @returns Distance in meters
   */
  getDistance(): number {
    return this.totalDistanceMeters;
  }

  /**
   * Get current accumulated waiting time
   * @returns Waiting time in seconds
   */
  getWaitingTime(): number {
    return this.totalWaitingSeconds;
  }

  /**
   * Get elapsed time since start
   * @returns Elapsed time in seconds
   */
  getElapsedTime(): number {
    if (!this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  /**
   * Check if timer has been initialized
   * @returns true if initialized
   */
  isInitialized(): boolean {
    return this.initializedFromStore || this.startTime !== null;
  }
}

// Export a singleton instance for global use
export const globalJobTimer = new EnhancedJobTimer();

