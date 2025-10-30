/**
 * 📊 Tariff Change History Service
 * 
 * Tracks tariff changes during a job for transparency and auditing.
 * 
 * Features:
 * - Track all tariff switches during a job
 * - Calculate time/distance under each tariff
 * - Store in AsyncStorage for persistence
 * - Display in job summary
 * 
 * @module tariffHistory
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

const TARIFF_HISTORY_STORAGE_KEY = '@tariff_history';

export interface TariffChange {
  id: string;
  jobId: string;
  tariffId: string;
  tariffName: string;
  changedAt: number; // timestamp
  changedBy: 'driver' | 'system' | 'auto';
  reason?: string;
  position?: {
    latitude: number;
    longitude: number;
  };
  metrics?: {
    distanceBefore: number; // meters
    timeBefore: number; // seconds
  };
}

export interface TariffPeriod {
  tariffId: string;
  tariffName: string;
  startTime: number;
  endTime: number | null; // null if still active
  duration: number; // seconds
  distance: number; // meters
  fareCalculated: number;
}

export interface JobTariffHistory {
  jobId: string;
  changes: TariffChange[];
  periods: TariffPeriod[];
  startedAt: number;
  completedAt?: number;
}

class TariffHistoryService {
  private histories: Map<string, JobTariffHistory> = new Map();

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    logger.info('system', 'Initializing tariff history service...');
    await this.loadHistories();
    logger.info('system', 'Tariff history service initialized');
  }

  /**
   * Start tracking tariff for a job
   */
  async startTracking(
    jobId: string,
    initialTariffId: string,
    initialTariffName: string
  ): Promise<void> {
    const history: JobTariffHistory = {
      jobId,
      changes: [],
      periods: [
        {
          tariffId: initialTariffId,
          tariffName: initialTariffName,
          startTime: Date.now(),
          endTime: null,
          duration: 0,
          distance: 0,
          fareCalculated: 0,
        },
      ],
      startedAt: Date.now(),
    };

    this.histories.set(jobId, history);
    await this.persistHistories();

    logger.info('job', 'Started tariff tracking', {
      jobId,
      tariff: initialTariffName,
    });
  }

  /**
   * Record a tariff change
   */
  async changeTariff(
    jobId: string,
    newTariffId: string,
    newTariffName: string,
    changedBy: 'driver' | 'system' | 'auto',
    reason?: string,
    position?: { latitude: number; longitude: number },
    currentMetrics?: { distance: number; time: number }
  ): Promise<void> {
    const history = this.histories.get(jobId);
    if (!history) {
      logger.warn('job', 'Tariff history not found for job', { jobId });
      return;
    }

    const now = Date.now();

    // End current period
    const currentPeriod = history.periods[history.periods.length - 1];
    if (currentPeriod && !currentPeriod.endTime) {
      currentPeriod.endTime = now;
      currentPeriod.duration = Math.floor((now - currentPeriod.startTime) / 1000);
      
      // Set distance from metrics if provided
      if (currentMetrics) {
        currentPeriod.distance = currentMetrics.distance;
      }
    }

    // Record the change
    const change: TariffChange = {
      id: `${jobId}_${now}_${Math.random().toString(36).substr(2, 9)}`,
      jobId,
      tariffId: newTariffId,
      tariffName: newTariffName,
      changedAt: now,
      changedBy,
      reason,
      position,
      metrics: currentMetrics
        ? {
            distanceBefore: currentMetrics.distance,
            timeBefore: currentMetrics.time,
          }
        : undefined,
    };

    history.changes.push(change);

    // Start new period
    history.periods.push({
      tariffId: newTariffId,
      tariffName: newTariffName,
      startTime: now,
      endTime: null,
      duration: 0,
      distance: 0,
      fareCalculated: 0,
    });

    await this.persistHistories();

    logger.info('job', 'Tariff changed', {
      jobId,
      from: currentPeriod?.tariffName,
      to: newTariffName,
      reason,
    });
  }

  /**
   * Update metrics for current tariff period
   */
  async updateMetrics(
    jobId: string,
    distance: number,
    fareCalculated: number
  ): Promise<void> {
    const history = this.histories.get(jobId);
    if (!history) return;

    const currentPeriod = history.periods[history.periods.length - 1];
    if (currentPeriod && !currentPeriod.endTime) {
      currentPeriod.distance = distance;
      currentPeriod.duration = Math.floor((Date.now() - currentPeriod.startTime) / 1000);
      currentPeriod.fareCalculated = fareCalculated;
    }

    // Don't persist on every update (too frequent)
    // Will be persisted on tariff change or job completion
  }

  /**
   * Complete tracking for a job
   */
  async completeTracking(jobId: string): Promise<void> {
    const history = this.histories.get(jobId);
    if (!history) return;

    const now = Date.now();

    // End current period
    const currentPeriod = history.periods[history.periods.length - 1];
    if (currentPeriod && !currentPeriod.endTime) {
      currentPeriod.endTime = now;
      currentPeriod.duration = Math.floor((now - currentPeriod.startTime) / 1000);
    }

    history.completedAt = now;
    await this.persistHistories();

    logger.info('job', 'Completed tariff tracking', {
      jobId,
      changes: history.changes.length,
      periods: history.periods.length,
    });
  }

  /**
   * Get tariff history for a job
   */
  getHistory(jobId: string): JobTariffHistory | undefined {
    return this.histories.get(jobId);
  }

  /**
   * Get all histories
   */
  getAllHistories(): JobTariffHistory[] {
    return Array.from(this.histories.values());
  }

  /**
   * Get tariff breakdown summary
   */
  getTariffBreakdown(jobId: string): {
    totalChanges: number;
    periods: Array<{
      tariffName: string;
      duration: string;
      distance: string;
      fare: string;
    }>;
  } | null {
    const history = this.histories.get(jobId);
    if (!history) return null;

    return {
      totalChanges: history.changes.length,
      periods: history.periods.map((period) => ({
        tariffName: period.tariffName,
        duration: this.formatDuration(period.duration),
        distance: `${(period.distance / 1000).toFixed(2)} km`,
        fare: `$${period.fareCalculated.toFixed(2)}`,
      })),
    };
  }

  /**
   * Format duration (seconds to readable string)
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Clear history for a specific job
   */
  async clearHistory(jobId: string): Promise<void> {
    this.histories.delete(jobId);
    await this.persistHistories();
    logger.info('job', 'Cleared tariff history', { jobId });
  }

  /**
   * Clear old histories (older than 30 days)
   */
  async cleanupOldHistories(): Promise<void> {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const [jobId, history] of this.histories.entries()) {
      if (history.completedAt && history.completedAt < thirtyDaysAgo) {
        this.histories.delete(jobId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.persistHistories();
      logger.info('system', 'Cleaned up old tariff histories', { count: cleaned });
    }
  }

  /**
   * Load histories from storage
   */
  private async loadHistories(): Promise<void> {
    try {
      const historiesJson = await AsyncStorage.getItem(TARIFF_HISTORY_STORAGE_KEY);
      if (historiesJson) {
        const historiesArray: JobTariffHistory[] = JSON.parse(historiesJson);
        this.histories = new Map(historiesArray.map((h) => [h.jobId, h]));
        logger.info('system', 'Loaded tariff histories', { count: this.histories.size });
      }
    } catch (error) {
      logger.error('system', 'Failed to load tariff histories', error as Error);
      this.histories = new Map();
    }
  }

  /**
   * Persist histories to storage
   */
  private async persistHistories(): Promise<void> {
    try {
      const historiesArray = Array.from(this.histories.values());
      await AsyncStorage.setItem(
        TARIFF_HISTORY_STORAGE_KEY,
        JSON.stringify(historiesArray)
      );
    } catch (error) {
      logger.error('system', 'Failed to persist tariff histories', error as Error);
    }
  }

  /**
   * Export history as string for debugging
   */
  exportHistory(jobId: string): string {
    const history = this.histories.get(jobId);
    if (!history) return 'No history found';

    let output = `Tariff History for Job ${jobId}\n`;
    output += `Started: ${new Date(history.startedAt).toLocaleString()}\n`;
    if (history.completedAt) {
      output += `Completed: ${new Date(history.completedAt).toLocaleString()}\n`;
    }
    output += `\nTariff Changes (${history.changes.length}):\n`;

    history.changes.forEach((change, index) => {
      output += `\n${index + 1}. ${new Date(change.changedAt).toLocaleString()}\n`;
      output += `   Changed to: ${change.tariffName}\n`;
      output += `   Changed by: ${change.changedBy}\n`;
      if (change.reason) {
        output += `   Reason: ${change.reason}\n`;
      }
      if (change.metrics) {
        output += `   Distance before: ${(change.metrics.distanceBefore / 1000).toFixed(2)} km\n`;
        output += `   Time before: ${this.formatDuration(change.metrics.timeBefore)}\n`;
      }
    });

    output += `\nTariff Periods (${history.periods.length}):\n`;

    history.periods.forEach((period, index) => {
      output += `\n${index + 1}. ${period.tariffName}\n`;
      output += `   Start: ${new Date(period.startTime).toLocaleString()}\n`;
      if (period.endTime) {
        output += `   End: ${new Date(period.endTime).toLocaleString()}\n`;
      } else {
        output += `   End: (active)\n`;
      }
      output += `   Duration: ${this.formatDuration(period.duration)}\n`;
      output += `   Distance: ${(period.distance / 1000).toFixed(2)} km\n`;
      output += `   Fare: $${period.fareCalculated.toFixed(2)}\n`;
    });

    return output;
  }
}

// Singleton instance
export const tariffHistory = new TariffHistoryService();

// Export for testing
export default tariffHistory;

