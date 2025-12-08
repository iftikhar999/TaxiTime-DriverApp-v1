import { NativeEventEmitter, NativeModules } from 'react-native';

const { JobMeterModule } = NativeModules;

export interface MeterUpdate {
  elapsedSeconds: number;
  waitingSeconds: number;
  distanceMeters: number;
  isMoving: boolean;
  timestamp: number;
}

export interface JobMeterInterface {
  startJobMeter(
    startTime: number,
    waitingSeconds: number,
    distanceMeters: number,
    latitude: number,
    longitude: number
  ): Promise<boolean>;
  
  updateLocation(
    latitude: number,
    longitude: number,
    accuracy: number,
    speed: number
  ): Promise<boolean>;
  
  pauseJobMeter(): Promise<boolean>;
  resumeJobMeter(): Promise<boolean>;
  stopJobMeter(): Promise<boolean>;
}

class JobMeterService {
  private module: JobMeterInterface;
  private eventEmitter: NativeEventEmitter;
  
  constructor() {
    if (!JobMeterModule || typeof JobMeterModule !== 'object') {
      console.error("❌ JobMeterModule is not available. Metering will not work.");
      // Assign a mock implementation to prevent crashes
      this.module = {
        startJobMeter: () => Promise.resolve(false),
        updateLocation: () => Promise.resolve(false),
        pauseJobMeter: () => Promise.resolve(false),
        resumeJobMeter: () => Promise.resolve(false),
        stopJobMeter: () => Promise.resolve(false),
      };
      this.eventEmitter = new NativeEventEmitter();
    } else {
      this.module = JobMeterModule as JobMeterInterface;
      if (
        typeof JobMeterModule.addListener === 'function' &&
        typeof JobMeterModule.removeListeners === 'function'
      ) {
        this.eventEmitter = new NativeEventEmitter(JobMeterModule);
      } else {
        console.warn(
          '⚠️ JobMeterModule does not implement addListener/removeListeners; using fallback emitter.'
        );
        this.eventEmitter = new NativeEventEmitter();
      }
    }
  }

  /**
   * Start the background job meter service
   */
  async startJobMeter(
    startTime: number,
    waitingSeconds: number = 0,
    distanceMeters: number = 0,
    latitude: number,
    longitude: number
  ): Promise<boolean> {
    try {
      console.log('🚀 Starting background job meter', {
        startTime: new Date(startTime).toISOString(),
        waitingSeconds,
        distanceMeters,
        location: { latitude, longitude }
      });
      
      return await this.module.startJobMeter(
        startTime,
        waitingSeconds,
        distanceMeters,
        latitude,
        longitude
      );
    } catch (error) {
      console.error('❌ Failed to start job meter:', error);
      throw error;
    }
  }

  /**
   * Update the driver's location for distance/movement tracking
   */
  async updateLocation(
    latitude: number,
    longitude: number,
    accuracy: number = 0,
    speed: number = 0
  ): Promise<boolean> {
    try {
      return await this.module.updateLocation(latitude, longitude, accuracy, speed);
    } catch (error) {
      console.error('❌ Failed to update location:', error);
      return false;
    }
  }

  /**
   * Pause the job meter (stops time tracking but keeps service alive)
   */
  async pauseJobMeter(): Promise<boolean> {
    try {
      console.log('⏸️ Pausing job meter');
      return await this.module.pauseJobMeter();
    } catch (error) {
      console.error('❌ Failed to pause job meter:', error);
      throw error;
    }
  }

  /**
   * Resume the job meter after pause
   */
  async resumeJobMeter(): Promise<boolean> {
    try {
      console.log('▶️ Resuming job meter');
      return await this.module.resumeJobMeter();
    } catch (error) {
      console.error('❌ Failed to resume job meter:', error);
      throw error;
    }
  }

  /**
   * Stop the job meter and clean up
   */
  async stopJobMeter(): Promise<boolean> {
    try {
      console.log('🛑 Stopping job meter');
      return await this.module.stopJobMeter();
    } catch (error) {
      console.error('❌ Failed to stop job meter:', error);
      throw error;
    }
  }

  /**
   * Subscribe to meter updates from the background service
   */
  onMeterUpdate(callback: (update: MeterUpdate) => void): () => void {
    const subscription = this.eventEmitter.addListener('onMeterUpdate', callback);
    return () => subscription.remove();
  }
}

export default new JobMeterService();
