export interface TariffRate {
  timeSlot: string;
  baseFare: number;
  perMileRate: number;
  perMinuteRate: number;
  minimumFare: number;
}

export interface Tariff {
  id: string;
  name: string;
  description?: string;
  vehicleType?: string;
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  minimumFare: number;
  waitingTimeRate?: number;
  surgeMultiplier?: number;
  isDefault?: boolean;
  isActive?: boolean;
  timeBasedRates?: TariffRate[];
  features?: string[];
  estimatedEarning?: string;
}
