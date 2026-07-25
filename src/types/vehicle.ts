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
  // Master vehicle-type image (the same render the passenger app uses).
  // Server resolves this from vehicle_types.imageUrl by matching the
  // vehicle's vehicleType code/name. May be relative (`/shared/assets/...`)
  // or absolute; UI prepends API base when relative.
  imageUrl?: string | null;
  // True when another driver has an active shift with this vehicle
  // selected — the UI greys it out and disables Start.
  isEngaged?: boolean;
}

export interface DriverVehiclesResponse {
  vehicles: DriverVehicle[];
  totalVehicles: number;
  company?: {
    id: string;
    name?: string | null;
  } | null;
}
