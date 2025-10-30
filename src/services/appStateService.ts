/**
 * 📱 APP STATE SERVICE
 * 
 * Tracks app foreground/background state and includes it in location updates.
 * 
 * This helps the dispatcher know if the driver app is:
 * - ACTIVE: App is in foreground, driver is actively using it
 * - BACKGROUND: App is minimized but still running (location tracking active)
 * - INACTIVE: App is about to be suspended
 */

import { AppState, AppStateStatus } from 'react-native';

type AppStateChangeListener = (state: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE') => void;

class AppStateService {
  private currentState: 'ACTIVE' | 'BACKGROUND' | 'INACTIVE' = 'ACTIVE';
  private listeners: Set<AppStateChangeListener> = new Set();
  private appStateSubscription: any = null;
  
  constructor() {
    this.init();
  }
  
  private init() {
    // Subscribe to app state changes
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    
    // Set initial state
    this.currentState = this.mapAppState(AppState.currentState);
    
    console.log('📱 AppStateService initialized - current state:', this.currentState);
  }
  
  private mapAppState(state: AppStateStatus): 'ACTIVE' | 'BACKGROUND' | 'INACTIVE' {
    if (state === 'active') return 'ACTIVE';
    if (state === 'background') return 'BACKGROUND';
    return 'INACTIVE';
  }
  
  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    const newState = this.mapAppState(nextAppState);
    
    if (this.currentState !== newState) {
      console.log(`📱 App state changed: ${this.currentState} → ${newState}`);
      this.currentState = newState;
      
      // Notify all listeners
      this.listeners.forEach(listener => {
        try {
          listener(newState);
        } catch (error) {
          console.error('Error in app state listener:', error);
        }
      });
    }
  };
  
  /**
   * Get current app state
   */
  getState(): 'ACTIVE' | 'BACKGROUND' | 'INACTIVE' {
    return this.currentState;
  }
  
  /**
   * Check if app is in foreground
   */
  isActive(): boolean {
    return this.currentState === 'ACTIVE';
  }
  
  /**
   * Check if app is in background
   */
  isBackground(): boolean {
    return this.currentState === 'BACKGROUND';
  }
  
  /**
   * Subscribe to app state changes
   */
  addListener(listener: AppStateChangeListener): () => void {
    this.listeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.listeners.delete(listener);
    };
  }
  
  /**
   * Cleanup
   */
  destroy() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
    }
    this.listeners.clear();
    console.log('📱 AppStateService destroyed');
  }
}

// Singleton instance
export const appStateService = new AppStateService();

