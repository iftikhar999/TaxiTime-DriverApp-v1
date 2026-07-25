import AsyncStorage from "@react-native-async-storage/async-storage";
import { __DEV_MODE__, logger } from "../config/environment";
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
import { apiRequestManager } from "./apiRequestManager";
import httpClient from "./httpClient";

interface ProfileResponse {
  success: boolean;
  data: DriverProfile;
}

interface VehiclesResponse {
  success: boolean;
  data: DriverVehiclesResponse;
}

// ✅ OPTIMIZATION: Use request manager for caching and deduplication
export const fetchDriverProfile = async (): Promise<DriverProfile> => {
  return apiRequestManager.request(
    '/mobile/driver/profile',
    async () => {
      const response = await httpClient.get<ProfileResponse>("/mobile/driver/profile");
      return response.data.data;
    },
    undefined,
    { cacheTtl: 60000 } // Cache for 1 minute
  );
};

export const fetchDriverVehicles = async (): Promise<DriverVehiclesResponse> => {
  return apiRequestManager.request(
    '/mobile/driver/vehicles',
    async () => {
      const response = await httpClient.get<VehiclesResponse>("/mobile/driver/vehicles");
      return response.data.data;
    },
    undefined,
    { cacheTtl: 120000 } // Cache for 2 minutes
  );
};

export const fetchCompanyTariffs = async (companyId: string): Promise<Tariff[]> => {
  return apiRequestManager.request(
    '/companies/tariffs',
    async () => {
      const response = await httpClient.get<{ success: boolean; data: Tariff[] }>(
        `/companies/${companyId}/tariffs`
      );
      return response.data.data;
    },
    { companyId },
    { cacheTtl: 300000 } // Cache for 5 minutes
  );
};

/**
 * Fetch tariffs for a specific vehicle based on its zone assignments
 * Only returns tariffs for zones that the vehicle is authorized to operate in
 */
export const fetchVehicleTariffs = async (vehicleId: string): Promise<Tariff[]> => {
  return apiRequestManager.request(
    '/mobile/driver/vehicles/tariffs',
    async () => {
      const response = await httpClient.get<{ success: boolean; data: Tariff[] }>(
        `/mobile/driver/vehicles/${vehicleId}/tariffs`
      );
      return response.data.data;
    },
    { vehicleId },
    { cacheTtl: 300000 } // Cache for 5 minutes
  );
};

export const startDriverShift = async (
  payload: StartShiftPayload
): Promise<ShiftStartResponse> => {
  // Invalidate caches when starting shift
  apiRequestManager.invalidatePattern('shift');
  
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
    logger.warn("Failed to read last known location", error);
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

  if (__DEV_MODE__) {
    logger.debug("🛑 Ending shift with location:", {
      source: locationOverride ? "override" : storedLocation ? "AsyncStorage" : "default",
      latitude: location.latitude,
      longitude: location.longitude,
    });
  }

  const payload = {
    location: {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? 0,
      heading: location.heading ?? 0,
      speed: location.speed ?? 0,
    },
  };

  // Invalidate caches when ending shift
  apiRequestManager.invalidatePattern('shift');
  
  const response = await httpClient.post<{
    success: boolean;
    data: ShiftStartResponse | null;
  }>("/mobile/driver/shift/end", payload);
  
  if (__DEV_MODE__) {
    logger.debug("✅ Shift ended successfully");
  }
  return response.data.data || null;
};

export const fetchCurrentShift = async (): Promise<ActiveShift | null> => {
  return apiRequestManager.request(
    '/mobile/driver/shift/current',
    async () => {
      const response = await httpClient.get<{
        success: boolean;
        data: ShiftCurrentResponse;
      }>("/mobile/driver/shift/current");
      return response.data.data?.hasActiveShift
        ? (response.data.data.shift ?? null)
        : null;
    },
    undefined,
    { cacheTtl: 10000 } // Cache for 10 seconds
  );
};

export const fetchRecentJobs = async (
  limit = 3
): Promise<RecentJobSummary[]> => {
  return apiRequestManager.request(
    '/mobile/driver/jobs/recent',
    async () => {
      const response = await httpClient.get<{
        success: boolean;
        data: RecentJobSummary[];
      }>("/mobile/driver/jobs/recent", {
        params: { limit },
      });
      return response.data.data ?? [];
    },
    { limit },
    { cacheTtl: 30000 } // Cache for 30 seconds
  );
};

/* ── Job History API ─────────────────────────────────── */

export interface JobHistoryParams {
  page?: number;
  limit?: number;
  status?: string;       // comma-separated e.g. "COMPLETED,CANCELLED,NO_SHOW"
  startDate?: string;    // ISO 8601
  endDate?: string;      // ISO 8601
  paymentMethod?: string;
}

