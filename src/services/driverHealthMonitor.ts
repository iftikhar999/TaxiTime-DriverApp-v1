/**
 * Driver Health Monitor & Auto-Recovery System
 * 
 * Monitors critical driver systems and auto-recovers from failures:
 * - Location updates
 * - Socket connection
 * - Heartbeat signals
 * - API connectivity
 * 
 * Recovery Escalation Levels:
 * 1. Soft Recovery: Re-trigger stuck service
 * 2. Medium Recovery: Restart service
 * 3. Hard Recovery: Full reconnection
 * 4. Nuclear Recovery: Alert user + force refresh
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import Toast from "react-native-toast-message";

interface HealthMetrics {
  lastLocationUpdate: number;
  lastLocationEmit: number;
  lastHeartbeat: number;
  lastApiCall: number;
  lastSocketAck: number;
  consecutiveFailures: number;
  recoveryAttempts: number;
}

interface RecoveryCallbacks {
  restartLocationService: () => Promise<void>;
  reconnectSocket: () => Promise<void>;
  refreshDriverState: () => Promise<void>;
  forceStateSync: () => Promise<void>;
}

class DriverHealthMonitor {
  private metrics: HealthMetrics = {
    lastLocationUpdate: Date.now(),
    lastLocationEmit: Date.now(),
    lastHeartbeat: Date.now(),
    lastApiCall: Date.now(),
    lastSocketAck: Date.now(),
    consecutiveFailures: 0,
    recoveryAttempts: 0,
  };

  private callbacks: RecoveryCallbacks | null = null;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private isRecovering = false;
  private isEnabled = false;

  // Thresholds (in milliseconds)
  private readonly LOCATION_UPDATE_TIMEOUT = 15000; // 15 seconds
  private readonly HEARTBEAT_TIMEOUT = 45000; // 45 seconds
  private readonly SOCKET_ACK_TIMEOUT = 60000; // 1 minute
  private readonly API_TIMEOUT = 120000; // 2 minutes
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private readonly RECOVERY_COOLDOWN = 30000; // 30 seconds between recovery attempts

  /**
   * Initialize health monitoring
   */
  initialize(callbacks: RecoveryCallbacks) {
    this.callbacks = callbacks;
    this.isEnabled = true;

    // Start monitoring every 10 seconds
    this.monitorInterval = setInterval(() => {
      this.performHealthCheck();
    }, 10000);

    console.log("✅ Driver Health Monitor initialized");
  }

  /**
   * Update location update timestamp
   */
  recordLocationUpdate() {
    this.metrics.lastLocationUpdate = Date.now();
    this.metrics.consecutiveFailures = 0; // Reset on success
  }

  /**
   * Update location emit timestamp (when sent via socket)
   */
  recordLocationEmit() {
    this.metrics.lastLocationEmit = Date.now();
  }

  /**
   * Update heartbeat timestamp
   */
  recordHeartbeat() {
    this.metrics.lastHeartbeat = Date.now();
  }

  /**
   * Update API call timestamp
   */
  recordApiCall() {
    this.metrics.lastApiCall = Date.now();
  }

  /**
   * Update socket acknowledgment timestamp
   */
  recordSocketAck() {
    this.metrics.lastSocketAck = Date.now();
    this.metrics.consecutiveFailures = 0; // Reset on success
  }

  /**
   * Perform comprehensive health check
   */
  private async performHealthCheck() {
    if (!this.isEnabled || this.isRecovering) {
      return;
    }

    const now = Date.now();
    const issues: string[] = [];

    // Check location updates (CRITICAL)
    const locationAge = now - this.metrics.lastLocationUpdate;
    if (locationAge > this.LOCATION_UPDATE_TIMEOUT) {
      issues.push(`Location stale (${Math.round(locationAge / 1000)}s)`);
    }

    // Check location emissions (CRITICAL)
    const emitAge = now - this.metrics.lastLocationEmit;
    if (emitAge > this.LOCATION_UPDATE_TIMEOUT) {
      issues.push(`Location not emitted (${Math.round(emitAge / 1000)}s)`);
    }

    // Check heartbeat
    const heartbeatAge = now - this.metrics.lastHeartbeat;
    if (heartbeatAge > this.HEARTBEAT_TIMEOUT) {
      issues.push(`Heartbeat stale (${Math.round(heartbeatAge / 1000)}s)`);
    }

    // Check socket connection
    const socketAge = now - this.metrics.lastSocketAck;
    if (socketAge > this.SOCKET_ACK_TIMEOUT) {
      issues.push(`Socket unresponsive (${Math.round(socketAge / 1000)}s)`);
    }

    if (issues.length > 0) {
      console.warn("⚠️ Health check detected issues:", issues);
      this.metrics.consecutiveFailures++;
      await this.initiateRecovery(issues);
    } else {
      // All systems healthy
      if (this.metrics.consecutiveFailures > 0) {
        console.log("✅ Health check: All systems recovered");
        this.metrics.consecutiveFailures = 0;
        this.metrics.recoveryAttempts = 0;
      }
    }
  }

  /**
   * Initiate recovery based on escalation level
   */
  private async initiateRecovery(issues: string[]) {
    if (!this.callbacks || this.isRecovering) {
      return;
    }

    // Check if we're in cooldown period
    const timeSinceLastRecovery = Date.now() - this.metrics.lastSocketAck;
    if (
      this.metrics.recoveryAttempts > 0 &&
      timeSinceLastRecovery < this.RECOVERY_COOLDOWN
    ) {
      console.log("⏳ Recovery cooldown active, skipping...");
      return;
    }

    this.isRecovering = true;
    this.metrics.recoveryAttempts++;

    try {
      console.log(
        `🔧 Initiating recovery (attempt ${this.metrics.recoveryAttempts}, failures: ${this.metrics.consecutiveFailures})`
      );

      // Escalation Level 1: Soft Recovery (1-2 failures)
      if (this.metrics.consecutiveFailures <= 2) {
        await this.softRecovery(issues);
      }
      // Escalation Level 2: Medium Recovery (3-4 failures)
      else if (this.metrics.consecutiveFailures <= 4) {
        await this.mediumRecovery(issues);
      }
      // Escalation Level 3: Hard Recovery (5+ failures)
      else {
        await this.hardRecovery(issues);
      }
    } catch (error) {
      console.error("❌ Recovery failed:", error);
      
      // If recovery itself fails too many times, escalate to nuclear
      if (this.metrics.recoveryAttempts >= 5) {
        await this.nuclearRecovery();
      }
    } finally {
      this.isRecovering = false;
    }
  }

  /**
   * Soft Recovery: Re-trigger services
   */
  private async softRecovery(issues: string[]) {
    console.log("🔧 Soft Recovery: Re-triggering services");

    if (issues.some((i) => i.includes("Location"))) {
      console.log("📍 Re-triggering location service...");
      await this.callbacks?.restartLocationService();
      
      Toast.show({
        type: "info",
        text1: "Location Check",
        text2: "Verifying location updates...",
        visibilityTime: 2000,
      });
    }

    // Wait and verify
    await this.delay(3000);
  }

  /**
   * Medium Recovery: Restart services
   */
  private async mediumRecovery(issues: string[]) {
    console.log("🔧 Medium Recovery: Restarting services");

    Toast.show({
      type: "warning",
      text1: "Connection Issue",
      text2: "Reconnecting services...",
      visibilityTime: 3000,
    });

    // Restart location service
    await this.callbacks?.restartLocationService();
    
    // Reconnect socket
    if (issues.some((i) => i.includes("Socket") || i.includes("Heartbeat"))) {
      await this.callbacks?.reconnectSocket();
    }

    // Refresh driver state
    await this.callbacks?.refreshDriverState();

    await this.delay(5000);
  }

  /**
   * Hard Recovery: Full reconnection
   */
  private async hardRecovery(issues: string[]) {
    console.log("🔧 Hard Recovery: Full reconnection");

    Toast.show({
      type: "error",
      text1: "Connection Lost",
      text2: "Performing full recovery...",
      visibilityTime: 4000,
    });

    // Full socket reconnection
    await this.callbacks?.reconnectSocket();
    
    // Restart location service
    await this.callbacks?.restartLocationService();
    
    // Force state sync with server
    await this.callbacks?.forceStateSync();

    await this.delay(8000);
  }

  /**
   * Nuclear Recovery: Alert user + force refresh
   */
  private async nuclearRecovery() {
    console.error("🚨 Nuclear Recovery: Critical failure - user intervention required");

    Toast.show({
      type: "error",
      text1: "Critical Connection Issue",
      text2: "Please restart the app or check your internet connection",
      visibilityTime: 10000,
      position: "top",
    });

    // Log for debugging
    await AsyncStorage.setItem(
      "LAST_CRITICAL_FAILURE",
      JSON.stringify({
        timestamp: Date.now(),
        metrics: this.metrics,
      })
    );

    // Force state sync as last resort
    await this.callbacks?.forceStateSync();
  }

  /**
   * Dispose health monitor
   */
  dispose() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isEnabled = false;
    this.callbacks = null;
    console.log("🧹 Driver Health Monitor disposed");
  }

  /**
   * Utility: Delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const now = Date.now();
    return {
      healthy:
        this.metrics.consecutiveFailures === 0 &&
        now - this.metrics.lastLocationUpdate < this.LOCATION_UPDATE_TIMEOUT,
      metrics: {
        locationAge: now - this.metrics.lastLocationUpdate,
        emitAge: now - this.metrics.lastLocationEmit,
        heartbeatAge: now - this.metrics.lastHeartbeat,
        socketAge: now - this.metrics.lastSocketAck,
        consecutiveFailures: this.metrics.consecutiveFailures,
        recoveryAttempts: this.metrics.recoveryAttempts,
      },
    };
  }
}

export const driverHealthMonitor = new DriverHealthMonitor();

