import { driverStatusManager } from "./enhancedDriverStatusManager";

/**
 * Enhanced Meter Service for real-time telemetry
 * Integrates with enhanced driver status manager for comprehensive tracking
 */
export class MeterService {
  private jobId: string | null = null;
  private startTime: Date | null = null;
  private telemetryInterval: number | null = null;
  private totalDistance = 0;
  private waitingTime = 0;
  private fareAmount = 0;
  private isRunning = false;

  /**
   * Start the meter for a job
   */
  startMeter(jobId: string): void {
    if (this.isRunning) {
      console.warn("⚠️ Meter already running");
      return;
    }

    this.jobId = jobId;
    this.startTime = new Date();
    this.isRunning = true;
    this.totalDistance = 0;
    this.waitingTime = 0;
    this.fareAmount = 0;

    // Emit initial meter start event
    driverStatusManager.emitMeterTelemetry(jobId, "started", {
      elapsedTime: 0,
      distance: 0,
      currentSpeed: 0,
      averageSpeed: 0,
      fareAmount: 0,
      waitingTime: 0,
    });

    // Start periodic telemetry updates
    this.startTelemetryUpdates();

    console.log(`📊 Meter started for job ${jobId}`);
  }

  /**
   * Update meter with new location and movement data
   */
  updateMeter(locationData: {
    latitude: number;
    longitude: number;
    speed?: number; // km/h
    distanceIncrement?: number; // meters
    isStationary?: boolean;
  }): void {
    if (!this.isRunning || !this.jobId || !this.startTime) {
      return;
    }

    const now = new Date();
    const elapsedSeconds = Math.floor(
      (now.getTime() - this.startTime.getTime()) / 1000
    );

    // Update distance
    if (locationData.distanceIncrement) {
      this.totalDistance += locationData.distanceIncrement;
    }

    // Update waiting time if stationary
    if (locationData.isStationary) {
      this.waitingTime += 1; // Increment by 1 second
    }

    // Calculate fare (simplified - should use actual tariff calculation)
    this.calculateFare(elapsedSeconds);

    // Calculate speeds
    const currentSpeed = locationData.speed || 0;
    const averageSpeed =
      this.totalDistance > 0 && elapsedSeconds > 0
        ? this.totalDistance / 1000 / (elapsedSeconds / 3600) // km/h
        : 0;

    // Emit telemetry update
    driverStatusManager.emitMeterTelemetry(this.jobId, "running", {
      elapsedTime: elapsedSeconds,
      distance: this.totalDistance,
      currentSpeed,
      averageSpeed,
      fareAmount: this.fareAmount,
      waitingTime: this.waitingTime,
    });
  }

  /**
   * Stop the meter and emit final telemetry
   */
  stopMeter(): {
    elapsedTime: number;
    distance: number;
    waitingTime: number;
    fareAmount: number;
  } | null {
    if (!this.isRunning || !this.jobId || !this.startTime) {
      console.warn("⚠️ No active meter to stop");
      return null;
    }

    const now = new Date();
    const elapsedSeconds = Math.floor(
      (now.getTime() - this.startTime.getTime()) / 1000
    );

    // Calculate final fare
    this.calculateFare(elapsedSeconds);

    const finalMetrics = {
      elapsedTime: elapsedSeconds,
      distance: this.totalDistance,
      waitingTime: this.waitingTime,
      fareAmount: this.fareAmount,
    };

    // Emit final meter telemetry
    driverStatusManager.emitMeterTelemetry(this.jobId, "stopped", {
      elapsedTime: elapsedSeconds,
      distance: this.totalDistance,
      currentSpeed: 0,
      averageSpeed:
        this.totalDistance > 0 && elapsedSeconds > 0
          ? this.totalDistance / 1000 / (elapsedSeconds / 3600)
          : 0,
      fareAmount: this.fareAmount,
      waitingTime: this.waitingTime,
    });

    // Cleanup
    this.stopTelemetryUpdates();
    this.isRunning = false;
    this.jobId = null;
    this.startTime = null;

    console.log(`📊 Meter stopped - Final: ${JSON.stringify(finalMetrics)}`);
    return finalMetrics;
  }

  /**
   * Get current meter state
   */
  getCurrentState(): {
    isRunning: boolean;
    jobId: string | null;
    elapsedTime: number;
    distance: number;
    waitingTime: number;
    fareAmount: number;
  } {
    const elapsedSeconds = this.startTime
      ? Math.floor((new Date().getTime() - this.startTime.getTime()) / 1000)
      : 0;

    return {
      isRunning: this.isRunning,
      jobId: this.jobId,
      elapsedTime: elapsedSeconds,
      distance: this.totalDistance,
      waitingTime: this.waitingTime,
      fareAmount: this.fareAmount,
    };
  }

  /**
   * Start periodic telemetry updates (every 5 seconds)
   */
  private startTelemetryUpdates(): void {
    this.telemetryInterval = setInterval(() => {
      // This will be called every 5 seconds to send updates
      // Location updates should trigger updateMeter() method
      if (this.isRunning && this.jobId) {
        console.log("📊 Periodic telemetry update");
      }
    }, 5000);
  }

  /**
   * Stop telemetry updates
   */
  private stopTelemetryUpdates(): void {
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
  }

  /**
   * Calculate fare based on elapsed time and distance
   * This is a simplified version - should use actual tariff rules
   */
  private calculateFare(elapsedSeconds: number): void {
    // Basic fare calculation (should be replaced with actual tariff logic)
    const baseFare = 5.0;
    const timeRate = 0.5; // per minute
    const distanceRate = 2.0; // per km
    const waitingRate = 0.25; // per minute waiting

    const timeMinutes = elapsedSeconds / 60;
    const distanceKm = this.totalDistance / 1000;
    const waitingMinutes = this.waitingTime / 60;

    this.fareAmount =
      baseFare +
      timeMinutes * timeRate +
      distanceKm * distanceRate +
      waitingMinutes * waitingRate;

    this.fareAmount = Math.round(this.fareAmount * 100) / 100; // Round to 2 decimals
  }
}

// Export singleton instance
export const meterService = new MeterService();
