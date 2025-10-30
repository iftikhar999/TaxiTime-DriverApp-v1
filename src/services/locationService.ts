import AsyncStorage from "@react-native-async-storage/async-storage";
import { detectZoneAndGetTariffs } from "./zoneService";

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: number;
}

export interface LocationUpdateCallback {
  onLocationUpdate: (location: LocationData) => void;
  onZoneChange: (zone: any, tariffs: any[]) => void;
  onError: (error: string) => void;
}

class LocationService {
  private currentLocation: LocationData | null = null;
  private currentZone: any | null = null;
  private callbacks: LocationUpdateCallback[] = [];
  private isTracking = false;
  private zoneCheckInterval: any = null;

  /**
   * Start location tracking
   */
  async startLocationTracking(
    driverId: string,
    companyId: string
  ): Promise<boolean> {
    try {
      console.log("📍 Starting location tracking...");

      this.isTracking = true;

      // Simulate location updates for testing (replace with actual GPS later)
      this.simulateLocationUpdates(driverId, companyId);

      // Set up periodic zone checking (every 30 seconds)
      this.zoneCheckInterval = setInterval(() => {
        if (this.currentLocation) {
          this.checkZoneChange(driverId, companyId);
        }
      }, 30000);

      return true;
    } catch (error) {
      console.error("❌ Failed to start location tracking:", error);
      this.notifyError(
        `Failed to start location tracking: ${(error as Error).message}`
      );
      return false;
    }
  }

  /**
   * Stop location tracking
   */
  stopLocationTracking(): void {
    console.log("🛑 Stopping location tracking...");

    if (this.zoneCheckInterval) {
      clearInterval(this.zoneCheckInterval);
      this.zoneCheckInterval = null;
    }

    this.isTracking = false;
    this.currentLocation = null;
    this.currentZone = null;
  }

  /**
   * Simulate location updates for testing (replace with actual GPS later)
   */
  private simulateLocationUpdates(driverId: string, companyId: string): void {
    // Simulate Doha, Qatar location (you can change this)
    const testLocation: LocationData = {
      latitude: 25.2854,
      longitude: 51.531,
      accuracy: 10,
      timestamp: Date.now(),
    };

    this.handleLocationUpdate(testLocation, driverId, companyId);
  }

  /**
   * Handle location updates
   */
  private async handleLocationUpdate(
    location: LocationData,
    driverId: string,
    companyId: string
  ): Promise<void> {
    this.currentLocation = location;

    // Store location in AsyncStorage
    await AsyncStorage.setItem("lastKnownLocation", JSON.stringify(location));

    // Notify callbacks
    this.notifyLocationUpdate(location);

    console.log(
      `📍 Location updated: ${location.latitude}, ${location.longitude}`
    );

    // Check zone immediately on location update
    await this.checkZoneChange(driverId, companyId);
  }

  /**
   * Check for zone changes
   */
  private async checkZoneChange(
    driverId: string,
    companyId: string
  ): Promise<void> {
    if (!this.currentLocation) return;

    try {
      const { zone, tariffs } = await detectZoneAndGetTariffs(
        this.currentLocation.latitude,
        this.currentLocation.longitude,
        companyId,
        driverId
      );

      // Check if zone has changed
      const previousZoneId = this.currentZone?.id;
      const newZoneId = zone?.id;

      if (previousZoneId !== newZoneId) {
        console.log(
          `🔄 Zone changed: ${previousZoneId || "None"} → ${newZoneId || "None"}`
        );

        this.currentZone = zone;
        this.notifyZoneChange(zone, tariffs);
      }
    } catch (error) {
      console.error("❌ Error checking zone change:", error);
    }
  }

  /**
   * Update location manually (for testing or manual input)
   */
  async updateLocation(
    latitude: number,
    longitude: number,
    driverId: string,
    companyId: string
  ): Promise<void> {
    const location: LocationData = {
      latitude,
      longitude,
      accuracy: 10,
      timestamp: Date.now(),
    };

    await this.handleLocationUpdate(location, driverId, companyId);
  }

  /**
   * Add callback for location updates
   */
  addCallback(callback: LocationUpdateCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove callback
   */
  removeCallback(callback: LocationUpdateCallback): void {
    const index = this.callbacks.indexOf(callback);
    if (index > -1) {
      this.callbacks.splice(index, 1);
    }
  }

  /**
   * Notify all callbacks of location update
   */
  private notifyLocationUpdate(location: LocationData): void {
    this.callbacks.forEach((callback) => {
      try {
        callback.onLocationUpdate(location);
      } catch (error) {
        console.error("❌ Error in location update callback:", error);
      }
    });
  }

  /**
   * Notify all callbacks of zone change
   */
  private notifyZoneChange(zone: any, tariffs: any[]): void {
    this.callbacks.forEach((callback) => {
      try {
        callback.onZoneChange(zone, tariffs);
      } catch (error) {
        console.error("❌ Error in zone change callback:", error);
      }
    });
  }

  /**
   * Notify all callbacks of errors
   */
  private notifyError(error: string): void {
    this.callbacks.forEach((callback) => {
      try {
        callback.onError(error);
      } catch (error) {
        console.error("❌ Error in error callback:", error);
      }
    });
  }

  /**
   * Get current location
   */
  getCurrentLocation(): LocationData | null {
    return this.currentLocation;
  }

  /**
   * Get current zone
   */
  getCurrentZone(): any | null {
    return this.currentZone;
  }

  /**
   * Check if currently tracking
   */
  isCurrentlyTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Force zone check with current location
   */
  async forceZoneCheck(driverId: string, companyId: string): Promise<void> {
    if (this.currentLocation) {
      await this.checkZoneChange(driverId, companyId);
    }
  }
}

// Export singleton instance
export const locationService = new LocationService();
