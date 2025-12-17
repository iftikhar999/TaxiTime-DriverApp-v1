import axios, { AxiosInstance } from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";

const API_BASE = process.env.API_BASE_URL || "http://localhost:5000";

/**
 * Simple offline queue slot for write actions. This is intentionally light-weight
 * to avoid pulling the full offlineQueue service into the test surface.
 */
const PENDING_KEY = "@driver_v2_pending_requests";

const createClient = (baseURL: string): AxiosInstance =>
  axios.create({
    baseURL,
    timeout: 15000,
    headers: { "Content-Type": "application/json" },
  });

export const v2Client = createClient(`${API_BASE}/api/v2`);
export const v1Client = createClient(`${API_BASE}/api`);

// Attach auth token if present
[v1Client, v2Client].forEach((client) => {
  client.interceptors.request.use(async (config) => {
    const token = await AsyncStorage.getItem("@auth_token");
    if (token) {
      config.headers = config.headers || {};
      (config.headers as any).Authorization = `Bearer ${token}`;
    }
    return config;
  });
});

export const offlineQueue = {
  async enqueue(request: any) {
    const existingRaw = await AsyncStorage.getItem(PENDING_KEY);
    const list = existingRaw ? JSON.parse(existingRaw) : [];
    list.push({ id: Date.now(), ...request });
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
  },
  async flush() {
    const state = await NetInfo.fetch();
    if (!state.isConnected) return;
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const remaining: any[] = [];
    for (const item of list) {
      try {
        await v2Client.request(item.config);
      } catch (err) {
        remaining.push(item);
      }
    }
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(remaining));
  },
};

export const withFallback = async <T>(
  fn: () => Promise<T>,
  fallback: () => Promise<T>
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    return fallback();
  }
};

export default { v2Client, v1Client, withFallback, offlineQueue };
