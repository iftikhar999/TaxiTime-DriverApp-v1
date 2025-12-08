import AsyncStorage from "@react-native-async-storage/async-storage";
import { DriverProfile } from "../types/driver";
import { endDriverShift } from "./driverService";
import { driverStatusManager } from "./enhancedDriverStatusManager";
import httpClient from "./httpClient";

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  companyCode: string;
  licenseNumber?: string;
  licenseExpiry?: string;
}

export interface AuthResponse {
  token: string;
  driver?: DriverProfile;
}

export const login = async (payload: LoginPayload): Promise<AuthResponse> => {
  const response = await httpClient.post<{
    message: string;
    token: string;
    user: any;
  }>("/auth/login", payload);

  const token = response.data?.token;
  const rawUser = response.data?.user;

  // ✅ FIX: Map login response to match DriverProfile structure
  // Extract companyId from company object if present
  const driver = rawUser ? {
    ...rawUser,
    companyId: rawUser.companyId || rawUser.company?.id, // ✅ CRITICAL: Extract companyId
    profileImage: rawUser.avatar, // Map avatar to profileImage
  } : undefined;

  console.log('✅ Login response mapped:', {
    hasUser: !!rawUser,
    hasCompanyId: !!driver?.companyId,
    companyId: driver?.companyId,
    fromCompanyObject: rawUser?.company?.id,
  });

  if (token) {
    await AsyncStorage.setItem("authToken", token);
  }

  if (driver) {
    await AsyncStorage.setItem("driverProfile", JSON.stringify(driver));
  }

  return {
    token: token ?? "",
    driver,
  };
};

export const registerDriver = async (
  payload: RegisterPayload
): Promise<AuthResponse> => {
  const response = await httpClient.post<{
    success: boolean;
    data?: unknown;
    message?: string;
  }>("/auth/register", payload);

  return {
    token: "",
    driver: undefined,
  };
};

export const logout = async (): Promise<void> => {
  try {
    // 1. Call REST API to end shift properly
    console.log("🚪 Starting logout process...");
    try {
      const driverState = driverStatusManager.getDriverState();
      const locationPayload = driverState?.location || null;
      
      console.log("📍 Ending shift with location:", locationPayload ? "from driver state" : "will use fallback");
      await endDriverShift(locationPayload);
      console.log("✅ Shift ended via REST API");
    } catch (apiError: any) {
      // Check if it's a 400 error about no active shift
      if (apiError.response?.status === 400) {
        const errorMessage = apiError.response?.data?.message || "";
        if (errorMessage.includes("No active shift")) {
          console.log("ℹ️ No active shift to end - continuing with logout");
        } else {
          console.warn(
            "⚠️ Failed to end shift via API (400):",
            errorMessage
          );
        }
      } else {
        console.warn(
          "⚠️ Failed to end shift via API, continuing with socket cleanup:",
          apiError.message || apiError
        );
      }
    }

    // 2. End shift via socket and set status to OFFLINE (triggers socket events to dispatch)
    await driverStatusManager.endShift();

    // 3. Allow time for socket events to complete
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));

    // 4. Dispose of driver status manager (disconnects socket)
    driverStatusManager.dispose();

    // 5. Clear all authentication data and local storage
    await AsyncStorage.multiRemove([
      "authToken",
      "driverProfile",
      "driverState", // Clear cached driver state
      "lastKnownLocation", // Clear location data
    ]);

    console.log(
      "✅ Logout completed - driver offline, socket disconnected, data cleared"
    );
  } catch (error) {
    console.error("❌ Error during logout:", error);

    // Fallback: Force cleanup even if something fails
    driverStatusManager.dispose();
    await AsyncStorage.clear(); // Nuclear option for cleanup

    throw error;
  }
};
