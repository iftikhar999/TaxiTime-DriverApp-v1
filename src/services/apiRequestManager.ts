/**
 * API Request Manager - Deduplication, Caching, and Throttling
 * 
 * Purpose: Prevents duplicate API calls, caches responses, and throttles requests
 * to reduce network overhead and improve app responsiveness.
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
  expiresAt: number;
};

type PendingRequest<T> = {
  promise: Promise<T>;
  timestamp: number;
};

interface RequestOptions {
  /** Cache TTL in milliseconds (default: 30000) */
  cacheTtl?: number;
  /** Skip cache and force fresh request */
  forceRefresh?: boolean;
  /** Deduplicate concurrent requests (default: true) */
  deduplicate?: boolean;
  /** Minimum time between identical requests in ms (default: 1000) */
  throttleMs?: number;
}

class ApiRequestManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pendingRequests: Map<string, PendingRequest<any>> = new Map();
  private lastRequestTimes: Map<string, number> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup expired cache entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Generate a cache key from request parameters
   */
  private generateKey(endpoint: string, params?: Record<string, any>): string {
    const sortedParams = params
      ? JSON.stringify(
          Object.keys(params)
            .sort()
            .reduce((acc, key) => {
              acc[key] = params[key];
              return acc;
            }, {} as Record<string, any>)
        )
      : '';
    return `${endpoint}:${sortedParams}`;
  }

  /**
   * Check if request is throttled
   */
  private isThrottled(key: string, throttleMs: number): boolean {
    const lastRequest = this.lastRequestTimes.get(key);
    if (!lastRequest) return false;
    return Date.now() - lastRequest < throttleMs;
  }

  /**
   * Get cached response if valid
   */
  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Set cache entry
   */
  private setCache<T>(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Execute a request with deduplication, caching, and throttling
   */
  async request<T>(
    endpoint: string,
    fetcher: () => Promise<T>,
    params?: Record<string, any>,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      cacheTtl = 30000,
      forceRefresh = false,
      deduplicate = true,
      throttleMs = 1000,
    } = options;

    const key = this.generateKey(endpoint, params);

    // Check throttle
    if (this.isThrottled(key, throttleMs) && !forceRefresh) {
      const cached = this.getCached<T>(key);
      if (cached) {
        console.log(`⏱️ [API] Throttled, returning cached: ${endpoint}`);
        return cached;
      }
    }

    // Check cache (if not forcing refresh)
    if (!forceRefresh) {
      const cached = this.getCached<T>(key);
      if (cached) {
        console.log(`💾 [API] Cache hit: ${endpoint}`);
        return cached;
      }
    }

    // Check for pending request (deduplication)
    if (deduplicate) {
      const pending = this.pendingRequests.get(key);
      if (pending) {
        console.log(`🔄 [API] Deduplicating: ${endpoint}`);
        return pending.promise;
      }
    }

    // Execute the request
    console.log(`🌐 [API] Fetching: ${endpoint}`);
    this.lastRequestTimes.set(key, Date.now());

    const promise = fetcher()
      .then((data) => {
        this.setCache(key, data, cacheTtl);
        this.pendingRequests.delete(key);
        return data;
      })
      .catch((error) => {
        this.pendingRequests.delete(key);
        throw error;
      });

    if (deduplicate) {
      this.pendingRequests.set(key, {
        promise,
        timestamp: Date.now(),
      });
    }

    return promise;
  }

  /**
   * Invalidate cache for a specific endpoint
   */
  invalidate(endpoint: string, params?: Record<string, any>): void {
    const key = this.generateKey(endpoint, params);
    this.cache.delete(key);
    console.log(`🗑️ [API] Cache invalidated: ${endpoint}`);
  }

  /**
   * Invalidate all cache entries matching a pattern
   */
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    let count = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    console.log(`🗑️ [API] Invalidated ${count} entries matching: ${pattern}`);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clear();
    this.lastRequestTimes.clear();
    console.log('🗑️ [API] All cache cleared');
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`🧹 [API] Cleaned ${cleaned} expired cache entries`);
    }
  }

  /**
   * Get cache stats for debugging
   */
  getStats(): {
    cacheSize: number;
    pendingRequests: number;
    oldestEntry: number | null;
  } {
    let oldestEntry: number | null = null;
    for (const entry of this.cache.values()) {
      if (oldestEntry === null || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
    }

    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pendingRequests.size,
      oldestEntry,
    };
  }

  /**
   * Destroy manager and cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
    this.pendingRequests.clear();
    this.lastRequestTimes.clear();
  }
}

// Export singleton instance
export const apiRequestManager = new ApiRequestManager();

/**
 * Hook for using the request manager in components
 */
export const useApiRequest = () => {
  return {
    request: apiRequestManager.request.bind(apiRequestManager),
    invalidate: apiRequestManager.invalidate.bind(apiRequestManager),
    invalidatePattern: apiRequestManager.invalidatePattern.bind(apiRequestManager),
    clearAll: apiRequestManager.clearAll.bind(apiRequestManager),
    getStats: apiRequestManager.getStats.bind(apiRequestManager),
  };
};

export default apiRequestManager;
