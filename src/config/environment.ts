// ============================================
// ENVIRONMENT CONFIGURATION
// ============================================

// Set to false in production to disable verbose logging
export const __DEV_MODE__ = __DEV__ ?? true;

// Logging levels
export const LOG_LEVELS = {
  NONE: 0,
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  DEBUG: 4,
} as const;

// Current log level (reduce in production)
export const CURRENT_LOG_LEVEL = __DEV_MODE__ ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;

// Performance settings
export const PERFORMANCE_CONFIG = {
  // Location update throttling (ms)
  LOCATION_THROTTLE_MS: 3000,
  // Minimum distance change to trigger UI update (meters)
  MIN_LOCATION_CHANGE_METERS: 5,
  // Timer UI update interval (ms)
  TIMER_UPDATE_INTERVAL: 1000,
  // API request cache TTL (ms)
  API_CACHE_TTL: 30000,
  // Debounce delay for status updates (ms)
  STATUS_DEBOUNCE_MS: 500,
  // Maximum retry attempts for failed requests
  MAX_RETRY_ATTEMPTS: 3,
};

// ============================================
// SERVER CONFIGURATION
// ============================================

// For Physical Device (connected via WiFi - use laptop IP)
// export const API_BASE_URL = "http://192.168.1.48:3000/api";
// export const SOCKET_BASE_URL = "http://192.168.1.48:3000";

// For Android Emulator (LOCAL DEVELOPMENT)
// export const API_BASE_URL = "http://10.0.2.2:3000/api";
// export const SOCKET_BASE_URL = "http://10.0.2.2:3000";

// LOCAL DEVELOPMENT - Physical Device via USB (adb reverse tcp:3000 tcp:3000)
export const API_BASE_URL = "http://localhost:3000/api";
export const SOCKET_BASE_URL = "http://localhost:3000";

// PRODUCTION SERVER
// export const API_BASE_URL = "http://54.252.241.150/api";
// export const SOCKET_BASE_URL = "http://54.252.241.150";

export const DEFAULT_DRIVER_CREDENTIALS = {
  email: "driver1@city001.com",
  password: "111111",
};

// ============================================
// OPTIMIZED LOGGER
// ============================================
export const logger = {
  debug: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.DEBUG) {
      console.log(...args);
    }
  },
  info: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.INFO) {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.WARN) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (CURRENT_LOG_LEVEL >= LOG_LEVELS.ERROR) {
      console.error(...args);
    }
  },
};
