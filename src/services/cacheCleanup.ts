/**
 * 🧹 Complete Cache Cleanup Service
 * Clears ALL data when driver logs out
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { globalJobTimer } from '../utils/enhancedJobTimer';
import { disconnectDriverSocket } from './driverSocket';
import { ForegroundService } from './foregroundService';
import { jobProcessor } from './jobProcessor';

/**
 * Clear all cached data across the entire app
 * Called during logout to ensure complete cleanup
 */
export const clearAllAppCache = async (): Promise<void> => {
  console.log('🧹 Starting complete app cache cleanup...');

  try {
    // ✅ 1. Stop job processing services first
    console.log('🛑 Stopping job processors...');
    jobProcessor.stopContinuousProcessing();
    globalJobTimer.reset();
    // Note: coordinateHistory doesn't have a public clear method, but it clears per-job

    // ✅ 2. Disconnect and cleanup socket
    console.log('🔌 Disconnecting socket...');
    disconnectDriverSocket();

    // ✅ 3. Stop foreground service and clear driver data
    console.log('🛑 Stopping foreground service...');
    try {
      await ForegroundService.stop();
      await ForegroundService.clearDriverData();
    } catch (error) {
      console.warn('⚠️ Foreground service cleanup failed (may not be running):', error);
    }

    // ✅ 4. Clear ALL AsyncStorage (nuclear option)
    console.log('💾 Clearing AsyncStorage...');
    const allKeys = await AsyncStorage.getAllKeys();
    if (allKeys.length > 0) {
      console.log(`🗑️ Removing ${allKeys.length} keys:`, allKeys);
      await AsyncStorage.multiRemove(allKeys);
    }

    // ✅ 5. Clear any remaining critical keys (double-check)
    await AsyncStorage.multiRemove([
      // Auth keys
      'authToken',
      'driverProfile',
      
      // Shift keys
      'activeShift',
      'shiftStarted',
      'shiftStartTime',
      'shiftCloseTime',
      
      // Vehicle keys
      'selectedVehicle',
      'driverVehicles',
      
      // Tariff keys
      'selectedTariff',
      'driverTariffs',
      
      // Job keys
      'driverApp:jobState',
      'driverApp:routePoints',
      'driverApp:coordinateHistory',
      'driverApp:jobTimer',
      
      // Location keys
      'lastKnownLocation',
      'locationPermission',
      
      // Zone keys
      'currentZone',
      'zoneTariffs',
      'driverPreferences',
    ]);

    console.log('✅ Complete app cache cleanup finished');
  } catch (error) {
    console.error('❌ Error during cache cleanup:', error);
    throw error;
  }
};

/**
 * Clear specific storage keys (for partial cleanup)
 */
export const clearStorageKeys = async (keys: string[]): Promise<void> => {
  try {
    console.log(`🗑️ Clearing ${keys.length} storage keys:`, keys);
    await AsyncStorage.multiRemove(keys);
    console.log('✅ Storage keys cleared');
  } catch (error) {
    console.error('❌ Failed to clear storage keys:', error);
    throw error;
  }
};

/**
 * Get all storage keys (for debugging)
 */
export const getAllStorageKeys = async (): Promise<readonly string[]> => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    console.log(`📋 Found ${keys.length} storage keys:`, keys);
    return keys;
  } catch (error) {
    console.error('❌ Failed to get storage keys:', error);
    return [];
  }
};

/**
 * Clear all storage except specific keys
 */
export const clearStorageExcept = async (keepKeys: string[]): Promise<void> => {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const keysToRemove = allKeys.filter(key => !keepKeys.includes(key));
    
    if (keysToRemove.length > 0) {
      console.log(`🗑️ Clearing ${keysToRemove.length} keys (keeping ${keepKeys.length})`);
      await AsyncStorage.multiRemove(keysToRemove);
    }
    
    console.log('✅ Selective storage cleanup finished');
  } catch (error) {
    console.error('❌ Failed to clear storage:', error);
    throw error;
  }
};
