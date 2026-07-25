/**
 * Job-related TypeScript types
 * 
 * Centralized type definitions for job management
 */

export interface PauseRecord {
  pausedAt: string; // ISO timestamp
  resumedAt: string | null; // ISO timestamp or null if still paused
  durationSeconds: number; // Calculated duration
  location?: {
    latitude: number;
    longitude: number;
  };
}

export interface PricingBreakdown {
  startingPrice: string; // Formatted as "0.00"
  distanceCost: string;
  durationCost: string;
  waitingCost: string;
  totalDistance: number; // meters
  duration: number; // seconds
  waitingSeconds: number; // seconds
  totalCost: string; // Formatted as "0.00"
}

export interface CoordinatePoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  speed?: number; // km/h
  heading?: number;
  timestamp: string; // ISO string
}

export interface TariffChangeRecord {
  timestamp: string; // ISO timestamp
  previousTariff: {
    id: string;
    name: string;
    rates: any;
  } | null;
  newTariff: {
    id: string;
    name: string;
    rates: any;
  };
  reason?: string;
}

export interface ActiveJob {
  id: string;
  status: JobStatus;
  
  // Location data
  pickupLocation: string;
  dropoffLocation: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  
  // Intermediate stops/waypoints
  stops?: Array<{
    address: string;
    latitude?: number;
    longitude?: number;
    order?: number;
  }>;
  
  // Rider information
  riderName: string;
  riderPhone: string;
  
  // Pricing and tariff
  estimatedFare?: string;
  earningsSoFar?: string;
  selectedTariff?: any;
  tariffId?: string;
  pricingBreakdown?: PricingBreakdown;
  
  // Timestamps
  createdAt: string;
  driver_job_start_time?: string;
  acceptedTime?: string;
  arrivedTime?: string;
  startedTime?: string;
  complete_job_time?: string;
  cancelledTime?: string;
  rejectedTime?: string;
  
  // Timer metrics (for persistence)
  totalAccumulatedDistanceMeters?: number;
  totalAccumulatedWaitingSeconds?: number;
  lastKnownCoordinate?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    timestamp?: number;
  };
  
  // Current state
  currentLocation?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    speed?: number;
    heading?: number;
    timestamp?: number;
  };
  isDriverMoving?: boolean;
  movementType?: string;
  
  // History and records
  pause_records?: PauseRecord[];
  tariff_change_history?: TariffChangeRecord[];
  coordinateHistory?: CoordinatePoint[];
  
  // Payment
  paymentMethod?: string;
  paymentStatus?: string;
  paymentDetails?: any;
  
  // Additional data
  notes?: string;
  distance?: string;
  estimatedDuration?: string;
  vehicle?: any;
  
  // Job type
  RideType?: string;
  passengerCount?: number;
  bagCount?: number;
  wheelchairCount?: number;
  wheelchairAccessNeeded?: boolean;
  towingOption?: boolean;
}

export type JobStatus =
  | 'pending'
  | 'sending'
  | 'displayed'
  | 'accepted'
  | 'rejected'
  | 'on_the_way'
  | 'arrived_ready'
  | 'arrived'
  | 'started'
  | 'paused'
  | 'completed'
  | 'finished'
  | 'cancelled'
  | 'noShow'
  | 'recalled';

export const TERMINAL_STATUSES: JobStatus[] = [
  'finished',
  'cancelled',
  'noShow',
  'recalled',
  'rejected',
];

export const TRACKABLE_STATUSES: JobStatus[] = [
  'accepted',
  'on_the_way',
  'arrived_ready',
  'arrived',
  'started',
  'paused',
];

export interface TimerMetrics {
  distance: number; // meters
  waiting: number; // seconds
  elapsed: number; // seconds
  isMoving: boolean;
}

export interface PaymentDetails {
  method: string;
  amount: string;
  totalMobility: boolean;
  extraAmount: string;
  discountAmount: string;
  reason: string;
  recordedAt: string;
  transactionId?: string;
  cardLast4?: string;
  accountNumber?: string;
  giftCardNumber?: string;
}

