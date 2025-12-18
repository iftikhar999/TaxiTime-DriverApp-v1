/**
 * Optimized Socket Emitter - Batching and Debouncing for Socket Events
 * 
 * Problem: Frequent socket emissions (location, meter, status) cause network overhead
 * Solution: Batch and debounce events to reduce emissions while maintaining data accuracy
 */

import { __DEV_MODE__, logger, PERFORMANCE_CONFIG } from '../config/environment';

type EventPriority = 'high' | 'normal' | 'low';

interface QueuedEvent {
  eventName: string;
  payload: any;
  timestamp: number;
  priority: EventPriority;
}

interface EmitterConfig {
  /** Batch flush interval in ms (default: 1000) */
  batchIntervalMs?: number;
  /** Maximum events in batch before force flush */
  maxBatchSize?: number;
  /** Debounce time for same-event updates in ms */
  debounceMs?: number;
  /** Events that should never be batched */
  immediateEvents?: string[];
}

type EmitFunction = (eventName: string, payload: any) => void;

class OptimizedSocketEmitter {
  private eventQueue: Map<string, QueuedEvent> = new Map();
  private batchQueue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private emitFn: EmitFunction | null = null;
  private config: Required<EmitterConfig>;
  private lastEmitTimes: Map<string, number> = new Map();
  private stats = {
    totalQueued: 0,
    totalEmitted: 0,
    totalBatched: 0,
    totalDebounced: 0,
  };

  constructor(config: EmitterConfig = {}) {
    this.config = {
      batchIntervalMs: config.batchIntervalMs ?? 1000,
      maxBatchSize: config.maxBatchSize ?? 10,
      debounceMs: config.debounceMs ?? 500,
      immediateEvents: config.immediateEvents ?? [
        'job:accept',
        'job:reject',
        'job:complete',
        'driver:authenticate',
        'driver:kicked',
      ],
    };
  }

  /**
   * Set the underlying emit function (from socket.io)
   */
  setEmitFunction(fn: EmitFunction): void {
    this.emitFn = fn;
    this.startBatchProcessor();
  }

  /**
   * Start the batch processor interval
   */
  private startBatchProcessor(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flushBatch();
    }, this.config.batchIntervalMs);
  }

  /**
   * Stop the batch processor
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    
    // Flush remaining events
    this.flushBatch();
  }

  /**
   * Emit an event (with intelligent batching/debouncing)
   */
  emit(eventName: string, payload: any, priority: EventPriority = 'normal'): void {
    this.stats.totalQueued++;

    // Immediate events bypass batching
    if (this.config.immediateEvents.includes(eventName)) {
      this.emitImmediate(eventName, payload);
      return;
    }

    // High priority events flush the batch first
    if (priority === 'high') {
      this.flushBatch();
      this.emitImmediate(eventName, payload);
      return;
    }

    // Debounce same-event updates
    const debounceKey = `${eventName}:debounce`;
    const existingDebounce = this.debounceTimers.get(debounceKey);
    if (existingDebounce) {
      clearTimeout(existingDebounce);
      this.stats.totalDebounced++;
    }

    // Store latest event (overwrites previous same-event)
    this.eventQueue.set(eventName, {
      eventName,
      payload,
      timestamp: Date.now(),
      priority,
    });

    // Set debounce timer
    this.debounceTimers.set(
      debounceKey,
      setTimeout(() => {
        this.debounceTimers.delete(debounceKey);
        // Event will be flushed in next batch cycle
      }, this.config.debounceMs)
    );

    // Force flush if queue is too large
    if (this.eventQueue.size >= this.config.maxBatchSize) {
      this.flushBatch();
    }
  }

  /**
   * Emit immediately without batching
   */
  private emitImmediate(eventName: string, payload: any): void {
    if (!this.emitFn) {
      logger.warn(`[OptimizedEmitter] No emit function set, dropping: ${eventName}`);
      return;
    }

    this.lastEmitTimes.set(eventName, Date.now());
    this.stats.totalEmitted++;
    
    if (__DEV_MODE__) {
      logger.debug(`📡 [Socket] Emit immediate: ${eventName}`);
    }
    
    this.emitFn(eventName, payload);
  }

  /**
   * Flush all queued events
   */
  private flushBatch(): void {
    if (this.eventQueue.size === 0) return;

    const events = Array.from(this.eventQueue.values());
    this.eventQueue.clear();

    // Sort by priority (high first) then by timestamp
    events.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.timestamp - b.timestamp;
    });

    if (__DEV_MODE__ && events.length > 1) {
      logger.debug(`📦 [Socket] Flushing batch: ${events.length} events`);
    }

    for (const event of events) {
      this.emitImmediate(event.eventName, event.payload);
      this.stats.totalBatched++;
    }
  }

  /**
   * Emit location update (with smart throttling)
   */
  emitLocation(payload: any): void {
    const lastEmit = this.lastEmitTimes.get('driver:location') ?? 0;
    const timeSinceLastEmit = Date.now() - lastEmit;

    // Throttle location updates
    if (timeSinceLastEmit < PERFORMANCE_CONFIG.LOCATION_THROTTLE_MS) {
      // Queue for next batch instead
      this.emit('driver:location', payload, 'low');
      return;
    }

    this.emit('driver:location', payload, 'normal');
  }

  /**
   * Emit meter telemetry (debounced)
   */
  emitMeterTelemetry(payload: any): void {
    this.emit('meter:telemetry', payload, 'low');
  }

  /**
   * Emit meter snapshot (batched)
   */
  emitMeterSnapshot(payload: any): void {
    this.emit('meter:snapshot', payload, 'normal');
  }

  /**
   * Emit status change (high priority)
   */
  emitStatus(payload: any): void {
    this.emit('driver:status', payload, 'high');
  }

  /**
   * Emit job progress (normal priority)
   */
  emitJobProgress(payload: any): void {
    this.emit('job:progress', payload, 'normal');
  }

  /**
   * Get emitter stats
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.eventQueue.size,
      pendingDebounces: this.debounceTimers.size,
    };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.stats = {
      totalQueued: 0,
      totalEmitted: 0,
      totalBatched: 0,
      totalDebounced: 0,
    };
  }
}

// Export singleton instance
export const optimizedSocketEmitter = new OptimizedSocketEmitter();

export default optimizedSocketEmitter;