export interface JobHistoryResponse {
  data: RecentJobSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  };
}

/**
 * Fetch paginated job history with server-side date / status / payment filters.
 * Maps the /history response fields to the shared RecentJobSummary shape so
 * existing UI components (RecentJobsSection) work without changes.
 */
export const fetchJobHistory = async (
  params: JobHistoryParams = {}
): Promise<JobHistoryResponse> => {
  const {
    page = 1,
    limit = 50,
    status = "COMPLETED,CANCELLED,NO_SHOW",
    startDate,
    endDate,
    paymentMethod,
  } = params;

  const query: Record<string, string | number> = { page, limit, status };
  if (startDate) query.startDate = startDate;
  if (endDate) query.endDate = endDate;
  if (paymentMethod) query.paymentMethod = paymentMethod;

  const response = await httpClient.get<{
    success: boolean;
    data: any[];
    pagination: JobHistoryResponse["pagination"];
  }>("/mobile/driver/jobs/history", { params: query });

  // Map /history response to RecentJobSummary shape
  const jobs: RecentJobSummary[] = (response.data.data ?? []).map((j: any) => ({
    id: j.id,
    jobId: j.jobId,
    status: j.status,
    createdAt: j.createdAt ?? null,
    startedAt: j.startedAt ?? null,
    completedAt: j.completedAt ?? null,
    pickup: j.pickup ?? { address: j.pickupAddress },
    dropoff: j.dropoff ?? { address: j.dropoffAddress },
    distanceKm: j.distanceKm ?? j.distance ?? null,
    durationSeconds: j.durationSeconds ?? j.duration ?? null,
    fare: {
      currency: j.fare?.currency ?? "GBP",
      total: j.fare?.actual ?? j.fare?.total ?? j.fare?.driverEarnings ?? 0,
      driverEarnings: j.fare?.driverEarnings ?? j.fare?.actual ?? j.fare?.total ?? 0,
    },
    paymentMethod: j.paymentMethod ?? "UNKNOWN",
    payment: j.payment
      ? {
          amount: j.payment.amount ?? 0,
          driverEarnings: j.payment.driverEarnings ?? null,
          status: j.payment.status ?? null,
        }
      : null,
    passenger: j.passenger ?? j.customer ?? null,
    statusTimeline: j.statusTimeline ?? null,
  }));

  return {
    data: jobs,
    pagination: response.data.pagination ?? {
      page,
      limit,
      total: jobs.length,
      totalPages: 1,
      hasMore: false,
    },
  };
};

/* ── Earnings Summary API (for Wallet) ─────────────── */

export interface EarningsSummaryParams {
  period?: "today" | "week" | "month" | "all";
  startDate?: string;
  endDate?: string;
}

export const fetchEarningsSummary = async (
  params: EarningsSummaryParams = {}
): Promise<any> => {
  const response = await httpClient.get<{
    success: boolean;
    data: any;
  }>("/mobile/driver/earnings/summary", { params });
  return response.data.data;
};

/* ── AsyncStorage Job History Cache ────────────────── */

const JOB_HISTORY_CACHE_KEY = "cached_job_history";
const JOB_HISTORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/* ── Wallet / Settlement API ──────────────────────── */

export interface WalletBalance {
  driverType: 'CONTRACTOR' | 'EMPLOYEE';
  commissionPct: number;
  fixedPayPerRide: number | null;
  weeklyRent: number;
  payoutFrequency: string;
  ownsVehicle: boolean;
  currentPeriod: {
    totalTrips: number;
    totalFare: number;
    cashCollected: number;
    cardTotal: number;
    eposTotal: number;
    accountTotal: number;
    commissionAmount: number;
    fixedPayTotal: number;
    driverOwesCompany: number;
    companyOwesDriver: number;
    netBalance: number;
  };
  previousUnpaid: number;
  runningBalance: number;
}

export interface Settlement {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodType: string;
  totalTrips: number;
  totalFare: number;
  cashCollected: number;
  cardTotal: number;
  commissionAmount: number;
  fixedPayTotal: number;
  weeklyRent: number;
  driverOwesCompany: number;
  companyOwesDriver: number;
  netBalance: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'DISPUTED';
  createdAt: string;
  paidAt: string | null;
}

