export interface RecentJobPassenger {
  id?: string | null;
  name?: string | null;
  phone?: string | null;
}

export interface RecentJobPaymentSummary {
  amount: number;
  driverEarnings?: number | null;
  status?: string | null;
}

export interface RecentJobFareSummary {
  currency: string;
  total: number;
  driverEarnings?: number | null;
}

export interface LocationPoint {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RecentJobSummary {
  id: string;
  jobId: string;
  status: string;
  createdAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  pickup: LocationPoint;
  dropoff: LocationPoint;
  distanceKm?: number | null;
  durationSeconds?: number | null;
  fare: RecentJobFareSummary;
  paymentMethod?: string | null;
  payment?: RecentJobPaymentSummary | null;
  passenger?: RecentJobPassenger | null;
  statusTimeline?: Record<string, string> | null;
}
