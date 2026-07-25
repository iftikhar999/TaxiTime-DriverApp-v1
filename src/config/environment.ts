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
//
// API_BASE_URL / SOCKET_BASE_URL are driven by an env var so we never ship a
// hard-coded production IP. In release builds the env MUST be provided via
// react-native-config (see .env.example); we fail loudly at boot if it isn't.
//
// DEV default: Android emulator host loopback (10.0.2.2). Override via
// API_BASE_URL in .env for a physical device (e.g. http://192.168.x.x:3000).

let envApiBase: string | undefined;
try {
  // react-native-config loads values from android/app/build.gradle (buildConfigField)
  // or ios Info.plist at build time. The import is optional: absence is tolerated
  // in DEV so the app still boots on a fresh clone.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Config = require("react-native-config").default ?? require("react-native-config");
  envApiBase = Config?.API_BASE_URL;
} catch {
  envApiBase = undefined;
}

const DEV_DEFAULT_BASE = "http://10.0.2.2:3000";

const resolveBase = (): string => {
  const trimmed = typeof envApiBase === "string" ? envApiBase.trim() : "";
  if (trimmed.length > 0) {
    return trimmed.replace(/\/$/, "");
  }
  if (__DEV__) {
    console.warn(
      "[env] API_BASE_URL not set — falling back to DEV default " +
        DEV_DEFAULT_BASE +
        ". Copy .env.example to .env to override."
    );
    return DEV_DEFAULT_BASE;
  }
  throw new Error(
    "[env] API_BASE_URL is required in production builds. " +
      "Add it to .env and rebuild with react-native-config."
  );
};

const BASE = resolveBase();

export const API_BASE_URL = `${BASE}/api`;
export const SOCKET_BASE_URL = BASE;

// Pre-fill login with the test driver account. Before this was gated behind
// __DEV__ (release builds started blank); the app isn't publicly launched yet
// and the user wants these filled in so internal testers can sign in without
// retyping. Revisit before the public launch — hard-coded creds should not
// ship to real customers.
export const DEFAULT_DRIVER_CREDENTIALS: { email: string; password: string } = {
  email: "driver1@city001.com",
  password: "123123123",
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
