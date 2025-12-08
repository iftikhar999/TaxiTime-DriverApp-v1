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
const GPS_NOISE_FILTER_METERS = 12; // Ignore GPS movements below this threshold to reduce jitter/noise
const MIN_MOVING_SPEED_KMH = 5; // Vehicle must be moving at least 5 km/h to be considered "moving"
const MAX_REASONABLE_SPEED_KMH = 200; // Maximum reasonable speed - anything above is GPS glitch
const MAX_REASONABLE_DISTANCE_PER_SECOND = 55; // ~200 km/h max (55 m/s)
const GPS_SPEED_TOLERANCE_MULTIPLIER = 1.45; // Allow up to +45% vs raw speed before treating as glitch
const MOVEMENT_DETECTION_WINDOW_SECONDS = 10; // Time window to average movement detection
const STABILIZATION_WINDOW_MS = 4000; // Ignore GPS jitter for first few seconds after start

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
  speedKmh: number; // Derived speed (km/h) based on coordinates
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
  totalPausedMillis?: number;
  isPaused?: boolean;
  hasInitialFix?: boolean;
  hasStabilized?: boolean;
}

export class EnhancedJobTimer {
  private startTime: number | null = null;
  private lastUpdateTime: number | null = null;
  private totalWaitingSeconds: number = 0;
  private totalDistanceMeters: number = 0;
  private lastKnownCoordinate: LocationUpdate | null = null;
  private totalPausedMillis: number = 0;
  private pauseStartedAt: number | null = null;
  private isPaused: boolean = false;
  private hasInitialFix: boolean = false;
  private hasStabilized: boolean = false;
  private initializedFromStore: boolean = false;
  private logPrefix: string = '[EnhancedJobTimer]';
  private lastDerivedSpeedKmh: number = 0;
  private lastIsMoving: boolean = false;
  
  // ✅ NEW: Rolling average for movement detection
  private recentSpeeds: number[] = [];
  private readonly MAX_SPEED_SAMPLES = 5; // Keep last 5 speed samples
  private consecutiveStoppedUpdates: number = 0;
  private consecutiveMovingUpdates: number = 0;
  private readonly MOVEMENT_CONFIDENCE_THRESHOLD = 1; // Require only one consistent reading for snappier response

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

