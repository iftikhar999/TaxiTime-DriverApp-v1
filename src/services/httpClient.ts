import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_BASE_URL, __DEV_MODE__, logger } from "../config/environment";

const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

// ✅ Global logout callback - will be set by AuthContext
let logoutCallback: (() => Promise<void>) | null = null;

export const registerLogoutCallback = (callback: () => Promise<void>) => {
  logoutCallback = callback;
  console.log('✅ Logout callback registered with httpClient');
};

// ✅ OPTIMIZATION: Track in-flight requests for deduplication
const inflightRequests = new Map<string, Promise<any>>();

httpClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("authToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // ✅ OPTIMIZATION: Only log in dev mode
  if (__DEV_MODE__) {
    logger.debug('🌐 HTTP:', config.method?.toUpperCase(), config.url);
  }
  
  return config;
});

// Response interceptor for error handling
httpClient.interceptors.response.use(
  (response) => {
    // ✅ OPTIMIZATION: Minimal success logging
    if (__DEV_MODE__) {
      logger.debug('✅', response.status, response.config.url);
    }
    return response;
  },
  async (error) => {
    const url = error.config?.url || '';
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message;

    // ✅ Suppress red error screen for expected/non-critical HTTP errors
    // These are handled gracefully by callers (e.g. ShiftContext catches "No active shift")
    const isExpectedError =
      (status === 400 && url.includes('/shift/')) ||   // "No active shift found" etc.
      (status === 404 && url.includes('/shift/'));       // Shift not found

    const errorDetails = {
      url,
      status,
      message,
      data: error.response?.data,
    };

    if (isExpectedError) {
      // Log as warning, not error — avoids triggering the red error overlay in dev
      logger.warn('⚠️ HTTP expected error:', JSON.stringify(errorDetails, null, 2));
    } else {
      logger.error('🔴 HTTP ERROR:', JSON.stringify(errorDetails, null, 2));
    }
    
    // Don't auto-logout for status update API calls - let the app handle gracefully
    const isStatusUpdate = error.config?.url?.includes("/shift/status");
    const isAuthentication = error.config?.url?.includes("/auth/");
    const isLogin = error.config?.url?.includes("/login");

    if (
      error.response?.status === 401 &&
      !isStatusUpdate &&
      !isAuthentication &&
      !isLogin
    ) {
      // Token is invalid - trigger automatic logout
      logger.warn("⚠️ 401 Unauthorized - Token invalid. Triggering automatic logout...");
      
      if (logoutCallback) {
        // Call logout in a non-blocking way to avoid blocking the error propagation
        setTimeout(() => {
          logoutCallback!().catch(err => {
            logger.error('❌ Auto-logout failed:', err);
          });
        }, 100);
      } else {
        logger.error('❌ No logout callback registered - cannot auto-logout');
      }
    }

    return Promise.reject(error);
  }
);

export default httpClient;
