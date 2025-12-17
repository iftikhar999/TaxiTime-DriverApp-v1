/**
 * 🚕 JOB QUEUE CONTEXT
 * 
 * Manages the driver's job queue during active trips.
 * 
 * KEY FEATURES:
 * - Driver can hold ONLY ONE job in queue
 * - Only shows jobs within QUEUE_RADIUS_KM (2-3km) of driver's current location
 * - Jobs must be from same zone as current trip
 * - After completing current trip, queued job auto-becomes active
 * - Real-time updates via socket for nearby pending jobs
 */

import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { getSocket } from '../services/driverSocket';
import httpClient from '../services/httpClient';
import { useAuth } from './AuthContext';
import { useJob } from './JobContext';
import { useLocation } from './LocationContext';

// Configuration
const QUEUE_RADIUS_KM = 3; // Jobs within 3km of driver's current location
const NEARBY_JOBS_REFRESH_INTERVAL = 15000; // Refresh every 15 seconds
const MAX_NEARBY_JOBS_DISPLAY = 5; // Show max 5 nearby jobs

export interface NearbyJob {
  id: string;
  publicJobId?: string;
  jobId?: string;
  status: string;
  pickupAddress: string;
  pickupLatitude: number;
  pickupLongitude: number;
  dropoffAddress: string;
  dropoffLatitude?: number;
  dropoffLongitude?: number;
  estimatedFare?: number;
  fare?: number;
  distanceToPickup?: number; // Calculated distance from driver in km
  estimatedDistance?: number;
  customer?: {
    id?: string;
    name?: string;
    phone?: string;
  };
  zoneId?: string;
  createdAt?: string;
  vehicleType?: string;
  tariffName?: string;
}

export interface QueuedJob extends NearbyJob {
  queuedAt: string;
  queuedFromLocation: {
    latitude: number;
    longitude: number;
  };
}

interface JobQueueContextValue {
  // Nearby jobs (within radius, pending, same zone)
  nearbyJobs: NearbyJob[];
  nearbyJobsLoading: boolean;
  refreshNearbyJobs: () => Promise<void>;
  
  // Queued job (ONLY ONE allowed)
  queuedJob: QueuedJob | null;
  canQueueJob: boolean; // false if already has queued job
  
  // Actions
  queueJob: (job: NearbyJob) => Promise<boolean>;
  clearQueuedJob: () => void;
  startQueuedJob: () => Promise<void>;
  
  // State
  isQueueEnabled: boolean; // Queue only enabled during STARTED status
  queueError: string | null;
}

const JobQueueContext = createContext<JobQueueContextValue | undefined>(undefined);

/**
 * Calculate distance between two coordinates using Haversine formula
 */
const calculateDistanceKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const JobQueueProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { driver } = useAuth();
  const { location } = useLocation();
  const { status, currentJob, setIncomingJob } = useJob();
  
  // State
  const [nearbyJobs, setNearbyJobs] = useState<NearbyJob[]>([]);
  const [nearbyJobsLoading, setNearbyJobsLoading] = useState(false);
  const [queuedJob, setQueuedJob] = useState<QueuedJob | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  
  // Refs for latest values in callbacks
  const locationRef = useRef(location);
  const currentJobRef = useRef(currentJob);
  const queuedJobRef = useRef(queuedJob);
  
  useEffect(() => {
    locationRef.current = location;
  }, [location]);
  
  useEffect(() => {
    currentJobRef.current = currentJob;
  }, [currentJob]);
  
  useEffect(() => {
    queuedJobRef.current = queuedJob;
  }, [queuedJob]);
  
  // Queue is only enabled during active trip (STARTED status)
  const isQueueEnabled = status === 'STARTED' || status === 'ACTIVE';
  const canQueueJob = isQueueEnabled && queuedJob === null;
  
  /**
   * Fetch nearby pending jobs from backend
   */
  const fetchNearbyJobs = useCallback(async () => {
    if (!driver?.companyId || !location?.latitude || !location?.longitude) {
      console.log('[JobQueue] ⏸️ Skipping fetch - missing driver/location');
      return;
    }
    
    // Don't fetch if not in active trip
    if (!isQueueEnabled) {
      setNearbyJobs([]);
      return;
    }
    
    setNearbyJobsLoading(true);
    setQueueError(null);
    
    try {
      console.log('[JobQueue] 🔍 Fetching nearby pending jobs...');
      
      // Use the mobile driver API endpoint which is designed for drivers
      // This endpoint at /api/mobile/driver/jobs/nearby handles zone filtering 
      // and only returns jobs appropriate for the driver's company/zone
      const response = await httpClient.get('/mobile/driver/jobs/nearby', {
        params: {
          latitude: location.latitude,
          longitude: location.longitude,
          excludeJobId: currentJob?.id,
          limit: 20,
        },
      });
      
      const allJobs = response.data?.jobs || response.data || [];
      
      // Filter jobs within QUEUE_RADIUS_KM of driver's current location
      const nearbyFiltered = allJobs
        .map((job: any) => {
          const pickupLat = job.pickupLatitude || job.pickup?.latitude;
          const pickupLng = job.pickupLongitude || job.pickup?.longitude;
          
          if (!pickupLat || !pickupLng) return null;
          
          const distanceToPickup = calculateDistanceKm(
            location.latitude,
            location.longitude,
            pickupLat,
            pickupLng
          );
          
          // Only include jobs within radius AND not the current job
          if (distanceToPickup > QUEUE_RADIUS_KM) return null;
          if (currentJob && job.id === currentJob.id) return null;
          if (queuedJob && job.id === queuedJob.id) return null;
          
          return {
            id: job.id,
            publicJobId: job.publicJobId || job.jobId,
            jobId: job.jobId,
            status: job.status,
            pickupAddress: job.pickupAddress || job.pickup?.address || 'Unknown',
            pickupLatitude: pickupLat,
            pickupLongitude: pickupLng,
            dropoffAddress: job.dropoffAddress || job.dropoff?.address || 'Not set',
            dropoffLatitude: job.dropoffLatitude || job.dropoff?.latitude,
            dropoffLongitude: job.dropoffLongitude || job.dropoff?.longitude,
            estimatedFare: job.estimatedPrice || job.estimatedFare || job.fare,
            fare: job.fare,
            distanceToPickup: Math.round(distanceToPickup * 10) / 10, // 1 decimal
            estimatedDistance: job.estimatedDistance || job.distance,
            customer: job.customer ? {
              id: job.customer.id,
              name: job.customer.firstName 
                ? `${job.customer.firstName} ${job.customer.lastName || ''}`.trim()
                : job.customer.name,
              phone: job.customer.phone,
            } : undefined,
            zoneId: job.zoneId,
            createdAt: job.createdAt,
            vehicleType: job.vehicleType,
            tariffName: job.tariff?.name || job.tariffName,
          } as NearbyJob;
        })
        .filter((job: NearbyJob | null): job is NearbyJob => job !== null)
        .sort((a: NearbyJob, b: NearbyJob) => 
          (a.distanceToPickup || 0) - (b.distanceToPickup || 0)
        )
        .slice(0, MAX_NEARBY_JOBS_DISPLAY);
      
      setNearbyJobs(nearbyFiltered);
      console.log(`[JobQueue] ✅ Found ${nearbyFiltered.length} nearby jobs within ${QUEUE_RADIUS_KM}km`);
      
    } catch (error: any) {
      console.error('[JobQueue] ❌ Failed to fetch nearby jobs:', error.message);
      setQueueError('Failed to load nearby jobs');
      // Don't clear existing jobs on error
    } finally {
      setNearbyJobsLoading(false);
    }
  }, [driver?.companyId, location?.latitude, location?.longitude, isQueueEnabled, currentJob?.id, queuedJob?.id]);
  
  /**
   * Refresh nearby jobs (manual trigger)
   */
  const refreshNearbyJobs = useCallback(async () => {
    await fetchNearbyJobs();
  }, [fetchNearbyJobs]);
  
  /**
   * Add a job to the queue (ONLY ONE allowed)
   */
  const queueJob = useCallback(async (job: NearbyJob): Promise<boolean> => {
    if (!canQueueJob) {
      console.warn('[JobQueue] ⚠️ Cannot queue: already have a queued job or not in active trip');
      setQueueError('You can only queue one job at a time');
      return false;
    }
    
    if (!location?.latitude || !location?.longitude) {
      console.warn('[JobQueue] ⚠️ Cannot queue: no location available');
      setQueueError('Location not available');
      return false;
    }
    
    // Verify job is still within radius
    const distance = calculateDistanceKm(
      location.latitude,
      location.longitude,
      job.pickupLatitude,
      job.pickupLongitude
    );
    
    if (distance > QUEUE_RADIUS_KM) {
      console.warn(`[JobQueue] ⚠️ Job too far: ${distance.toFixed(1)}km > ${QUEUE_RADIUS_KM}km`);
      setQueueError(`Job is ${distance.toFixed(1)}km away, must be within ${QUEUE_RADIUS_KM}km`);
      return false;
    }
    
    console.log(`[JobQueue] ➕ Queuing job ${job.id} (${distance.toFixed(1)}km away)`);
    
    try {
      // Notify backend that driver wants to hold this job
      // This can be used to temporarily reserve the job
      await httpClient.post(`/mobile/driver/jobs/${job.id}/queue`, {
        driverId: driver?.id,
        queuedAt: new Date().toISOString(),
        currentJobId: currentJob?.id,
      }).catch(err => {
        // Log but don't fail - backend endpoint may not exist yet
        console.warn('[JobQueue] Backend queue API not available:', err.message);
      });
      
      const queuedJobData: QueuedJob = {
        ...job,
        queuedAt: new Date().toISOString(),
        queuedFromLocation: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
      };
      
      setQueuedJob(queuedJobData);
      setQueueError(null);
      
      // Remove from nearby jobs list
      setNearbyJobs(prev => prev.filter(j => j.id !== job.id));
      
      console.log('[JobQueue] ✅ Job queued successfully');
      return true;
      
    } catch (error: any) {
      console.error('[JobQueue] ❌ Failed to queue job:', error.message);
      setQueueError('Failed to queue job');
      return false;
    }
  }, [canQueueJob, location, driver?.id, currentJob?.id]);
  
  /**
   * Clear the queued job
   */
  const clearQueuedJob = useCallback(() => {
    if (!queuedJob) return;
    
    console.log(`[JobQueue] 🗑️ Clearing queued job ${queuedJob.id}`);
    
    // Notify backend (optional - for analytics)
    httpClient.delete(`/mobile/driver/jobs/${queuedJob.id}/queue`).catch(err => {
      console.warn('[JobQueue] Backend clear queue API not available:', err.message);
    });
    
    // Add back to nearby jobs if still in range
    if (location?.latitude && location?.longitude) {
      const distance = calculateDistanceKm(
        location.latitude,
        location.longitude,
        queuedJob.pickupLatitude,
        queuedJob.pickupLongitude
      );
      
      if (distance <= QUEUE_RADIUS_KM) {
        setNearbyJobs(prev => {
          const { queuedAt, queuedFromLocation, ...jobData } = queuedJob;
          return [...prev, { ...jobData, distanceToPickup: Math.round(distance * 10) / 10 }]
            .sort((a, b) => (a.distanceToPickup || 0) - (b.distanceToPickup || 0));
        });
      }
    }
    
    setQueuedJob(null);
  }, [queuedJob, location]);
  
  /**
   * Start the queued job (called after completing current trip)
   * This transitions driver to the queued job automatically
   */
  const startQueuedJob = useCallback(async () => {
    const jobToStart = queuedJobRef.current;
    
    if (!jobToStart) {
      console.warn('[JobQueue] ⚠️ No queued job to start');
      return;
    }
    
    console.log(`[JobQueue] 🚀 Starting queued job ${jobToStart.id}`);
    
    try {
      // First, claim/accept the job on the backend
      const response = await httpClient.post(`/mobile/driver/jobs/${jobToStart.id}/claim`, {
        driverId: driver?.id,
        autoStart: true, // Signal that this is auto-start from queue
      });
      
      const claimedJob = response.data?.job || response.data;
      
      // Build ActiveJob format for JobContext
      const activeJob = {
        id: claimedJob?.id || jobToStart.id,
        internalJobId: claimedJob?.id || jobToStart.id,
        publicJobId: claimedJob?.publicJobId || jobToStart.publicJobId,
        jobId: claimedJob?.jobId || jobToStart.jobId,
        status: 'ON_THE_WAY' as const,
        pickupAddress: jobToStart.pickupAddress,
        pickupLatitude: jobToStart.pickupLatitude,
        pickupLongitude: jobToStart.pickupLongitude,
        dropoffAddress: jobToStart.dropoffAddress,
        dropoffLatitude: jobToStart.dropoffLatitude,
        dropoffLongitude: jobToStart.dropoffLongitude,
        estimatedFare: jobToStart.estimatedFare || jobToStart.fare,
        distance: jobToStart.estimatedDistance,
        passenger: jobToStart.customer ? {
          id: jobToStart.customer.id || null,
          name: jobToStart.customer.name || 'Customer',
          phone: jobToStart.customer.phone || '',
        } : {
          id: null,
          name: 'Customer',
          phone: '',
        },
        customer: jobToStart.customer,
        createdAt: jobToStart.createdAt || new Date().toISOString(),
        tariffName: jobToStart.tariffName,
        vehicleType: jobToStart.vehicleType,
        zoneId: jobToStart.zoneId,
      };
      
      // Set as incoming job which will trigger navigation to OnTheWayScreen
      setIncomingJob(activeJob as any);
      
      // Clear the queue
      setQueuedJob(null);
      
      console.log('[JobQueue] ✅ Queued job started - navigating to On The Way');
      
    } catch (error: any) {
      console.error('[JobQueue] ❌ Failed to start queued job:', error.message);
      setQueueError('Failed to start queued job');
      
      // Clear the queued job since it might be taken by another driver
      setQueuedJob(null);
    }
  }, [driver?.id, setIncomingJob]);
  
  /**
   * Auto-refresh nearby jobs while in active trip
   */
  useEffect(() => {
    if (!isQueueEnabled) {
      setNearbyJobs([]);
      return;
    }
    
    // Initial fetch
    fetchNearbyJobs();
    
    // Set up interval for refreshing
    const interval = setInterval(fetchNearbyJobs, NEARBY_JOBS_REFRESH_INTERVAL);
    
    return () => clearInterval(interval);
  }, [isQueueEnabled, fetchNearbyJobs]);
  
  /**
   * Listen for real-time job updates
   */
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !isQueueEnabled) return;
    
    const handleNewNearbyJob = (payload: any) => {
      console.log('[JobQueue] 📡 Received new nearby job:', payload.id);
      
      if (!locationRef.current) return;
      
      const pickupLat = payload.pickupLatitude || payload.pickup?.latitude;
      const pickupLng = payload.pickupLongitude || payload.pickup?.longitude;
      
      if (!pickupLat || !pickupLng) return;
      
      const distance = calculateDistanceKm(
        locationRef.current.latitude,
        locationRef.current.longitude,
        pickupLat,
        pickupLng
      );
      
      // Only add if within radius
      if (distance > QUEUE_RADIUS_KM) return;
      if (currentJobRef.current && payload.id === currentJobRef.current.id) return;
      if (queuedJobRef.current && payload.id === queuedJobRef.current.id) return;
      
      const newJob: NearbyJob = {
        id: payload.id,
        publicJobId: payload.publicJobId || payload.jobId,
        jobId: payload.jobId,
        status: payload.status,
        pickupAddress: payload.pickupAddress || payload.pickup?.address || 'Unknown',
        pickupLatitude: pickupLat,
        pickupLongitude: pickupLng,
        dropoffAddress: payload.dropoffAddress || payload.dropoff?.address || 'Not set',
        dropoffLatitude: payload.dropoffLatitude || payload.dropoff?.latitude,
        dropoffLongitude: payload.dropoffLongitude || payload.dropoff?.longitude,
        estimatedFare: payload.estimatedPrice || payload.estimatedFare,
        distanceToPickup: Math.round(distance * 10) / 10,
        customer: payload.customer,
        createdAt: payload.createdAt,
      };
      
      setNearbyJobs(prev => {
        // Don't add if already exists
        if (prev.some(j => j.id === newJob.id)) return prev;
        
        return [...prev, newJob]
          .sort((a, b) => (a.distanceToPickup || 0) - (b.distanceToPickup || 0))
          .slice(0, MAX_NEARBY_JOBS_DISPLAY);
      });
    };
    
    const handleJobTaken = (payload: any) => {
      const jobId = payload.jobId || payload.id;
      console.log(`[JobQueue] 📡 Job ${jobId} was taken`);
      
      // Remove from nearby jobs
      setNearbyJobs(prev => prev.filter(j => j.id !== jobId));
      
      // Clear queued job if it was taken
      if (queuedJobRef.current?.id === jobId) {
        console.warn('[JobQueue] ⚠️ Queued job was taken by another driver!');
        setQueuedJob(null);
        setQueueError('Your queued job was taken by another driver');
      }
    };
    
    socket.on('job:available:nearby', handleNewNearbyJob);
    socket.on('job:assigned', handleJobTaken);
    socket.on('job:taken', handleJobTaken);
    
    return () => {
      socket.off('job:available:nearby', handleNewNearbyJob);
      socket.off('job:assigned', handleJobTaken);
      socket.off('job:taken', handleJobTaken);
    };
  }, [isQueueEnabled]);
  
  /**
   * Auto-start queued job when current job is completed
   */
  useEffect(() => {
    // Check if job just completed and we have a queued job
    if (status === 'COMPLETED' && queuedJobRef.current) {
      console.log('[JobQueue] 🎯 Current job completed - starting queued job in 2 seconds...');
      
      // Small delay to let completion flow finish
      const timeout = setTimeout(() => {
        startQueuedJob();
      }, 2000);
      
      return () => clearTimeout(timeout);
    }
  }, [status, startQueuedJob]);
  
  /**
   * Clear queue when driver goes idle or cancels trip
   */
  useEffect(() => {
    if (status === 'IDLE' || status === 'CANCELLED' || status === 'REJECTED') {
      if (queuedJob) {
        console.log('[JobQueue] 🗑️ Clearing queue - driver status:', status);
        setQueuedJob(null);
      }
      setNearbyJobs([]);
    }
  }, [status, queuedJob]);
  
  const value = useMemo<JobQueueContextValue>(
    () => ({
      nearbyJobs,
      nearbyJobsLoading,
      refreshNearbyJobs,
      queuedJob,
      canQueueJob,
      queueJob,
      clearQueuedJob,
      startQueuedJob,
      isQueueEnabled,
      queueError,
    }),
    [
      nearbyJobs,
      nearbyJobsLoading,
      refreshNearbyJobs,
      queuedJob,
      canQueueJob,
      queueJob,
      clearQueuedJob,
      startQueuedJob,
      isQueueEnabled,
      queueError,
    ]
  );
  
  return (
    <JobQueueContext.Provider value={value}>
      {children}
    </JobQueueContext.Provider>
  );
};

export const useJobQueue = (): JobQueueContextValue => {
  const context = useContext(JobQueueContext);
  if (!context) {
    throw new Error('useJobQueue must be used within a JobQueueProvider');
  }
  return context;
};

export default JobQueueContext;
