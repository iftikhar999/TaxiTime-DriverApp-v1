/**
 * Job Processor Service
 * 
 * Background service that continuously processes the active job state:
 * - Updates timer metrics
 * - Calculates real-time pricing
 * - Tracks coordinate history
 * - Handles auto-resume from pause
 * - Manages update intervals based on movement
 * 
 * This is the core engine of the driver app during active rides.
 */

import { globalJobTimer, LocationUpdate } from '../utils/enhancedJobTimer';
import { getWaitingRatePerMinute } from '../utils/tariffUtils';
import { coordinateHistory } from './coordinateHistory';

// Configuration constants
const STOPPED_UPDATE_INTERVAL = 3000; // 3 seconds when stopped
const NORMAL_SPEED_INTERVAL = 2000; // 2 seconds at normal speed
const LITTLE_HIGH_SPEED_INTERVAL = 800; // 800ms at moderate speed
const MORE_SPEED_INTERVAL = 600; // 600ms at high speed
const TOO_HIGH_SPEED_INTERVAL = 500; // 500ms at very high speed
const DEFAULT_MIN_PROCESS_INTERVAL = 5000; // Minimum loop interval aligns with GPS defaults until company config overrides

const GPS_NOISE_FILTER = 10; // meters
const AUTO_RESUME_DISTANCE_THRESHOLD = 10; // meters - auto-resume if driver moves this much while paused

// Terminal job statuses that should stop processing
const TERMINAL_STATUSES = new Set([
  'finished',
  'cancelled',
  'canceled',
  'noshow',
  'no_show',
  'recalled',
  'rejected',
  'completed',
]);

const ACTIVE_JOB_STATUSES = new Set([
  'started',
  'active',
  'in_progress',
  'inprogress',
  'onride',
  'running',
]);

export interface JobProcessorConfig {
  updateInterval?: number;
  enableAutoResume?: boolean;
  enableCoordinateHistory?: boolean;
}

export interface ProcessingResult {
  nextUpdateInterval: number;
  isJobActive: boolean;
  metrics?: {
    distance: number;
    waiting: number;
    elapsed: number;
    isMoving: boolean;
    speedKmh: number;
  };
  pricing?: {
    totalCost: number;
    breakdown: any;
  };
}

export class JobProcessor {
  private isProcessing: boolean = false;
  private config: JobProcessorConfig = {
    updateInterval: DEFAULT_MIN_PROCESS_INTERVAL,
    enableAutoResume: true,
    enableCoordinateHistory: true,
  };
  private lastPausedLocation: LocationUpdate | null = null;
  private processingTimer: NodeJS.Timeout | null = null;
  private lastProcessedLocationKey: string | null = null;
  private duplicateLocationIterations: number = 0;

  /**
   * Configure the job processor
   * @param config Configuration options
   */
  configure(config: Partial<JobProcessorConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('[JobProcessor] ⚙️ Configured:', this.config);
  }

  /**
   * Process the current job state
   * Main processing loop that updates all metrics
   * 
   * @param currentJob Current job data from store
   * @param currentLocation Latest GPS location
   * @param movementState Movement classification (STOPPED, MOVING, etc.)
   * @param callbacks Functions to update job state
   * @returns Processing result with next interval
   */
  async processJobState(
    currentJob: any,
    currentLocation: LocationUpdate | null,
    movementState: string,
    callbacks: {
      updateJob: (updates: any) => void;
      setJobStatus: (status: string) => void;
      clearJob: () => void;
      changeRideStatus?: (status: string, jobId: string, driverId: string, token: string, jobData: any) => Promise<void>;
    }
  ): Promise<ProcessingResult> {
    const jobStatus = currentJob?.status;
    const normalizedStatus = String(jobStatus || '').toLowerCase();

    // Handle no job or terminal status
    if (!currentJob || TERMINAL_STATUSES.has(normalizedStatus)) {
      if (currentJob && TERMINAL_STATUSES.has(normalizedStatus)) {
        console.log('[JobProcessor] 🏁 Terminal status detected, clearing job:', jobStatus);
        callbacks.clearJob();
      }
      
      globalJobTimer.reset();
      this.lastProcessedLocationKey = null;
      this.duplicateLocationIterations = 0;
      this.lastPausedLocation = null;
      
      return {
        nextUpdateInterval: STOPPED_UPDATE_INTERVAL,
        isJobActive: false,
      };
    }

    // Handle PAUSED state with auto-resume
    if (normalizedStatus === 'paused') {
      return await this.handlePausedState(
        currentJob,
        currentLocation,
        callbacks
      );
    }

    // Clear paused location if job is not paused
    if (normalizedStatus !== 'paused') {
      this.lastPausedLocation = null;
    }

    // Handle STARTED state (active ride)
    if (ACTIVE_JOB_STATUSES.has(normalizedStatus)) {
      return await this.handleStartedState(
        currentJob,
        currentLocation,
        movementState,
        callbacks
      );
    }

    // Default for other statuses (accepted, on_the_way, etc.)
    return {
      nextUpdateInterval: STOPPED_UPDATE_INTERVAL,
      isJobActive: true,
    };
  }

