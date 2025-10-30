/**
 * Timer Synchronization - Client Side (Driver App)
 * 
 * Synchronizes timers with server-issued timestamps
 * to prevent drift between driver and dispatcher
 */

interface TimerData {
  expiresAt: string;      // ISO timestamp when timer expires
  serverTime: string;     // ISO timestamp of server's current time
  durationMs: number;     // Total duration in ms
  createdAt?: string;     // ISO timestamp when created
}

interface MeterTimer {
  startTime: string;      // ISO timestamp when meter started
  serverTime: string;     // Current server time
  elapsedMs: number;      // Elapsed time in ms
}

/**
 * Calculate clock skew between client and server
 * @param serverTime - Server's current time (ISO string)
 * @returns Clock skew in milliseconds (positive if server is ahead)
 */
export function calculateClockSkew(serverTime: string): number {
  const server = new Date(serverTime).getTime();
  const local = Date.now();
  return server - local;
}

let cachedClockSkew = 0;

/**
 * Update cached clock skew
 * @param serverTime - Server's current time
 */
export function updateClockSkew(serverTime: string): void {
  cachedClockSkew = calculateClockSkew(serverTime);
  console.log(`⏱️ Clock skew updated: ${cachedClockSkew}ms (${cachedClockSkew > 0 ? 'server ahead' : 'client ahead'})`);
}

/**
 * Get adjusted current time (compensated for clock skew)
 * @returns Adjusted timestamp in milliseconds
 */
export function getAdjustedTime(): number {
  return Date.now() + cachedClockSkew;
}

/**
 * Calculate remaining time for a timer
 * @param timerData - Timer data from server
 * @returns Remaining time in milliseconds (0 if expired)
 */
export function getRemainingTime(timerData: TimerData): number {
  // Update clock skew
  updateClockSkew(timerData.serverTime);
  
  // Calculate remaining time with adjusted clock
  const expiresAt = new Date(timerData.expiresAt).getTime();
  const now = getAdjustedTime();
  const remaining = expiresAt - now;
  
  return Math.max(0, remaining);
}

/**
 * Check if timer has expired
 * @param timerData - Timer data from server
 * @returns True if expired
 */
export function isTimerExpired(timerData: TimerData): boolean {
  return getRemainingTime(timerData) === 0;
}

/**
 * Create a countdown timer that automatically updates
 * @param timerData - Timer data from server
 * @param onTick - Callback called every second with remaining time
 * @param onExpire - Callback called when timer expires
 * @returns Cleanup function to stop the timer
 */
export function createCountdownTimer(
  timerData: TimerData,
  onTick: (remainingMs: number) => void,
  onExpire: () => void
): () => void {
  let remaining = getRemainingTime(timerData);
  
  // Call immediately
  onTick(remaining);
  
  // If already expired, call onExpire and return
  if (remaining === 0) {
    onExpire();
    return () => {};
  }
  
  // Update every 100ms for smooth countdown
  const interval = setInterval(() => {
    remaining = getRemainingTime(timerData);
    onTick(remaining);
    
    if (remaining === 0) {
      clearInterval(interval);
      onExpire();
    }
  }, 100);
  
  return () => clearInterval(interval);
}

/**
 * Format time duration for display
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "1:23" for 1 minute 23 seconds)
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes > 0) {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
  
  return `${seconds}s`;
}

/**
 * Format time duration in detailed format
 * @param ms - Duration in milliseconds
 * @returns Object with hours, minutes, seconds, formatted string
 */
export function formatDetailedDuration(ms: number): {
  hours: number;
  minutes: number;
  seconds: number;
  formatted: string;
} {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  let formatted = '';
  if (hours > 0) {
    formatted += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    formatted += `${minutes}m `;
  }
  formatted += `${seconds}s`;
  
  return {
    hours,
    minutes,
    seconds,
    formatted: formatted.trim(),
  };
}

/**
 * Calculate elapsed time for a meter timer
 * @param meterTimer - Meter timer data from server
 * @returns Elapsed time in milliseconds
 */
export function getMeterElapsed(meterTimer: MeterTimer): number {
  // Update clock skew
  updateClockSkew(meterTimer.serverTime);
  
  // Calculate elapsed time with adjusted clock
  const startTime = new Date(meterTimer.startTime).getTime();
  const now = getAdjustedTime();
  
  return now - startTime;
}

/**
 * Format meter time for display (HH:MM:SS)
 * @param ms - Elapsed time in milliseconds
 * @returns Formatted string (e.g., "01:23:45")
 */
export function formatMeterTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Create a meter timer that automatically updates
 * @param startTime - ISO timestamp when meter started
 * @param serverTime - Current server time
 * @param onTick - Callback called every second with elapsed time
 * @returns Cleanup function to stop the timer
 */
export function createMeterTimer(
  startTime: string,
  serverTime: string,
  onTick: (elapsedMs: number) => void
): () => void {
  const meterTimer: MeterTimer = {
    startTime,
    serverTime,
    elapsedMs: 0,
  };
  
  // Call immediately
  let elapsed = getMeterElapsed(meterTimer);
  onTick(elapsed);
  
  // Update every second
  const interval = setInterval(() => {
    elapsed = getMeterElapsed(meterTimer);
    onTick(elapsed);
  }, 1000);
  
  return () => clearInterval(interval);
}

/**
 * Sync timer data with server update
 * Useful when server sends timer updates
 * @param existingTimer - Current timer data
 * @param serverUpdate - New timer data from server
 * @returns Whether timer was updated (true if significant change)
 */
export function syncTimerWithServer(
  existingTimer: TimerData,
  serverUpdate: TimerData
): boolean {
  // Check if expiration time changed
  const existingExpiry = new Date(existingTimer.expiresAt).getTime();
  const newExpiry = new Date(serverUpdate.expiresAt).getTime();
  
  // Update clock skew
  updateClockSkew(serverUpdate.serverTime);
  
  // If expiry changed by more than 1 second, it's a significant change
  const diff = Math.abs(existingExpiry - newExpiry);
  return diff > 1000;
}

