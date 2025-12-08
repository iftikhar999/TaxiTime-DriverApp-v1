export interface RidePassenger {
  id?: string;
  name?: string;
  rating?: number | null;
  phone?: string | null;
}

export interface RidePaymentSummary {
  amount?: number;
  driverEarnings?: number;
  commission?: number;
  method?: string;
}

export interface RideLocationSummary {
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RideFareSummary {
  estimated?: number | null;
  actual?: number | null;
  driverEarnings?: number | null;
}

export interface RideSummary {
  id: string;
  jobId?: string | null;
  status: string;
  createdAt?: string | null;
  completedAt?: string | null;
  pickup?: RideLocationSummary | null;
  dropoff?: RideLocationSummary | null;
  pickupAddress?: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  dropoffAddress?: string | null;
  dropoffLatitude?: number | null;
  dropoffLongitude?: number | null;
  distance?: number | null;
  actualFare?: number | null;
  estimatedFare?: number | null;
  notes?: string | null;
  duration?: number | null;
  fare?: RideFareSummary | null;
  paymentMethod?: string | null;
  passenger?: RidePassenger | null;
  customer?: RidePassenger | null;
  payment?: RidePaymentSummary | null;
  statusTimeline?: Record<string, string> | null;
}