  /**
   * Handle paused job state
   * Implements auto-resume if driver moves
   */
  private async handlePausedState(
    currentJob: any,
    currentLocation: LocationUpdate | null,
    callbacks: any
  ): Promise<ProcessingResult> {
    if (!globalJobTimer.isTimerPaused()) {
      globalJobTimer.pause();
    }

    if (!this.lastPausedLocation && currentLocation) {
      this.lastPausedLocation = currentLocation;
    }

    // Check for movement while paused (auto-resume)
    if (this.config.enableAutoResume && this.lastPausedLocation && currentLocation) {
      const { calculateHaversineDistance } = require('../utils/haversineDistance');
      const distanceMoved = calculateHaversineDistance(
        this.lastPausedLocation,
        currentLocation
      );

      if (distanceMoved > AUTO_RESUME_DISTANCE_THRESHOLD) {
        console.log('[JobProcessor] 🔄 Auto-resuming: Driver moved while paused');
        
        // Update job status to started
        callbacks.setJobStatus('started');
        
        const resumeTime = new Date().toISOString();
        callbacks.updateJob({
          resume_job_time: resumeTime,
          status: 'started',
        });

        // Call backend if available
        if (callbacks.changeRideStatus) {
          await callbacks.changeRideStatus(
            'started',
            currentJob.id,
            currentJob.driverId,
            currentJob.token,
            currentJob
          );
        }

        // Resume timer without losing accumulated metrics
        globalJobTimer.resume(currentLocation);

        return await this.handleStartedState(
          { ...currentJob, status: 'started' },
          currentLocation,
          'MOVING',
          callbacks
        );
      }
    }

    // Update last paused location
    if (currentLocation) {
      this.lastPausedLocation = currentLocation;
    }

    return {
      nextUpdateInterval: STOPPED_UPDATE_INTERVAL,
      isJobActive: true,
    };
  }

