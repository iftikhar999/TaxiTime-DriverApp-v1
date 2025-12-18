/**
 * Memoized Components for HomeScreen
 * 
 * These components use React.memo to prevent unnecessary re-renders
 * when parent state changes but props remain the same.
 */

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';

// ============================================
// METRIC CARD - Memoized for dashboard metrics
// ============================================
interface MetricCardProps {
  icon: string;
  iconColor: string;
  label: string;
  value: string;
  subValue?: string;
  onPress?: () => void;
}

export const MetricCard = memo<MetricCardProps>(
  ({ icon, iconColor, label, value, subValue, onPress }) => {
    const content = (
      <View style={styles.metricCard}>
        <View style={[styles.metricIconContainer, { backgroundColor: `${iconColor}20` }]}>
          <MCIcon name={icon} size={24} color={iconColor} />
        </View>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
        {subValue && <Text style={styles.metricSubValue}>{subValue}</Text>}
      </View>
    );

    if (onPress) {
      return (
        <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
          {content}
        </TouchableOpacity>
      );
    }

    return content;
  },
  (prevProps, nextProps) => {
    // Custom comparison for performance
    return (
      prevProps.value === nextProps.value &&
      prevProps.subValue === nextProps.subValue &&
      prevProps.label === nextProps.label &&
      prevProps.icon === nextProps.icon
    );
  }
);

MetricCard.displayName = 'MetricCard';

// ============================================
// STATUS BADGE - Memoized status indicator
// ============================================
interface StatusBadgeProps {
  status: 'AVAILABLE' | 'AWAY' | 'BUSY' | 'OFFLINE';
  onPress?: () => void;
}

const STATUS_CONFIG = {
  AVAILABLE: { color: '#10B981', label: 'Available', icon: 'check-circle' },
  AWAY: { color: '#F59E0B', label: 'Away', icon: 'pause-circle' },
  BUSY: { color: '#EF4444', label: 'Busy', icon: 'close-circle' },
  OFFLINE: { color: '#6B7280', label: 'Offline', icon: 'cancel' },
};

export const StatusBadge = memo<StatusBadgeProps>(
  ({ status, onPress }) => {
    const config = STATUS_CONFIG[status];

    return (
      <TouchableOpacity
        style={[styles.statusBadge, { backgroundColor: `${config.color}20` }]}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={!onPress}
      >
        <MCIcon name={config.icon} size={16} color={config.color} />
        <Text style={[styles.statusLabel, { color: config.color }]}>
          {config.label}
        </Text>
      </TouchableOpacity>
    );
  }
);

StatusBadge.displayName = 'StatusBadge';

// ============================================
// TIMER DISPLAY - Memoized timer component
// ============================================
interface TimerDisplayProps {
  elapsed: string;
  waiting?: string;
  distance: string;
  fare?: string;
}

export const TimerDisplay = memo<TimerDisplayProps>(
  ({ elapsed, waiting, distance, fare }) => {
    return (
      <View style={styles.timerContainer}>
        <View style={styles.timerRow}>
          <View style={styles.timerItem}>
            <MCIcon name="clock-outline" size={18} color="#6B7280" />
            <Text style={styles.timerValue}>{elapsed}</Text>
            <Text style={styles.timerLabel}>Elapsed</Text>
          </View>
          {waiting && (
            <View style={styles.timerItem}>
              <MCIcon name="pause-circle-outline" size={18} color="#F59E0B" />
              <Text style={styles.timerValue}>{waiting}</Text>
              <Text style={styles.timerLabel}>Waiting</Text>
            </View>
          )}
          <View style={styles.timerItem}>
            <MCIcon name="map-marker-distance" size={18} color="#6B7280" />
            <Text style={styles.timerValue}>{distance}</Text>
            <Text style={styles.timerLabel}>Distance</Text>
          </View>
          {fare && (
            <View style={styles.timerItem}>
              <MCIcon name="currency-usd" size={18} color="#10B981" />
              <Text style={[styles.timerValue, styles.fareValue]}>{fare}</Text>
              <Text style={styles.timerLabel}>Fare</Text>
            </View>
          )}
        </View>
      </View>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.elapsed === nextProps.elapsed &&
      prevProps.waiting === nextProps.waiting &&
      prevProps.distance === nextProps.distance &&
      prevProps.fare === nextProps.fare
    );
  }
);

TimerDisplay.displayName = 'TimerDisplay';

// ============================================
// LOADING OVERLAY - Memoized loading indicator
// ============================================
interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

export const LoadingOverlay = memo<LoadingOverlayProps>(
  ({ visible, message }) => {
    if (!visible) return null;

    return (
      <View style={styles.loadingOverlay}>
        <View style={styles.loadingContent}>
          <ActivityIndicator size="large" color="#3B82F6" />
          {message && <Text style={styles.loadingText}>{message}</Text>}
        </View>
      </View>
    );
  }
);

LoadingOverlay.displayName = 'LoadingOverlay';

// ============================================
// EMPTY STATE - Memoized empty placeholder
// ============================================
interface EmptyStateProps {
  icon: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState = memo<EmptyStateProps>(
  ({ icon, title, message, actionLabel, onAction }) => {
    return (
      <View style={styles.emptyState}>
        <MCIcon name={icon} size={48} color="#9CA3AF" />
        <Text style={styles.emptyTitle}>{title}</Text>
        {message && <Text style={styles.emptyMessage}>{message}</Text>}
        {actionLabel && onAction && (
          <TouchableOpacity style={styles.emptyAction} onPress={onAction}>
            <Text style={styles.emptyActionText}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
);

EmptyState.displayName = 'EmptyState';

// ============================================
// SECTION HEADER - Memoized section header
// ============================================
interface SectionHeaderProps {
  title: string;
  icon?: string;
  actionLabel?: string;
  onAction?: () => void;
  loading?: boolean;
}

export const SectionHeader = memo<SectionHeaderProps>(
  ({ title, icon, actionLabel, onAction, loading }) => {
    return (
      <View style={styles.sectionHeader}>
        <View style={styles.sectionHeaderLeft}>
          {icon && <MCIcon name={icon} size={20} color="#374151" style={styles.sectionIcon} />}
          <Text style={styles.sectionTitle}>{title}</Text>
          {loading && <ActivityIndicator size="small" color="#6B7280" style={styles.sectionLoader} />}
        </View>
        {actionLabel && onAction && (
          <TouchableOpacity onPress={onAction}>
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }
);

SectionHeader.displayName = 'SectionHeader';

// ============================================
// STYLES
// ============================================
const styles = StyleSheet.create({
  // Metric Card
  metricCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    minWidth: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  metricIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  metricLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  metricSubValue: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 2,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Timer Display
  timerContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
  },
  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  timerItem: {
    alignItems: 'center',
    gap: 4,
  },
  timerValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  fareValue: {
    color: '#10B981',
  },
  timerLabel: {
    fontSize: 11,
    color: '#6B7280',
  },

  // Loading Overlay
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  loadingContent: {
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#374151',
  },

  // Empty State
  emptyState: {
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  emptyMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#3B82F6',
    borderRadius: 8,
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    marginRight: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  sectionLoader: {
    marginLeft: 8,
  },
  sectionAction: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '500',
  },
});

export default {
  MetricCard,
  StatusBadge,
  TimerDisplay,
  LoadingOverlay,
  EmptyState,
  SectionHeader,
};
