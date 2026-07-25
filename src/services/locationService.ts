import AsyncStorage from "@react-native-async-storage/async-storage";
import Geolocation, {
  GeolocationError,
  GeolocationResponse,
} from "@react-native-community/geolocation";
import { detectZoneAndGetTariffs } from "./zoneService";

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface LocationUpdateCallback {
  onLocationUpdate: (location: LocationData) => void;
  onZoneChange: (zone: any, tariffs: any[]) => void;
  onError: (error: string) => void;
}

// ⚠️ Mock-location fallback removed (2026-04-22).
// Previously this file carried a `USE_MOCK_LOCATION` flag + hardcoded Doha
// coordinates. Shipping that in a release build was a foot-gun — a flipped
// flag in a hurry would have a production driver reporting fake GPS, which
// breaks fare calculation, ETA, and accountability. If you need mock GPS
// for local development, use Android Studio's Emulator GPS panel or
// `adb emu geo fix <lng> <lat>` — don't re-add it to this file.

class LocationService {
  private currentLocation: LocationData | null = null;
  private currentZone: any | null = null;
  private callbacks: LocationUpdateCallback[] = [];
  private isTracking = false;
  private zoneCheckInterval: any = null;
  private watchId: number | null = null;

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

      this.beginRealGpsWatch(driverId, companyId);

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

    if (this.watchId !== null) {
      try {
        Geolocation.clearWatch(this.watchId);
      } catch (error) {
        console.warn("⚠️ Failed to clear geolocation watch:", error);
      }
      this.watchId = null;
    }

    this.isTracking = false;
    this.currentLocation = null;
    this.currentZone = null;
  }

  /**
   * Subscribe to real GPS fixes via @react-native-community/geolocation.
   * Also issues an immediate getCurrentPosition so we don't wait for the first
   * watch callback (iOS can take several seconds).
   */
  private beginRealGpsWatch(driverId: string, companyId: string): void {
    const onPosition = (pos: GeolocationResponse) => {
      const fix: LocationData = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
        heading: pos.coords.heading ?? undefined,
        speed: pos.coords.speed ?? undefined,
        timestamp: pos.timestamp ?? Date.now(),
      };
      void this.handleLocationUpdate(fix, driverId, companyId);
    };

    const onError = (error: GeolocationError) => {
      console.error("❌ Geolocation error:", error);
      this.notifyError(
        `Geolocation error: ${error?.message || "unknown"} (code ${error?.code ?? "?"})`
      );
    };

    try {
      Geolocation.getCurrentPosition(onPosition, onError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      });

      this.watchId = Geolocation.watchPosition(onPosition, onError, {
        enableHighAccuracy: true,
        distanceFilter: 5,
        interval: 3000,
        fastestInterval: 2000,
      }) as unknown as number;
    } catch (error) {
      console.error("❌ Failed to start geolocation watch:", error);
      this.notifyError(
        `Failed to start GPS: ${(error as Error).message}`
      );
    }
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