  /**
   * Handle active (started) job state
   * Main processing logic for ongoing rides
   */
  private async handleStartedState(
    currentJob: any,
    currentLocation: LocationUpdate | null,
    movementState: string,
    callbacks: any
  ): Promise<ProcessingResult> {
    try {
      // Initialize timer from job data (if not already initialized)
      globalJobTimer.initializeFromJob(currentJob);

      if (globalJobTimer.isTimerPaused()) {
        globalJobTimer.resume(currentLocation);
      }

      globalJobTimer.start();

      // Initialize coordinate tracking if enabled
      if (this.config.enableCoordinateHistory && !coordinateHistory.getCurrentHistory()) {
        await coordinateHistory.startTracking(currentJob.id);
      }

      // 🔍 DEBUG: Log location data being passed to timer
      console.log(
        '[JobProcessor] 🔍 Updating timer with location:', 
        currentLocation ? {
          lat: currentLocation.latitude?.toFixed(6),
          lng: currentLocation.longitude?.toFixed(6),
          speed: currentLocation.speed,
          accuracy: currentLocation.accuracy,
          timestamp: currentLocation.timestamp
        } : 'NULL - NO LOCATION DATA!'
      );

      const locationKey = currentLocation
        ? `${currentLocation.latitude?.toFixed(6)}:${currentLocation.longitude?.toFixed(6)}:${currentLocation.timestamp ?? ''}`
        : null;

      if (currentLocation && locationKey === this.lastProcessedLocationKey) {
        this.duplicateLocationIterations++;
        if (this.duplicateLocationIterations === 1 || this.duplicateLocationIterations % 5 === 0) {
          console.log('[JobProcessor] ⏸️ Duplicate location detected - waiting for fresh GPS update before recalculating timer');
        }

        const baseInterval = this.config.updateInterval ?? DEFAULT_MIN_PROCESS_INTERVAL;
        return {
          nextUpdateInterval: Math.max(
            baseInterval,
            this.getUpdateInterval(movementState, currentLocation.speed)
          ),
          isJobActive: true,
          metrics: globalJobTimer.snapshot(),
        };
      }

      if (locationKey) {
        this.lastProcessedLocationKey = locationKey;
        this.duplicateLocationIterations = 0;
      }

      // Update timer with current location
      const metrics = globalJobTimer.update(currentLocation);
      
      console.log(
        '[JobProcessor] 📊 Timer metrics:', {
          distance: metrics.distance.toFixed(2) + 'm',
          waiting: metrics.waiting.toFixed(0) + 's',
          elapsed: metrics.elapsed.toFixed(0) + 's',
          isMoving: metrics.isMoving
        }
      );

      // Add coordinate to history
      if (this.config.enableCoordinateHistory && currentLocation) {
        coordinateHistory.addPoint(currentLocation);
      }

      // Calculate pricing breakdown
      const pricing = this.calculatePricing(
        metrics.elapsed,
        metrics.distance,
        metrics.waiting,
        currentJob.selectedTariff || currentJob.tariff
      );

      // Prepare updates for job store
      const updates = {
        totalAccumulatedDistanceMeters: parseFloat(metrics.distance.toFixed(2)),
        totalAccumulatedWaitingSeconds: parseFloat(metrics.waiting.toFixed(2)),
        elapsedSeconds: parseFloat(metrics.elapsed.toFixed(2)), // ✅ ADD: elapsed time
        isDriverMoving: metrics.isMoving,
        estimatedSpeedKmh: parseFloat((metrics.speedKmh || 0).toFixed(2)),
        movementType: movementState,
        earningsSoFar: pricing.totalCost.toFixed(2),
        pricingBreakdown: pricing.breakdown,
      };

      // Add current location to updates
      if (currentLocation) {
        updates.currentLocation = {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          accuracy: currentLocation.accuracy,
          speed: currentLocation.speed,
          heading: currentLocation.heading,
          timestamp: currentLocation.timestamp || Date.now(),
        };

        // Add last known coordinate for timer persistence
        updates.lastKnownCoordinate = {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          timestamp: currentLocation.timestamp || Date.now(),
          accuracy: currentLocation.accuracy,
        };
      }

      // Update job in store
      callbacks.updateJob(updates);

      // Determine next update interval based on movement
      const nextInterval = this.getUpdateInterval(movementState, currentLocation?.speed);

      return {
        nextUpdateInterval: nextInterval,
        isJobActive: true,
        metrics,
        pricing,
      };
    } catch (error) {
      console.error('[JobProcessor] ❌ Error processing started state:', error);
      return {
        nextUpdateInterval: STOPPED_UPDATE_INTERVAL,
        isJobActive: true,
      };
    }
  }

