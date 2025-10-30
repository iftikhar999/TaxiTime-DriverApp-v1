/**
 * 🔥 FOREGROUND SERVICE CONTROLLER
 * 
 * Controls the native Android foreground service that keeps the app alive 24/7.
 * 
 * Usage:
 * ```typescript
 * // Start service when shift starts
 * await ForegroundService.start({
 *   driverName: "John Doe",
 *   status: "Available",
 *   duration: "2h 34m",
 *   earnings: "$127.50",
 *   trips: 5
 * });
 * 
 * // Update notification during shift
 * await ForegroundService.update({
 *   status: "Busy",
 *   earnings: "$142.75",
 *   trips: 6
 * });
 * 
 * // Stop service when shift ends
 * await ForegroundService.stop();
 * ```
 */

import { NativeModules, Platform } from 'react-native';

const { ForegroundServiceModule } = NativeModules;

interface ServiceStats {
  driverName?: string;
  status: string;
  duration?: string;
  earnings?: string;
  trips?: number;
}

class ForegroundServiceController {
  private isServiceRunning = false;

  /**
   * Start the foreground service
   * Call this when driver starts shift
   */
  async start(stats: ServiceStats): Promise<void> {
    if (Platform.OS !== 'android') {
      console.log('⚠️ Foreground service only available on Android');
      return;
    }

    try {
      console.log('🚀 Starting foreground service...', stats);
      
      // ✅ FIX: Check if module exists before calling
      if (!ForegroundServiceModule) {
        console.warn('⚠️ ForegroundServiceModule not available - foreground service disabled');
        console.warn('⚠️ App may be killed when removed from recent apps');
        return; // Don't throw error, just skip
      }
      
      await ForegroundServiceModule.startService(
        stats.driverName || 'Driver',
        stats.status,
        stats.duration || '0h 0m',
        stats.earnings || '$0.00',
        stats.trips || 0
      );
      
      this.isServiceRunning = true;
      console.log('✅ Foreground service started successfully');
      
    } catch (error) {
      console.error('❌ Failed to start foreground service:', error);
      // Don't throw - allow app to continue without foreground service
    }
  }

  /**
   * Update notification with new stats
   * Call this periodically to update shift stats
   */
  async update(stats: ServiceStats): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!ForegroundServiceModule) {
      return; // Module not available
    }

    if (!this.isServiceRunning) {
      console.warn('⚠️ Service not running - starting it now');
      return this.start(stats);
    }

    try {
      console.log('🔄 Updating foreground service notification...', stats);
      
      await ForegroundServiceModule.updateNotification(
        stats.driverName || 'Driver',
        stats.status,
        stats.duration || '0h 0m',
        stats.earnings || '$0.00',
        stats.trips || 0
      );
      
      console.log('✅ Notification updated');
      
    } catch (error) {
      console.error('❌ Failed to update notification:', error);
    }
  }

  /**
   * Stop the foreground service
   * Call this when driver ends shift
   */
  async stop(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!ForegroundServiceModule) {
      return; // Module not available
    }

    try {
      console.log('🛑 Stopping foreground service...');
      
      await ForegroundServiceModule.stopService();
      
      this.isServiceRunning = false;
      console.log('✅ Foreground service stopped');
      
    } catch (error) {
      console.error('❌ Failed to stop foreground service:', error);
      // Don't throw - allow app to continue
    }
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.isServiceRunning;
  }

  /**
   * 💓 Save driver data for native heartbeat
   * Call this when shift starts
   */
  async saveDriverData(driverId: string, shiftId: string, authToken: string): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!ForegroundServiceModule) {
      return; // Module not available
    }

    try {
      console.log('💓 Saving driver data for native heartbeat...');
      
      await ForegroundServiceModule.saveDriverData(driverId, shiftId, authToken);
      
      console.log('✅ Driver data saved for heartbeat');
      
    } catch (error) {
      console.error('❌ Failed to save driver data:', error);
    }
  }

  /**
   * 🧹 Clear driver data when shift ends
   * Call this when shift ends
   */
  async clearDriverData(): Promise<void> {
    if (Platform.OS !== 'android') {
      return;
    }

    if (!ForegroundServiceModule) {
      return; // Module not available
    }

    try {
      console.log('🧹 Clearing driver data...');
      
      await ForegroundServiceModule.clearDriverData();
      
      console.log('✅ Driver data cleared');
      
    } catch (error) {
      console.error('❌ Failed to clear driver data:', error);
    }
  }
}

export const ForegroundService = new ForegroundServiceController();

