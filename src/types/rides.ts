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

export interface RideSummary {
  id: string;
  status: string;
  createdAt: string;
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
  passenger?: RidePassenger | null;
  payment?: RidePaymentSummary | null;
}
