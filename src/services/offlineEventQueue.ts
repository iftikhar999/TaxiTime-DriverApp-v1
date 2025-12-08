/**
 * Offline Event Queue Service
 * Queues socket events when offline and replays them on reconnection
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_STORAGE_KEY = "@driver_event_queue";
const MAX_QUEUE_SIZE = 500; // Prevent memory overflow
const EVENT_EXPIRY_MS = 3600000; // 1 hour

export interface QueuedEvent {
  id: string;
  type:
    | "status"
    | "location"
    | "job_progress"
    | "meter_telemetry"
    | "meter_snapshot"
    | "heartbeat";
  eventName: string;
  payload: any;
  eventId?: string;
  ackEvent?: string;
  errorEvent?: string;
  timeoutMs?: number;
  timestamp: number;
  retryCount: number;
}

class OfflineEventQueue {
  private queue: QueuedEvent[] = [];
  private isProcessing = false;
  private initialized = false;

  /**
   * Initialize queue from AsyncStorage
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const stored = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      if (stored) {
        const parsedQueue = JSON.parse(stored) as QueuedEvent[];
        // Filter out expired events
        const now = Date.now();
        this.queue = parsedQueue.filter(
          (event) => now - event.timestamp < EVENT_EXPIRY_MS
        );
        console.log(
          `📦 Loaded ${this.queue.length} queued events from storage`
        );
      }
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize event queue:", error);
      this.queue = [];
      this.initialized = true;
    }
  }

  /**
   * Add event to queue
   */
  async enqueue(
    event: Omit<QueuedEvent, "id" | "timestamp" | "retryCount">
  ): Promise<void> {
    // Generate unique ID
    const queuedEvent: QueuedEvent = {
      ...event,
      id: `${event.type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
    };

    // Add to queue
    this.queue.push(queuedEvent);

    // Enforce max queue size (remove oldest)
    if (this.queue.length > MAX_QUEUE_SIZE) {
      this.queue = this.queue.slice(-MAX_QUEUE_SIZE);
      console.warn(
        `⚠️ Event queue exceeded max size, trimmed to ${MAX_QUEUE_SIZE}`
      );
    }

    // Persist to storage
    await this.persistQueue();

    console.log(
      `📥 Queued ${event.type} event: ${event.eventName} (queue size: ${this.queue.length})`
    );
  }

  /**
   * Process queued events (replay them)
   */
  async processQueue(
    emitFunction: (event: QueuedEvent) => Promise<void>
  ): Promise<{ success: number; failed: number }> {
    if (this.isProcessing || this.queue.length === 0) {
      return { success: 0, failed: 0 };
    }

    this.isProcessing = true;
    let successCount = 0;
    let failedCount = 0;

    console.log(`🔄 Processing ${this.queue.length} queued events...`);

    // Process events in order
    const eventsToProcess = [...this.queue];
    this.queue = [];

    for (const event of eventsToProcess) {
      try {
        // Check if event is expired
        if (Date.now() - event.timestamp > EVENT_EXPIRY_MS) {
          console.log(`⏰ Skipping expired event: ${event.id}`);
          continue;
        }

        // Emit the event
        await emitFunction(event);
        successCount++;

        console.log(`✅ Replayed: ${event.eventName} (${event.type})`);
      } catch (error) {
        console.error(`❌ Failed to replay event ${event.id}:`, error);

        // Re-queue if not exceeded retry limit
        if (event.retryCount < 3) {
          this.queue.push({
            ...event,
            retryCount: event.retryCount + 1,
          });
        } else {
          console.warn(`⚠️ Event ${event.id} exceeded retry limit, discarding`);
        }
        failedCount++;
      }
    }

    // Persist updated queue
    await this.persistQueue();

    this.isProcessing = false;

    console.log(
      `✨ Queue processing complete: ${successCount} success, ${failedCount} failed, ${this.queue.length} remaining`
    );

    return { success: successCount, failed: failedCount };
  }

  /**
   * Persist queue to AsyncStorage
   */
  private async persistQueue(): Promise<void> {
    try {
      await AsyncStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(this.queue));
    } catch (error) {
      console.error("Failed to persist event queue:", error);
    }
  }

  /**
   * Clear all queued events
   */
  async clear(): Promise<void> {
    this.queue = [];
    await AsyncStorage.removeItem(QUEUE_STORAGE_KEY);
    console.log("🗑️ Event queue cleared");
  }

  /**
   * Get queue status
   */
  getStatus(): { size: number; oldestEventAge: number | null } {
    const size = this.queue.length;
    const oldestEventAge =
      size > 0
        ? Date.now() - Math.min(...this.queue.map((e) => e.timestamp))
        : null;

    return { size, oldestEventAge };
  }

  /**
   * Check if event with same ID exists (deduplication)
   */
  hasEvent(eventId: string): boolean {
    return this.queue.some((event) => event.id === eventId);
  }

  /**
   * Remove specific event by ID
   */
  async removeEvent(eventId: string): Promise<boolean> {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter((event) => event.id !== eventId);

    if (this.queue.length < initialLength) {
      await this.persistQueue();
      return true;
    }
    return false;
  }
}

// Singleton instance
export const offlineEventQueue = new OfflineEventQueue();
