/**
 * 📝 Comprehensive Logging Service
 * 
 * Production-grade logging system for the driver app.
 * 
 * Features:
 * - Multiple log levels (debug, info, warn, error, critical)
 * - Persistent log storage
 * - Log rotation (size-based)
 * - Log categorization
 * - Performance tracking
 * - Error tracking with stack traces
 * - Remote log upload (optional)
 * - Log filtering and search
 * 
 * @module logger
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const LOGS_STORAGE_KEY = '@driver_logs';
const MAX_LOG_SIZE = 1000; // Maximum number of logs to keep
const MAX_LOG_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';
export type LogCategory =
  | 'auth'
  | 'job'
  | 'location'
  | 'socket'
  | 'payment'
  | 'navigation'
  | 'api'
  | 'performance'
  | 'system'
  | 'ui';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  performance?: {
    duration: number;
    operation: string;
  };
  context?: {
    driverId?: string;
    jobId?: string;
    screen?: string;
  };
}

interface LoggerConfig {
  enableDebug: boolean;
  enablePersistence: boolean;
  enableConsole: boolean;
  maxLogSize: number;
  maxLogAge: number;
}

class Logger {
  private logs: LogEntry[] = [];
  private config: LoggerConfig = {
    enableDebug: __DEV__, // Only in development
    enablePersistence: true,
    enableConsole: true,
    maxLogSize: MAX_LOG_SIZE,
    maxLogAge: MAX_LOG_AGE_MS,
  };

  // Performance timers
  private timers: Map<string, number> = new Map();

  /**
   * Initialize the logger
   */
  async initialize(): Promise<void> {
    console.log('📝 [Logger] Initializing...');
    await this.loadLogs();
    await this.cleanupOldLogs();
    console.log('✅ [Logger] Initialized');
  }

  /**
   * Configure the logger
   */
  configure(config: Partial<LoggerConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('⚙️ [Logger] Configuration updated:', this.config);
  }

  /**
   * Debug log (development only)
   */
  debug(category: LogCategory, message: string, data?: any): void {
    if (this.config.enableDebug) {
      this.log('debug', category, message, data);
    }
  }

  /**
   * Info log
   */
  info(category: LogCategory, message: string, data?: any): void {
    this.log('info', category, message, data);
  }

  /**
   * Warning log
   */
  warn(category: LogCategory, message: string, data?: any): void {
    this.log('warn', category, message, data);
  }

  /**
   * Error log
   */
  error(category: LogCategory, message: string, error?: Error, data?: any): void {
    const errorData = error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined;

    this.log('error', category, message, data, errorData);
  }

  /**
   * Critical log (requires immediate attention)
   */
  critical(category: LogCategory, message: string, error?: Error, data?: any): void {
    const errorData = error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : undefined;

    this.log('critical', category, message, data, errorData);

    // In production, you might want to send critical logs to a monitoring service
    this.sendCriticalLogToRemote({ category, message, error, data });
  }

  /**
   * Start a performance timer
   */
  startTimer(operation: string): void {
    this.timers.set(operation, Date.now());
  }

  /**
   * End a performance timer and log the duration
   */
  endTimer(category: LogCategory, operation: string, data?: any): number {
    const startTime = this.timers.get(operation);
    if (!startTime) {
      this.warn('performance', `Timer not found: ${operation}`);
      return 0;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(operation);

    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level: 'info',
      category,
      message: `Performance: ${operation}`,
      data,
      performance: {
        duration,
        operation,
      },
    };

    this.addLog(entry);
    return duration;
  }

  /**
   * Log a user action
   */
  logAction(action: string, screen: string, data?: any): void {
    this.log('info', 'ui', `User action: ${action}`, {
      ...data,
      screen,
    });
  }

  /**
   * Log API call
   */
  logApiCall(method: string, endpoint: string, status: number, duration: number, data?: any): void {
    const level: LogLevel = status >= 400 ? 'error' : status >= 300 ? 'warn' : 'info';

    this.log(level, 'api', `${method} ${endpoint} - ${status}`, {
      method,
      endpoint,
      status,
      duration,
      ...data,
    });
  }

  /**
   * Log socket event
   */
  logSocketEvent(event: string, direction: 'emit' | 'receive', data?: any): void {
    this.log('debug', 'socket', `Socket ${direction}: ${event}`, data);
  }

  /**
   * Log job event
   */
  logJobEvent(jobId: string, event: string, data?: any): void {
    this.log('info', 'job', `Job ${jobId}: ${event}`, data);
  }

  /**
   * Log location update
   */
  logLocationUpdate(lat: number, lng: number, accuracy?: number): void {
    this.debug('location', 'Location update', {
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
      accuracy,
    });
  }

  /**
   * Core logging function
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: any,
    error?: LogEntry['error']
  ): void {
    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      error,
    };

    this.addLog(entry);
  }

  /**
   * Add log entry
   */
  private addLog(entry: LogEntry): void {
    // Console output
    if (this.config.enableConsole) {
      this.logToConsole(entry);
    }

    // Add to logs array
    this.logs.push(entry);

    // Trim if exceeds max size
    if (this.logs.length > this.config.maxLogSize) {
      this.logs.shift();
    }

    // Persist (debounced in production)
    if (this.config.enablePersistence) {
      if (__DEV__) {
        this.persistLogs();
      } else {
        this.debouncedPersist();
      }
    }
  }

  /**
   * Log to console with formatting
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const emoji = this.getLevelEmoji(entry.level);
    const prefix = `${emoji} [${entry.category}]`;

    const message = `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(message, entry.data || '');
        break;
      case 'info':
        console.log(message, entry.data || '');
        break;
      case 'warn':
        console.warn(message, entry.data || '');
        break;
      case 'error':
      case 'critical':
        console.error(message, entry.error || entry.data || '');
        if (entry.error?.stack) {
          console.error(entry.error.stack);
        }
        break;
    }
  }

  /**
   * Get emoji for log level
   */
  private getLevelEmoji(level: LogLevel): string {
    const emojis: Record<LogLevel, string> = {
      debug: '🐛',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
      critical: '🚨',
    };
    return emojis[level];
  }

  /**
   * Load logs from storage
   */
  private async loadLogs(): Promise<void> {
    try {
      const logsJson = await AsyncStorage.getItem(LOGS_STORAGE_KEY);
      if (logsJson) {
        this.logs = JSON.parse(logsJson);
        console.log(`📝 [Logger] Loaded ${this.logs.length} logs from storage`);
      }
    } catch (error) {
      console.error('❌ [Logger] Failed to load logs:', error);
      this.logs = [];
    }
  }

  /**
   * Persist logs to storage
   */
  private async persistLogs(): Promise<void> {
    try {
      await AsyncStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(this.logs));
    } catch (error) {
      console.error('❌ [Logger] Failed to persist logs:', error);
    }
  }

  /**
   * Debounced persist (for production)
   */
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private debouncedPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistLogs();
    }, 5000); // Persist every 5 seconds
  }

  /**
   * Clean up old logs
   */
  private async cleanupOldLogs(): Promise<void> {
    const cutoffTime = Date.now() - this.config.maxLogAge;
    const before = this.logs.length;

    this.logs = this.logs.filter((log) => log.timestamp > cutoffTime);

    const after = this.logs.length;
    if (before !== after) {
      console.log(`🗑️ [Logger] Cleaned up ${before - after} old logs`);
      await this.persistLogs();
    }
  }

  /**
   * Get logs filtered by criteria
   */
  getLogs(filter?: {
    level?: LogLevel;
    category?: LogCategory;
    since?: number;
    limit?: number;
  }): LogEntry[] {
    let filtered = [...this.logs];

    if (filter?.level) {
      filtered = filtered.filter((log) => log.level === filter.level);
    }

    if (filter?.category) {
      filtered = filtered.filter((log) => log.category === filter.category);
    }

    if (filter?.since) {
      filtered = filtered.filter((log) => log.timestamp >= filter.since);
    }

    // Sort by timestamp (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    if (filter?.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Get logs as formatted string
   */
  getLogsAsString(filter?: Parameters<typeof this.getLogs>[0]): string {
    const logs = this.getLogs(filter);

    return logs
      .map((log) => {
        const timestamp = new Date(log.timestamp).toISOString();
        const level = log.level.toUpperCase().padEnd(8);
        const category = log.category.padEnd(12);
        let line = `[${timestamp}] ${level} ${category} ${log.message}`;

        if (log.data) {
          line += `\n  Data: ${JSON.stringify(log.data, null, 2)}`;
        }

        if (log.error) {
          line += `\n  Error: ${log.error.name}: ${log.error.message}`;
          if (log.error.stack) {
            line += `\n  Stack: ${log.error.stack}`;
          }
        }

        if (log.performance) {
          line += `\n  Performance: ${log.performance.operation} took ${log.performance.duration}ms`;
        }

        return line;
      })
      .join('\n\n');
  }

  /**
   * Export logs for sharing/debugging
   */
  async exportLogs(): Promise<string> {
    return this.getLogsAsString();
  }

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<void> {
    console.log('🗑️ [Logger] Clearing all logs...');
    this.logs = [];
    await AsyncStorage.removeItem(LOGS_STORAGE_KEY);
    console.log('✅ [Logger] Logs cleared');
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<LogCategory, number>;
    oldest?: number;
    newest?: number;
  } {
    const byLevel: Record<LogLevel, number> = {
      debug: 0,
      info: 0,
      warn: 0,
      error: 0,
      critical: 0,
    };

    const byCategory: Record<LogCategory, number> = {
      auth: 0,
      job: 0,
      location: 0,
      socket: 0,
      payment: 0,
      navigation: 0,
      api: 0,
      performance: 0,
      system: 0,
      ui: 0,
    };

    this.logs.forEach((log) => {
      byLevel[log.level]++;
      byCategory[log.category]++;
    });

    return {
      total: this.logs.length,
      byLevel,
      byCategory,
      oldest: this.logs.length > 0 ? this.logs[0].timestamp : undefined,
      newest: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : undefined,
    };
  }

  /**
   * Send critical log to remote monitoring (placeholder)
   */
  private async sendCriticalLogToRemote(log: {
    category: LogCategory;
    message: string;
    error?: Error;
    data?: any;
  }): Promise<void> {
    // TODO: Implement remote logging (Sentry, LogRocket, etc.)
    console.log('🚨 [Logger] Critical log (would send to remote):', log);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const logger = new Logger();

// Export for testing
export default logger;