    if (this.isPaused) {
      this.resume();
    }
  }

  /**
   * Pause the timer so elapsed/price calculations freeze
   */
  pause(): void {
    if (this.isPaused) {
      return;
    }

    this.isPaused = true;
    this.pauseStartedAt = Date.now();
    console.log(`${this.logPrefix} ⏸️ Timer paused`);
  }

  /**
   * Resume the timer after a pause without losing accumulated time/distance
   */
  resume(currentLocation?: LocationUpdate | null): TimerMetrics | void {
    if (!this.isPaused) {
      return;
    }

    const now = Date.now();
    const locationToUse = currentLocation ?? this.lastKnownCoordinate;

    if (!locationToUse) {
      this.lastUpdateTime = now;
      this.pauseStartedAt = null;
      this.isPaused = false;
      console.log(`${this.logPrefix} ▶️ Timer resumed without location (paused for ${Math.round(this.totalPausedMillis / 1000)}s total)`);
      return this.getCurrentMetrics(null);
    }

    if (!this.hasInitialFix) {
      this.hasInitialFix = true;
    }

    this.lastKnownCoordinate = {
      latitude: locationToUse.latitude,
      longitude: locationToUse.longitude,
      accuracy: locationToUse.accuracy,
      speed: locationToUse.speed,
      heading: locationToUse.heading,
      timestamp: locationToUse.timestamp || now,
    };

    if (this.pauseStartedAt) {
      this.totalPausedMillis += Math.max(0, now - this.pauseStartedAt);
    }

    this.pauseStartedAt = null;
    this.isPaused = false;
    this.lastUpdateTime = now;
    console.log(`${this.logPrefix} ▶️ Timer resumed (paused for ${Math.round(this.totalPausedMillis / 1000)}s total)`);

    return this.getCurrentMetrics(locationToUse);
  }

  /**
   * Check if timer is currently paused
   */
  isTimerPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Update timer with current location
   * Calculates distance traveled and waiting time based on movement
   * 
   * @param currentLocation Current GPS location
   * @returns Updated metrics
   */
  update(currentLocation: LocationUpdate | null): TimerMetrics {
    if (this.isPaused) {
      if (currentLocation) {
        this.lastKnownCoordinate = {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          accuracy: currentLocation.accuracy,
          speed: currentLocation.speed,
          heading: currentLocation.heading,
          timestamp: currentLocation.timestamp || Date.now(),
        };
      }

      return this.getCurrentMetrics(currentLocation);
    }

    const now = Date.now();

    // Initialize lastUpdateTime if missing
    if (!this.lastUpdateTime) {
      this.lastUpdateTime = now;
    }

    // Calculate time difference (in seconds, fractional precision)
    const timeDiffSeconds = (now - this.lastUpdateTime) / 1000;

    // Defensive: handle negative time diff (clock changes)
    if (timeDiffSeconds < 0) {
      console.warn(`${this.logPrefix} Negative time diff detected, resetting update time`);
      this.lastUpdateTime = now;
      return this.getCurrentMetrics(currentLocation);
    }

    // Skip update if effectively no time has passed
    if (timeDiffSeconds < 0.05) {
      return this.getCurrentMetrics(currentLocation);
    }

    // If we didn't receive a fresh location, don't treat it as waiting time—just keep last metrics
    if (!currentLocation) {
      this.lastUpdateTime = now;
      return this.getCurrentMetrics(this.lastKnownCoordinate);
    }

    let distanceMovedThisTick = 0;

    const rawSpeedMetersPerSecond =
      currentLocation && Number.isFinite(Number(currentLocation.speed))
        ? Math.max(0, Number(currentLocation.speed))
        : 0;

    const expectedDistanceFromSpeed =
      rawSpeedMetersPerSecond > 0 ? rawSpeedMetersPerSecond * timeDiffSeconds : 0;
    const speedAwareDistanceCap =
      expectedDistanceFromSpeed > 0
        ? expectedDistanceFromSpeed * GPS_SPEED_TOLERANCE_MULTIPLIER
        : 0;

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
      
      // ✅ GPS GLITCH DETECTION: Filter unrealistic jumps but allow speed-backed movement
      const maxDistanceForTimeDiff = MAX_REASONABLE_DISTANCE_PER_SECOND * timeDiffSeconds;
      const dynamicDistanceCap =
        speedAwareDistanceCap > 0
          ? Math.max(speedAwareDistanceCap, maxDistanceForTimeDiff)
          : maxDistanceForTimeDiff;

      if (distanceMovedThisTick > dynamicDistanceCap) {
        if (speedAwareDistanceCap > 0) {
          console.warn(
            `${this.logPrefix} ⚠️ GPS jump ${distanceMovedThisTick.toFixed(0)}m in ${timeDiffSeconds}s ` +
              `(speed-expected ≈ ${expectedDistanceFromSpeed.toFixed(0)}m) - clamping to ${dynamicDistanceCap.toFixed(0)}m`
          );
          distanceMovedThisTick = dynamicDistanceCap;
        } else {
          console.warn(
            `${this.logPrefix} 🚨 GPS GLITCH DETECTED: ${distanceMovedThisTick.toFixed(0)}m in ${timeDiffSeconds}s ` +
              `(max reasonable: ${dynamicDistanceCap.toFixed(0)}m) - IGNORING THIS UPDATE`
          );
          // Treat this as if vehicle didn't move (GPS glitch)
          distanceMovedThisTick = 0;
        }
      }
    }

    // ✅ SMARTER MOVEMENT DETECTION: Calculate from GPS coordinates
    const derivedSpeedKmh =
      timeDiffSeconds > 0 && distanceMovedThisTick > 0
        ? Math.min(
            Math.max((distanceMovedThisTick / timeDiffSeconds) * 3.6, 0),
            MAX_REASONABLE_SPEED_KMH
          )
        : 0;
    const gpsSpeedKmh = this.getGpsSpeedKmh(currentLocation);
    const effectiveSpeedKmh = derivedSpeedKmh > 0 ? derivedSpeedKmh : gpsSpeedKmh;

    const isMoving = this.isVehicleMoving(
      currentLocation, 
      distanceMovedThisTick, 
      timeDiffSeconds,
      effectiveSpeedKmh,
      gpsSpeedKmh
    );
    this.lastIsMoving = isMoving;

    if (!this.hasStabilized && this.startTime) {
      this.hasStabilized = now - this.startTime >= STABILIZATION_WINDOW_MS;
    }

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
    } else if (this.hasStabilized) {
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

    this.lastDerivedSpeedKmh = isMoving ? derivedSpeedKmh : 0;

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
    timeDiff: number = 0,
    derivedSpeedKmh: number = 0,
    gpsSpeedKmh: number = 0
  ): boolean {
    // ✅ PRIORITY 1: Coordinate-based detection with rolling average (MOST ACCURATE!)
    if (timeDiff > 0) {
      const sanitizedSpeedKmh =
        Number.isFinite(derivedSpeedKmh) && derivedSpeedKmh > 0
          ? Math.max(derivedSpeedKmh, 0)
          : Math.max(gpsSpeedKmh, 0);
      
      // Add to rolling average
      this.recentSpeeds.push(sanitizedSpeedKmh);
      if (this.recentSpeeds.length > this.MAX_SPEED_SAMPLES) {
        this.recentSpeeds.shift();
      }
      
      // Calculate average speed
      const avgSpeed = this.recentSpeeds.reduce((a, b) => a + b, 0) / this.recentSpeeds.length;
      
      // Determine if moving based on average speed
      const isCurrentlyMoving = avgSpeed >= MIN_MOVING_SPEED_KMH;
      
      // Track consecutive readings for stability
      if (isCurrentlyMoving) {
        this.consecutiveMovingUpdates++;
        this.consecutiveStoppedUpdates = 0;
      } else {
        this.consecutiveStoppedUpdates++;
        this.consecutiveMovingUpdates = 0;
      }
      
      // Require consistent readings before changing state
      const isConfidentlyMoving = this.consecutiveMovingUpdates >= this.MOVEMENT_CONFIDENCE_THRESHOLD;
      const isConfidentlyStopped = this.consecutiveStoppedUpdates >= this.MOVEMENT_CONFIDENCE_THRESHOLD;
      
      // If vehicle moved less than MIN_MOVEMENT_DISTANCE_METERS, it's definitely stopped
      if (distanceMoved < GPS_NOISE_FILTER_METERS) {
        const effectiveSpeed = Math.max(avgSpeed, gpsSpeedKmh);
        if (effectiveSpeed >= MIN_MOVING_SPEED_KMH) {
          this.consecutiveMovingUpdates++;
          this.consecutiveStoppedUpdates = 0;
          return true;
        }
        if (Math.random() < 0.05) {
          console.log(
            `${this.logPrefix} 🛑 STOPPED: moved only ${distanceMoved.toFixed(2)}m in ${timeDiff.toFixed(1)}s`
          );
        }
        this.consecutiveStoppedUpdates++;
        this.consecutiveMovingUpdates = 0;
        return false;
      }
      
      // Log movement detection (sampled)
      if (Math.random() < 0.05) {
        console.log(
          `${this.logPrefix} ${isConfidentlyMoving ? '🚗 MOVING' : '🛑 STOPPED'}: ` +
          `avg speed ${avgSpeed.toFixed(1)} km/h ` +
          `(${this.consecutiveMovingUpdates} moving / ${this.consecutiveStoppedUpdates} stopped readings)`
        );
      }
      
      // Use confident state, or fall back to current reading
      if (isConfidentlyMoving) return true;
      if (isConfidentlyStopped) return false;
      return isCurrentlyMoving;
    }

    // ✅ PRIORITY 2: Fallback to GPS-provided speed (less reliable)
    if (location && location.speed !== undefined && location.speed !== null) {
      const gpsSpeed = this.getGpsSpeedKmh(location);
      const isMovingBySpeed = gpsSpeed >= MIN_MOVING_SPEED_KMH;
      
      if (!isMovingBySpeed && Math.random() < 0.05) {
        console.log(
          `${this.logPrefix} 🛑 STOPPED (by GPS speed): ${location.speed.toFixed(1)} km/h`
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
    let elapsedMs = 0;
    if (this.startTime && this.lastUpdateTime) {
      elapsedMs = Math.max(0, this.lastUpdateTime - this.startTime);
    } else if (this.startTime) {
      elapsedMs = Math.max(0, now - this.startTime);
    }

    const adjustedElapsedMs = Math.max(0, elapsedMs - this.totalPausedMillis);
    const elapsed = adjustedElapsedMs / 1000;
    
    const isMoving =
      this.lastUpdateTime !== null
        ? this.lastIsMoving
        : this.isVehicleMoving(currentLocation);

    // ✅ VALIDATION: Waiting time should NEVER exceed elapsed time
    const validWaitingTime = Math.min(this.totalWaitingSeconds || 0, elapsed);
    if (this.totalWaitingSeconds > elapsed) {
      console.warn(
        `${this.logPrefix} ⚠️ WAITING TIME EXCEEDED ELAPSED TIME! ` +
        `Waiting: ${this.totalWaitingSeconds.toFixed(0)}s, Elapsed: ${elapsed.toFixed(0)}s - Correcting to ${validWaitingTime.toFixed(0)}s`
      );
    }

    return {
      distance: this.totalDistanceMeters || 0,
      waiting: validWaitingTime,
      elapsed: elapsed || 0,
      isMoving,
      speedKmh: this.lastDerivedSpeedKmh || 0,
    };
  }

  /**
   * Snapshot current metrics without mutating timer state.
   */
  snapshot(): TimerMetrics {
    return this.getCurrentMetrics(this.lastKnownCoordinate);
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
    this.totalPausedMillis = 0;
    this.pauseStartedAt = null;
    this.isPaused = false;
    this.hasInitialFix = false;
    this.hasStabilized = false;
    this.initializedFromStore = false;
    this.lastIsMoving = false;
    
    // ✅ NEW: Clear rolling average state
    this.recentSpeeds = [];
    this.consecutiveStoppedUpdates = 0;
    this.consecutiveMovingUpdates = 0;
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
      totalPausedMillis: this.totalPausedMillis,
      isPaused: this.isPaused,
      hasInitialFix: this.hasInitialFix,
      hasStabilized: this.hasStabilized,
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
    this.totalPausedMillis = state.totalPausedMillis || 0;
    this.pauseStartedAt = null;
    this.isPaused = !!state.isPaused;
    this.hasInitialFix = !!state.hasInitialFix;
    this.hasStabilized = !!state.hasStabilized;
    this.initializedFromStore = true;
    this.lastIsMoving = false;

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

  private getGpsSpeedKmh(location: LocationUpdate | null): number {
    if (!location || location.speed === undefined || location.speed === null) {
      return 0;
    }

    const rawSpeed = Number(location.speed);
    if (!Number.isFinite(rawSpeed)) {
      return 0;
    }

    // React Native's Location speed is in meters/second
    return Math.max(0, rawSpeed * 3.6);
  }
}

// Export a singleton instance for global use
export const globalJobTimer = new EnhancedJobTimer();
