export interface DriverVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  licensePlate: string;
  vehicleType?: string | null;
  isActive?: boolean;
  isAvailable?: boolean;
  vin?: string | null;
  capacity?: number;
  features?: Record<string, unknown> | null;
  insurance?: Record<string, unknown> | null;
  registration?: Record<string, unknown> | null;
}

export interface DriverVehiclesResponse {
  vehicles: DriverVehicle[];
  totalVehicles: number;
  company?: {
    id: string;
    name?: string | null;
  } | null;
}