  /**
   * Calculate real-time pricing breakdown
   */
  private calculatePricing(
    elapsedSeconds: number,
    distanceMeters: number,
    waitingSeconds: number,
    tariff: any
  ): { totalCost: number; breakdown: any } {
    if (!tariff) {
      console.warn('[JobProcessor] ⚠️ No tariff data for pricing calculation');
      return {
        totalCost: 0,
        breakdown: {
          startingPrice: '0.00',
          distanceCost: '0.00',
          durationCost: '0.00',
          waitingCost: '0.00',
          totalDistance: 0,
          duration: 0,
          waitingSeconds: 0,
        },
      };
    }

    const startingPrice = parseFloat(tariff.baseFare || tariff.startingPrice || 0);
    const distanceRate = parseFloat(tariff.distanceRate || tariff.perKmRate || 0);
    const timeRate = parseFloat(tariff.timeRate || tariff.perMinuteRate || 0);
    const waitingRate = getWaitingRatePerMinute(tariff);

    // Calculate costs (convert meters to km for distance rate)
    const distanceCost = (distanceMeters / 1000) * distanceRate;
    const durationCost = (elapsedSeconds / 60) * timeRate; // Convert seconds to minutes
    const waitingCost = (waitingSeconds / 60) * waitingRate; // Convert seconds to minutes

    const totalCost = startingPrice + distanceCost + durationCost + waitingCost;

    return {
      totalCost: Math.max(0, totalCost),
      breakdown: {
        startingPrice: startingPrice.toFixed(2),
        distanceCost: distanceCost.toFixed(2),
        durationCost: durationCost.toFixed(2),
        waitingCost: waitingCost.toFixed(2),
        waitingRatePerMinute: waitingRate,
        totalDistance: parseFloat(distanceMeters.toFixed(2)),
        duration: parseFloat(elapsedSeconds.toFixed(2)),
        waitingSeconds: parseFloat(waitingSeconds.toFixed(2)),
        totalCost: totalCost.toFixed(2),
      },
    };
  }

  /**
   * Determine update interval based on movement state
   */
  private getUpdateInterval(movementState: string, speed?: number): number {
    switch (movementState) {
      case 'STOPPED':
        return STOPPED_UPDATE_INTERVAL;
      case 'NORMAL_SPEED':
        return NORMAL_SPEED_INTERVAL;
      case 'LITTLE_HIGH_SPEED':
        return LITTLE_HIGH_SPEED_INTERVAL;
      case 'MORE_SPEED':
        return MORE_SPEED_INTERVAL;
      case 'TOO_HIGH_SPEED':
        return TOO_HIGH_SPEED_INTERVAL;
      case 'MOVING':
        // Determine based on speed if available
        if (speed !== undefined && speed !== null) {
          if (speed < 10) return NORMAL_SPEED_INTERVAL;
          if (speed < 40) return LITTLE_HIGH_SPEED_INTERVAL;
          if (speed < 70) return MORE_SPEED_INTERVAL;
          return TOO_HIGH_SPEED_INTERVAL;
        }
        return NORMAL_SPEED_INTERVAL;
      default:
        return STOPPED_UPDATE_INTERVAL;
    }
  }

  /**
   * Start continuous processing
   * Automatically processes job at appropriate intervals
   */
  startContinuousProcessing(
    getCurrentJob: () => any,
    getCurrentLocation: () => LocationUpdate | null,
    getMovementState: () => string,
    callbacks: any
  ): void {
    if (this.isProcessing) {
      console.warn('[JobProcessor] ⚠️ Already processing');
      return;
    }

    this.isProcessing = true;
    console.log('[JobProcessor] ▶️ Started continuous processing');

    const processLoop = async () => {
      const job = getCurrentJob();
      const location = getCurrentLocation();
      const movement = getMovementState();

      const result = await this.processJobState(job, location, movement, callbacks);

      if (this.isProcessing) {
        const baseInterval = this.config.updateInterval ?? DEFAULT_MIN_PROCESS_INTERVAL;
        const delay = Math.max(result.nextUpdateInterval, baseInterval);
        this.processingTimer = setTimeout(processLoop, delay);
      }
    };

    processLoop();
  }

  /**
   * Stop continuous processing
   */
  stopContinuousProcessing(): void {
    this.isProcessing = false;
    
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = null;
    }

    this.lastProcessedLocationKey = null;
    this.duplicateLocationIterations = 0;

    console.log('[JobProcessor] ⏸️ Stopped continuous processing');
  }

  /**
   * Finalize job and get complete history
   */
  async finalizeJob(): Promise<{
    coordinateHistory: any;
    timerMetrics: any;
  }> {
    const coordinateData = await coordinateHistory.stopTracking();
    const timerState = globalJobTimer.getState();

    console.log('[JobProcessor] 🏁 Job finalized:', {
      coordinates: coordinateData?.totalPoints || 0,
      distance: timerState.totalDistanceMeters.toFixed(2) + 'm',
      waiting: timerState.totalWaitingSeconds.toFixed(0) + 's',
    });

    return {
      coordinateHistory: coordinateData,
      timerMetrics: timerState,
    };
  }
}

// Export singleton instance
export const jobProcessor = new JobProcessor();
