import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { API_BASE_URL } from "../config/environment";

const httpClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

httpClient.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem("authToken");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor for error handling
httpClient.interceptors.response.use(
  (response) => {
    // Return successful responses as-is
    return response;
  },
  async (error) => {
    // Don't auto-logout for status update API calls - let the app handle gracefully
    const isStatusUpdate = error.config?.url?.includes("/shift/status");
    const isAuthentication = error.config?.url?.includes("/auth/");

    if (
      error.response?.status === 401 &&
      !isStatusUpdate &&
      !isAuthentication
    ) {
      // Only logout for non-status-update 401 errors
      console.warn(
        "⚠️ Authentication error - but preserving session for status updates"
      );
    }

    // For status update failures, just log and continue
    if (isStatusUpdate && error.response?.status === 401) {
      console.warn(
        "⚠️ Status update authentication failed - preserving session"
      );
    }

    return Promise.reject(error);
  }
);

export default httpClient;
