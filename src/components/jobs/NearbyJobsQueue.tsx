/**
 * 🚕 NEARBY JOBS QUEUE COMPONENT
 * 
 * Displays nearby pending jobs within 3km and allows driver to queue ONE job
 * for automatic start after completing current trip.
 * 
 * Features:
 * - Shows jobs sorted by distance (closest first)
 * - Driver can queue ONE job (highlighted in queue section)
 * - Queued job auto-starts after current trip completion
 * - Real-time updates via socket
 */

import React, { useCallback, useMemo } from 'react';
import {
    ActivityIndicator,
    Platform,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { NearbyJob, useJobQueue } from '../../context/JobQueueContext';

interface NearbyJobsQueueProps {
  compactMode?: boolean;
}

const NearbyJobsQueue: React.FC<NearbyJobsQueueProps> = ({ compactMode = false }) => {
  const {
    nearbyJobs,
    nearbyJobsLoading,
    refreshNearbyJobs,
    queuedJob,
    canQueueJob,
    queueJob,
    clearQueuedJob,
    queueError,
  } = useJobQueue();
  
  const handleQueueJob = useCallback(async (job: NearbyJob) => {
    const success = await queueJob(job);
    
    if (success) {
      Toast.show({
        type: 'success',
        text1: 'Job Queued',
        text2: `${job.pickupAddress?.substring(0, 30)}... will auto-start after current trip`,
        position: 'top',
      });
    } else {
      Toast.show({
        type: 'error',
        text1: 'Cannot Queue Job',
        text2: queueError || 'Only ONE job can be queued at a time',
        position: 'top',
      });
    }
  }, [queueJob, queueError]);
  
  const handleClearQueue = useCallback(() => {
    clearQueuedJob();
    Toast.show({
      type: 'info',
      text1: 'Queue Cleared',
      text2: 'Queued job removed',
      position: 'top',
    });
  }, [clearQueuedJob]);
  
  // Format distance for display
  const formatDistance = (km: number | undefined): string => {
    if (!km) return '--';
    if (km < 1) return `${Math.round(km * 1000)}m`;
    return `${km.toFixed(1)}km`;
  };
  
  // Memoized job list with queued job priority
  const displayJobs = useMemo(() => {
    return nearbyJobs.slice(0, 5); // Max 5 jobs displayed
  }, [nearbyJobs]);
  
  return (
    <View style={styles.container}>
      {/* Queued Job Section - Always show if job is queued */}
      {queuedJob && (
        <View style={styles.queuedSection}>
          <View style={styles.queuedHeader}>
            <View style={styles.queuedBadge}>
              <Icon name="playlist-check" size={14} color="#fff" />
              <Text style={styles.queuedBadgeText}>QUEUED</Text>
            </View>
            <TouchableOpacity
              style={styles.clearQueueButton}
              onPress={handleClearQueue}
              activeOpacity={0.7}
            >
              <Icon name="close-circle" size={16} color="#ef4444" />
              <Text style={styles.clearQueueText}>Clear</Text>
            </TouchableOpacity>
          </View>
          
          <View style={styles.queuedJobCard}>
            <View style={styles.queuedJobLeft}>
              <View style={styles.queuedDistanceBadge}>
                <Text style={styles.queuedDistanceText}>
                  {formatDistance(queuedJob.distanceToPickup)}
                </Text>
              </View>
              <View style={styles.queuedJobDetails}>
                <Text style={styles.queuedPickup} numberOfLines={2}>
                  <Icon name="map-marker" size={12} color="#22c55e" />{' '}
                  {queuedJob.pickupAddress || 'Pickup location'}
                </Text>
                {/* Dropoff intentionally hidden — drivers see the destination
                    only AFTER claiming the job. Prevents cherry-picking
                    by trip length. */}
              </View>
            </View>
          </View>
          <Text style={styles.queuedHint}>
            This job will automatically start after completing your current trip
          </Text>
        </View>
      )}
      
      {/* Nearby Jobs Section */}
      <View style={styles.nearbySection}>
        <View style={styles.nearbyHeader}>
          <View style={styles.nearbyTitleRow}>
            <Icon name="radar" size={16} color="#fbbf24" />
            <Text style={styles.nearbyTitle}>NEARBY JOBS</Text>
            <Text style={styles.nearbyRadius}>within 3km</Text>
          </View>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={refreshNearbyJobs}
            disabled={nearbyJobsLoading}
            activeOpacity={0.7}
          >
            {nearbyJobsLoading ? (
              <ActivityIndicator size="small" color="#fbbf24" />
            ) : (
              <Icon name="refresh" size={16} color="#fbbf24" />
            )}
          </TouchableOpacity>
        </View>
        
        {displayJobs.length > 0 ? (
          displayJobs.map((job, index) => (
            <View key={job.id} style={styles.nearbyJobCard}>
              <View style={styles.nearbyJobLeft}>
                <View style={styles.distanceBadge}>
                  <Text style={styles.distanceText}>
                    {formatDistance(job.distanceToPickup)}
                  </Text>
                </View>
                <View style={styles.nearbyJobDetails}>
                  <Text style={styles.nearbyPickup} numberOfLines={2}>
                    {job.pickupAddress || 'Pickup location'}
                  </Text>
                  {/* Dropoff intentionally hidden on the list view. Driver
                      gets the destination only after accepting the job —
                      stops them from skipping short or long rides. */}
                </View>
              </View>
              <View style={styles.nearbyJobRight}>
                {canQueueJob ? (
                  <TouchableOpacity
                    style={styles.queueButton}
                    onPress={() => handleQueueJob(job)}
                    activeOpacity={0.7}
                  >
                    <Icon name="plus" size={12} color="#000" />
                    <Text style={styles.queueButtonText}>QUEUE</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.queueButtonDisabled}>
                    <Icon name="lock" size={10} color="#666" />
                    <Text style={styles.queueButtonDisabledText}>FULL</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        ) : (
          <View style={styles.noJobs}>
            <Icon 
              name={nearbyJobsLoading ? "loading" : "check-circle-outline"} 
              size={20} 
              color="#666" 
            />
            <Text style={styles.noJobsText}>
              {nearbyJobsLoading 
                ? 'Searching nearby...' 
                : 'No nearby jobs available'
              }
            </Text>
          </View>
        )}
        
        {/* Info hint */}
        {!queuedJob && displayJobs.length > 0 && (
          <Text style={styles.hintText}>
            💡 Queue ONE job to auto-start after completing current trip
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 10,
    gap: 8,
  },
  
  // Queued Job Section
  queuedSection: {
    backgroundColor: '#1a2e1a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  queuedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  queuedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#22c55e',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  queuedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  clearQueueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearQueueText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ef4444',
  },
  queuedJobCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0d1a0d',
    borderRadius: 6,
    padding: 10,
  },
  queuedJobLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  queuedDistanceBadge: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  queuedDistanceText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  queuedJobDetails: {
    flex: 1,
    gap: 2,
  },
  queuedPickup: {
    fontSize: 11,
    color: '#22c55e',
    fontWeight: '600',
  },
  queuedDropoff: {
    fontSize: 10,
    color: '#888',
  },
  queuedJobRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  queuedFare: {
    fontSize: 14,
    fontWeight: '700',
    color: '#22c55e',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  queuedAutoStart: {
    fontSize: 8,
    fontWeight: '600',
    color: '#22c55e',
    letterSpacing: 0.5,
  },
  queuedHint: {
    fontSize: 9,
    color: '#4ade80',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  
  // Nearby Jobs Section
  nearbySection: {
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#333',
  },
  nearbyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  nearbyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nearbyTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    letterSpacing: 1,
  },
  nearbyRadius: {
    fontSize: 9,
    color: '#666',
    marginLeft: 4,
  },
  refreshButton: {
    padding: 4,
  },
  nearbyJobCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  nearbyJobLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  distanceBadge: {
    backgroundColor: '#333',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
    minWidth: 44,
    alignItems: 'center',
  },
  distanceText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  nearbyJobDetails: {
    flex: 1,
    gap: 2,
  },
  nearbyPickup: {
    fontSize: 11,
    color: '#ccc',
    fontWeight: '500',
  },
  nearbyDropoff: {
    fontSize: 10,
    color: '#888',
  },
  nearbyJobRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  nearbyFare: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fbbf24',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  queueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#fbbf24',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  queueButtonText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#000',
    letterSpacing: 0.3,
  },
  queueButtonDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#333',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  queueButtonDisabledText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#666',
    letterSpacing: 0.3,
  },
  noJobs: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  noJobsText: {
    fontSize: 11,
    color: '#666',
  },
  hintText: {
    fontSize: 9,
    color: '#666',
    textAlign: 'center',
    marginTop: 6,
  },
});

export default NearbyJobsQueue;
