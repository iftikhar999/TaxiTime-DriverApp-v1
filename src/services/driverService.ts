import AsyncStorage from "@react-native-async-storage/async-storage";
import { DriverProfile } from "../types/driver";
import { RecentJobSummary } from "../types/recentJob";
import {
    ActiveShift,
    ShiftCurrentResponse,
    ShiftStartResponse,
    StartShiftPayload,
} from "../types/shift";
import { Tariff } from "../types/tariff";
import { DriverVehiclesResponse } from "../types/vehicle";
import httpClient from "./httpClient";

interface ProfileResponse {
  success: boolean;
  data: DriverProfile;
}

interface VehiclesResponse {
  success: boolean;
  data: DriverVehiclesResponse;
}

export const fetchDriverProfile = async (): Promise<DriverProfile> => {
  const response = await httpClient.get<ProfileResponse>(
    "/mobile/driver/profile"
  );
  return response.data.data;
};

export const fetchDriverVehicles =
  async (): Promise<DriverVehiclesResponse> => {
    const response = await httpClient.get<VehiclesResponse>(
      "/mobile/driver/vehicles"
    );
    return response.data.data;
  };

export const fetchCompanyTariffs = async (
  companyId: string
): Promise<Tariff[]> => {
  const response = await httpClient.get<{ success: boolean; data: Tariff[] }>(
    `/companies/${companyId}/tariffs`
  );
  return response.data.data;
};

/**
 * Fetch tariffs for a specific vehicle based on its zone assignments
 * Only returns tariffs for zones that the vehicle is authorized to operate in
 */
export const fetchVehicleTariffs = async (
  vehicleId: string
): Promise<Tariff[]> => {
  const response = await httpClient.get<{ success: boolean; data: Tariff[] }>(
    `/mobile/driver/vehicles/${vehicleId}/tariffs`
  );
  return response.data.data;
};

export const startDriverShift = async (
  payload: StartShiftPayload
): Promise<ShiftStartResponse> => {
  const response = await httpClient.post<{
    success: boolean;
    message: string;
    data: ShiftStartResponse;
  }>("/mobile/driver/shift/start", payload);
  return response.data.data;
};

const DEFAULT_SHIFT_LOCATION = {
  latitude: 25.2854,
  longitude: 51.531,
  accuracy: 0,
  heading: 0,
  speed: 0,
};

const readLastKnownLocation = async () => {
  try {
    const raw = await AsyncStorage.getItem("lastKnownLocation");
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.latitude === "number" &&
      typeof parsed?.longitude === "number"
    ) {
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to read last known location", error);
  }
  return null;
};

type ShiftLocationPayload = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
};

export const endDriverShift = async (
  locationOverride?: ShiftLocationPayload | null
): Promise<ShiftStartResponse | null> => {
  const storedLocation = locationOverride ?? (await readLastKnownLocation());
  const location = storedLocation ?? DEFAULT_SHIFT_LOCATION;

  console.log("🛑 Ending shift with location:", {
    source: locationOverride ? "override" : storedLocation ? "AsyncStorage" : "default",
    latitude: location.latitude,
    longitude: location.longitude,
    hasAccuracy: location.accuracy !== undefined,
    hasHeading: location.heading !== undefined,
    hasSpeed: location.speed !== undefined,
  });

  const payload = {
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? 0,
      heading: location.heading ?? 0,
      speed: location.speed ?? 0,
    },
  };

  console.log("📤 Sending end shift payload:", JSON.stringify(payload));

  const response = await httpClient.post<{
    success: boolean;
    data: ShiftStartResponse | null;
  }>("/mobile/driver/shift/end", payload);
  
  console.log("✅ Shift ended successfully:", response.data);
  return response.data.data || null;
};

export const fetchCurrentShift = async (): Promise<ActiveShift | null> => {
  const response = await httpClient.get<{
    success: boolean;
    data: ShiftCurrentResponse;
  }>("/mobile/driver/shift/current");
  return response.data.data?.hasActiveShift
    ? (response.data.data.shift ?? null)
    : null;
};

export const fetchRecentJobs = async (
  limit = 3
): Promise<RecentJobSummary[]> => {
  const response = await httpClient.get<{
    success: boolean;
    data: RecentJobSummary[];
  }>("/mobile/driver/jobs/recent", {
    params: { limit },
  });

  const summaries = response.data.data ?? [];
  console.log(
    "📥 Recent jobs response:",
    JSON.stringify(
      {
        count: summaries.length,
        items: summaries,
      },
      null,
      2
    )
  );
  return summaries;
};

