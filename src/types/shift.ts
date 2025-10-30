export interface ShiftVehicle {
  id: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  licensePlate?: string;
  vehicleType?: string;
  currentOdometer?: number | null;
  fuelLevel?: number | null;
}

export interface ShiftLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
}

export interface ShiftStats {
  totalEarnings: number;
  totalRides: number;
  averagePerRide?: number;
}

export interface ActiveShift {
  id: string;
  startTime: string;
  status: string;
  duration?: number;
  startLocation?: ShiftLocation | null;
  vehicle?: ShiftVehicle | null;
  stats?: ShiftStats;
}

export interface ShiftStartResponse {
  shift: ActiveShift;
  driverStatus: string;
}

export interface ShiftCurrentResponse {
  hasActiveShift: boolean;
  shift: ActiveShift | null;
}

export interface StartShiftPayload {
  vehicleId: string;
  tariffId: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number;
    speed?: number;
  };
}
