import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_BASE_URL, __DEV_MODE__, logger } from "../config/environment";

const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

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
    // ✅ Always log errors (even in production)
    logger.error('🔴 HTTP ERROR:', {
      url: error.config?.url,
      status: error.response?.status,
      message: error.response?.data?.message || error.message,
    });
    
    // Don't auto-logout for status update API calls - let the app handle gracefully
    const isStatusUpdate = error.config?.url?.includes("/shift/status");
    const isAuthentication = error.config?.url?.includes("/auth/");

    if (
      error.response?.status === 401 &&
      !isStatusUpdate &&
      !isAuthentication
    ) {
      // Only logout for non-status-update 401 errors
      logger.warn("⚠️ Auth error - preserving session");
    }

    return Promise.reject(error);
  }
);

export default httpClient;