export type DriverShiftStatus = "AVAILABLE" | "BUSY" | "AWAY";

export const updateDriverShiftStatus = async (status: DriverShiftStatus) => {
  try {
    const response = await httpClient.put<{
      success: boolean;
      data: { status: DriverShiftStatus };
    }>("/mobile/driver/shift/status", { status });

    // Emit status update via socket for real-time dispatch updates
    const { emitDriverStatus } = require("./driverSocket");
    await emitDriverStatus(status);

    return response.data.data;
  } catch (error: any) {
    // Enhanced error handling - don't throw for authentication errors during status updates
    if (error.response?.status === 401) {
      console.warn(
        `⚠️ Status update authentication failed for ${status} - session preserved`
      );
      // Return a mock success to prevent session disruption
      return { status };
    }

    // ✅ FIX: Handle "No active shift" errors gracefully
    if (error.response?.status === 400) {
      const errorMessage = error.response?.data?.message || "";
      if (errorMessage.includes("No active shift")) {
        console.warn(
          `⚠️ Status update skipped for ${status} - no active shift (driver hasn't started shift yet)`
        );
        // Return a mock success to prevent disrupting the app flow
        return { status };
      }
    }

    // For other errors, still throw but with better context
    const errorPayload = error.response?.data;
    if (errorPayload) {
      console.error(
        `❌ Status update failed for ${status}:`,
        error.message,
        JSON.stringify(errorPayload)
      );
    } else {
      console.error(`❌ Status update failed for ${status}:`, error.message);
    }
    throw error;
  }
};


export interface UpcomingJobSummary {
  id: string;
  jobId: string;
  status: string;
  pickup: { address?: string | null; latitude?: number | null; longitude?: number | null };
  dropoff: { address?: string | null; latitude?: number | null; longitude?: number | null };
  scheduledAt: string | null;
  estimatedFare?: number | null;
  estimatedDistance?: number | null;
  estimatedDuration?: number | null;
  isLate: boolean;
  minutesToPickup: number;
  customer?: { id: string; firstName?: string | null; lastName?: string | null; phone?: string | null } | null;
  zone?: { id: string; name?: string | null } | null;
  distanceToPickup?: number; // Distance from driver's current location to pickup (in km)
}

export const fetchUpcomingJobs = async (
  options?: { zoneId?: string | null }
): Promise<UpcomingJobSummary[]> => {
  const response = await httpClient.get<{
    success?: boolean;
    data?: UpcomingJobSummary[];
  }>("/mobile/driver/jobs/upcoming", {
    params: options?.zoneId ? { zoneId: options.zoneId } : undefined,
  });

  if (Array.isArray((response.data as any)?.data)) {
    return (response.data as any).data as UpcomingJobSummary[];
  }

  return ((response.data as any)?.data as UpcomingJobSummary[] | undefined) ?? [];
};

export const claimUpcomingJob = async (jobId: string) => {
  console.log('🌐 [API] claimUpcomingJob - Making request', { 
    jobId,
    url: `/mobile/driver/jobs/${jobId}/claim`,
    method: 'POST'
  });
  
  try {
    const response = await httpClient.post<{
      success?: boolean;
      data?: any;
    }>(`/mobile/driver/jobs/${jobId}/claim`);
    
    console.log('🌐 [API] claimUpcomingJob - Response received', {
      status: response.status,
      statusText: response.statusText,
      hasData: !!response.data,
      dataKeys: response.data ? Object.keys(response.data) : []
    });
    
    const result = (response.data as any)?.data ?? response.data;
    console.log('🌐 [API] claimUpcomingJob - Returning result', {
      hasResult: !!result,
      resultKeys: result ? Object.keys(result) : []
    });
    
    return result;
  } catch (error: any) {
    console.error('❌ [API] claimUpcomingJob - Request failed', {
      message: error?.message,
      status: error?.response?.status,
      statusText: error?.response?.statusText,
      data: error?.response?.data,
      url: error?.config?.url,
      method: error?.config?.method,
      headers: error?.config?.headers
    });
    throw error;
  }
};
