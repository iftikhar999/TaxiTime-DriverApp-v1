/**
 * Coordinate History Service
 * 
 * Tracks the complete path taken during a ride for:
 * - Dispute resolution
 * - Route optimization analysis
 * - Fare verification
 * - Customer service
 * 
 * Features:
 * - Efficient storage with batching
 * - Automatic cleanup
 * - Export capabilities
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CoordinatePoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number; // km/h
  heading?: number;
  timestamp: string; // ISO string
}

export interface CoordinateHistoryData {
  jobId: string;
  coordinates: CoordinatePoint[];
  startTime: string;
  endTime?: string;
  totalPoints: number;
}

const STORAGE_KEY_PREFIX = '@coordinate_history_';
const MAX_POINTS_PER_JOB = 10000; // Prevent memory overflow
const BATCH_SIZE = 50; // Store every 50 points

export class CoordinateHistoryService {
  private currentJobId: string | null = null;
  private coordinates: CoordinatePoint[] = [];
  private startTime: string | null = null;
  private batchBuffer: CoordinatePoint[] = [];

  /**
   * Start tracking for a new job
   * @param jobId Job identifier
   */
  async startTracking(jobId: string): Promise<void> {
    console.log('[CoordinateHistory] 🗺️ Start tracking for job:', jobId);
    
    this.currentJobId = jobId;
    this.coordinates = [];
    this.batchBuffer = [];
    this.startTime = new Date().toISOString();

    // Try to restore if this job was being tracked before
    await this.restoreFromStorage(jobId);
  }

  /**
   * Add a coordinate point
   * @param point Coordinate data
   */
  addPoint(point: Omit<CoordinatePoint, 'timestamp'>): void {
    if (!this.currentJobId) {
      console.warn('[CoordinateHistory] ⚠️ Cannot add point: No active tracking');
      return;
    }

    // Check max points limit
    if (this.coordinates.length >= MAX_POINTS_PER_JOB) {
      console.warn(
        `[CoordinateHistory] ⚠️ Max points reached (${MAX_POINTS_PER_JOB}), skipping`
      );
      return;
    }

    const coordinatePoint: CoordinatePoint = {
      ...point,
      timestamp: new Date().toISOString(),
    };

    this.coordinates.push(coordinatePoint);
    this.batchBuffer.push(coordinatePoint);

    // Persist batch when buffer is full
    if (this.batchBuffer.length >= BATCH_SIZE) {
      this.persistBatch().catch((error) => {
        console.error('[CoordinateHistory] ❌ Failed to persist batch:', error);
      });
    }
  }

  /**
   * Stop tracking and finalize history
   * @returns Complete coordinate history
   */
  async stopTracking(): Promise<CoordinateHistoryData | null> {
    if (!this.currentJobId) {
      console.warn('[CoordinateHistory] ⚠️ No active tracking to stop');
      return null;
    }

    console.log('[CoordinateHistory] 🏁 Stopping tracking for job:', this.currentJobId);

    // Persist any remaining points
    if (this.batchBuffer.length > 0) {
      await this.persistBatch();
    }

    const history: CoordinateHistoryData = {
      jobId: this.currentJobId,
      coordinates: this.coordinates,
      startTime: this.startTime!,
      endTime: new Date().toISOString(),
      totalPoints: this.coordinates.length,
    };

    // Save final history
    await this.saveToStorage(history);

    console.log('[CoordinateHistory] ✅ Tracking stopped. Total points:', history.totalPoints);

    // Reset state
    const finalHistory = { ...history };
    this.reset();

    return finalHistory;
  }

  /**
   * Get current tracking data
   * @returns Current coordinate history
   */
  getCurrentHistory(): CoordinateHistoryData | null {
    if (!this.currentJobId || !this.startTime) {
      return null;
    }

    return {
      jobId: this.currentJobId,
      coordinates: this.coordinates,
      startTime: this.startTime,
      totalPoints: this.coordinates.length,
    };
  }

  /**
   * Reset tracking state
   */
  private reset(): void {
    this.currentJobId = null;
    this.coordinates = [];
    this.batchBuffer = [];
    this.startTime = null;
  }

  /**
   * Persist batch to storage
   */
  private async persistBatch(): Promise<void> {
    if (!this.currentJobId || this.batchBuffer.length === 0) {
      return;
    }

    const history = this.getCurrentHistory();
    if (history) {
      await this.saveToStorage(history);
      this.batchBuffer = [];
    }
  }

  /**
   * Save history to AsyncStorage
   * @param history History data to save
   */
  private async saveToStorage(history: CoordinateHistoryData): Promise<void> {
    try {
      const key = `${STORAGE_KEY_PREFIX}${history.jobId}`;
      await AsyncStorage.setItem(key, JSON.stringify(history));
      // console.log(`[CoordinateHistory] 💾 Saved ${history.totalPoints} points to storage`);
    } catch (error) {
      console.error('[CoordinateHistory] ❌ Failed to save to storage:', error);
      throw error;
    }
  }

  /**
   * Restore history from AsyncStorage
   * @param jobId Job identifier
   */
  private async restoreFromStorage(jobId: string): Promise<void> {
    try {
      const key = `${STORAGE_KEY_PREFIX}${jobId}`;
      const data = await AsyncStorage.getItem(key);
      
      if (data) {
        const history: CoordinateHistoryData = JSON.parse(data);
        this.coordinates = history.coordinates || [];
        this.startTime = history.startTime;
        console.log(
          `[CoordinateHistory] 🔄 Restored ${this.coordinates.length} points from storage`
        );
      }
    } catch (error) {
      console.error('[CoordinateHistory] ❌ Failed to restore from storage:', error);
      // Continue with empty history
    }
  }

  /**
   * Clear storage for a specific job
   * @param jobId Job identifier
   */
  async clearJobHistory(jobId: string): Promise<void> {
    try {
      const key = `${STORAGE_KEY_PREFIX}${jobId}`;
      await AsyncStorage.removeItem(key);
      console.log('[CoordinateHistory] 🗑️ Cleared history for job:', jobId);
    } catch (error) {
      console.error('[CoordinateHistory] ❌ Failed to clear history:', error);
    }
  }

  /**
   * Get simplified history for backend transmission
   * Reduces data size by sampling points
   * 
   * @param sampleRate Keep every Nth point (default: 10)
   * @returns Sampled coordinates
   */
  getSampledHistory(sampleRate: number = 10): CoordinatePoint[] {
    return this.coordinates.filter((_, index) => index % sampleRate === 0);
  }

  /**
   * Export history as GeoJSON for mapping tools
   * @returns GeoJSON object
   */
  exportAsGeoJSON(): any {
    if (!this.currentJobId) {
      return null;
    }

    return {
      type: 'Feature',
      properties: {
        jobId: this.currentJobId,
        startTime: this.startTime,
        totalPoints: this.coordinates.length,
      },
      geometry: {
        type: 'LineString',
        coordinates: this.coordinates.map((point) => [
          point.longitude,
          point.latitude,
          // Include altitude as 0 for 3D compatibility
          0,
        ]),
      },
    };
  }

  /**
   * Calculate total path distance
   * Uses haversine formula between consecutive points
   * @returns Total distance in meters
   */
  getTotalDistance(): number {
    if (this.coordinates.length < 2) {
      return 0;
    }

    let totalDistance = 0;
    
    // We need to import the haversine function
    const { calculateHaversineDistance } = require('../utils/haversineDistance');

    for (let i = 1; i < this.coordinates.length; i++) {
      const distance = calculateHaversineDistance(
        this.coordinates[i - 1],
        this.coordinates[i]
      );
      totalDistance += distance;
    }

    return totalDistance;
  }
}

// Export singleton instance
export const coordinateHistory = new CoordinateHistoryService();