export const fetchWalletBalance = async (): Promise<WalletBalance> => {
  const response = await httpClient.get<{ success: boolean; data: any }>(
    "/mobile/driver/wallet/balance"
  );
  const raw = response.data.data;

  // Map flat backend response to the nested WalletBalance shape
  // Backend returns fields at root level; frontend expects currentPeriod nesting
  return {
    driverType: raw.driverType ?? 'CONTRACTOR',
    commissionPct: raw.commissionPct ?? 0,
    fixedPayPerRide: raw.fixedPayPerRide ?? null,
    weeklyRent: raw.weeklyRent ?? 0,
    payoutFrequency: raw.payoutFrequency ?? 'WEEKLY',
    ownsVehicle: raw.ownsVehicle ?? false,
    currentPeriod: {
      totalTrips: raw.totalTrips ?? 0,
      totalFare: raw.totalFare ?? 0,
      cashCollected: raw.cashCollected ?? 0,
      cardTotal: raw.cardTotal ?? 0,
      eposTotal: raw.eposTotal ?? 0,
      accountTotal: raw.accountTotal ?? 0,
      commissionAmount: raw.commissionAmount ?? 0,
      fixedPayTotal: raw.fixedPayTotal ?? 0,
      driverOwesCompany: raw.driverOwesCompany ?? 0,
      companyOwesDriver: raw.companyOwesDriver ?? 0,
      netBalance: raw.netBalance ?? 0,
    },
    // Backend uses different field names
    previousUnpaid: raw.carryForwardBalance ?? 0,
    runningBalance: raw.totalBalance ?? raw.netBalance ?? 0,
  };
};

export const fetchWalletSettlements = async (
  params: { page?: number; limit?: number; status?: string } = {}
): Promise<{ data: Settlement[]; pagination: any }> => {
  const response = await httpClient.get<{
    success: boolean;
    data: Settlement[];
    pagination: any;
  }>("/mobile/driver/wallet/settlements", { params });
  return { data: response.data.data, pagination: response.data.pagination };
};

export const fetchWalletConfig = async (): Promise<any> => {
  const response = await httpClient.get<{ success: boolean; data: any }>(
    "/mobile/driver/wallet/config"
  );
  return response.data.data;
};

/* ── Wallet Transaction Ledger ────────────────────── */

export interface WalletTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT' | 'REFUND' | 'BONUS' | 'PENALTY' | 'COMMISSION';
  amount: number;
  currency: string;
  description: string | null;
  balanceBefore: number;
  balanceAfter: number;
  jobId: string | null;
  paymentMethod: string | null;
  createdAt: string;
}

export const fetchWalletTransactions = async (
  params: { page?: number; limit?: number; type?: string } = {}
): Promise<{ data: WalletTransaction[]; pagination: any }> => {
  const response = await httpClient.get<{
    success: boolean;
    data: WalletTransaction[];
    pagination: any;
  }>("/mobile/driver/wallet/transactions", { params });
  return { data: response.data.data, pagination: response.data.pagination };
};

/* ── Trip Receipt ────────────────────────────────── */

export interface TripReceipt {
  receiptNumber: string;
  jobId: string;
  jobNumber: string;
  date: string;
  company: { name: string; phone?: string; email?: string; address?: string };
  driver: { name: string; phone?: string };
  trip: { pickupAddress?: string; dropoffAddress?: string; distance?: number; duration?: number; startedAt?: string; completedAt?: string };
  fare: { baseFare: number; distanceFare: number; timeFare: number; waitingFare: number; extras: number; discount: number; totalFare: number };
  payment: { method: string; status: string; paidAt?: string; amount: number };
  earnings: { driverEarnings: number; companyCommission: number; commissionRate: number } | null;
  currency: string;
}

export const fetchTripReceipt = async (jobId: string): Promise<TripReceipt> => {
  const response = await httpClient.get<{ success: boolean; data: TripReceipt }>(
    `/mobile/driver/wallet/receipt/${jobId}`
  );
  return response.data.data;
};

interface CachedJobHistory {
  filter: string;
  data: RecentJobSummary[];
  pagination: JobHistoryResponse["pagination"];
  timestamp: number;
}

export const getCachedJobHistory = async (
  filterKey: string
): Promise<CachedJobHistory | null> => {
  try {
    const raw = await AsyncStorage.getItem(`${JOB_HISTORY_CACHE_KEY}_${filterKey}`);
    if (!raw) return null;
    const cached: CachedJobHistory = JSON.parse(raw);
    if (Date.now() - cached.timestamp > JOB_HISTORY_CACHE_TTL) {
      // Stale – remove
      await AsyncStorage.removeItem(`${JOB_HISTORY_CACHE_KEY}_${filterKey}`);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
};

export const setCachedJobHistory = async (
  filterKey: string,
  data: RecentJobSummary[],
  pagination: JobHistoryResponse["pagination"]
): Promise<void> => {
  try {
    const entry: CachedJobHistory = {
      filter: filterKey,
      data,
      pagination,
      timestamp: Date.now(),
    };
    await AsyncStorage.setItem(
      `${JOB_HISTORY_CACHE_KEY}_${filterKey}`,
      JSON.stringify(entry)
    );
  } catch {
    // Non-critical – ignore
  }
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
