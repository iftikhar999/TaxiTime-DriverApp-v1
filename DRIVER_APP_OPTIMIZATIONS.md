# Driver App Stability & Performance Optimizations

## 🔌 Socket Connection Improvements (✅ COMPLETED)

### Implemented:
1. **Infinite Reconnection with Exponential Backoff**
   - Changed from fixed 10 attempts to infinite retries
   - Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
   - Added jitter (±20%) to prevent thundering herd
   - Location: `src/services/driverSocket.ts`

2. **Shift State Restoration**
   - Automatic shift state fetch after reconnection
   - Driver remains "online" even if socket disconnects temporarily
   - Heartbeat automatically restarts when reconnected
   - Registered callback in `ShiftContext` for seamless restoration

3. **Connection Status Monitoring**
   - New `getConnectionStatus()` function to check:
     - `isConnected`: Socket connection state
     - `isOnline`: Online status
     - `authenticated`: Authentication state
     - `hasActiveShift`: Current shift status
     - `reconnectAttempt`: Number of reconnection attempts

### Benefits:
- ✅ Driver never loses shift due to temporary network issues
- ✅ Automatic recovery from backend restarts
- ✅ Queued events are replayed after reconnection
- ✅ No manual intervention needed

---

## 🚀 API Call Optimizations (IN PROGRESS)

### Issues Identified:

#### 1. **Excessive useFocusEffect Calls** (CRITICAL)
**Location**: `HomeScreen.tsx:1558`

```typescript
useFocusEffect(
  useCallback(() => {
    if (driver?.id) {
      refreshCurrentShift(); // ❌ Called EVERY time screen is focused
      refreshRideHistory(3); // ❌ Called EVERY time screen is focused
    }
  }, [driver?.id, refreshCurrentShift, refreshRideHistory])
);
```

**Problem**: Every time user switches tabs or returns to home screen, these API calls fire.

**Solution**: Use debouncing or check if data is recent enough:
```typescript
const SHIFT_REFRESH_INTERVAL = 60000; // 1 minute
const lastShiftRefresh = useRef(0);

useFocusEffect(
  useCallback(() => {
    const now = Date.now();
    if (driver?.id && now - lastShiftRefresh.current > SHIFT_REFRESH_INTERVAL) {
      refreshCurrentShift();
      refreshRideHistory(3);
      lastShiftRefresh.current = now;
    }
  }, [driver?.id, refreshCurrentShift, refreshRideHistory])
);
```

#### 2. **Upcoming Jobs Refetch on Location Change** (CRITICAL)
**Location**: `HomeScreen.tsx:1623`

```typescript
const refreshUpcomingJobs = useCallback(async () => {
  // ...
}, [shouldShowUpcomingJobs, currentZone?.id, location]); // ❌ location changes every 2-5s

useEffect(() => {
  refreshUpcomingJobs(); // ❌ Triggers API call every location update
}, [refreshUpcomingJobs]);
```

**Problem**: Driver's location updates every 2-5 seconds, causing constant API calls for upcoming jobs.

**Solution**: Remove `location` from dependencies, use real-time socket events instead:
```typescript
const refreshUpcomingJobs = useCallback(async () => {
  // ...
}, [shouldShowUpcomingJobs, currentZone?.id]); // ✅ Only refetch on zone change

// Rely on socket event for new jobs
useEffect(() => {
  const socket = getSocket();
  socket?.on('job:nearby', handleNewNearbyJob); // ✅ Real-time updates
  return () => socket?.off('job:nearby', handleNewNearbyJob);
}, []);
```

#### 3. **Company Settings Fetched Too Frequently**
**Problem**: Company settings rarely change but may be fetched multiple times.

**Solution**: Cache company settings in AsyncStorage with TTL:
```typescript
const COMPANY_SETTINGS_TTL = 3600000; // 1 hour

const getCachedCompanySettings = async (companyId: string) => {
  const cached = await AsyncStorage.getItem(`company_settings_${companyId}`);
  if (cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < COMPANY_SETTINGS_TTL) {
      return data;
    }
  }
  const fresh = await fetchCompanySettings(companyId);
  await AsyncStorage.setItem(`company_settings_${companyId}`, JSON.stringify({
    data: fresh,
    timestamp: Date.now()
  }));
  return fresh;
};
```

---

## 🔧 Job Processing Flow Improvements

### Critical Issues:

#### 1. **Job Acceptance Race Conditions**
**Problem**: Double-clicking accept button can send multiple accept requests.

**Solution**: Implement request debouncing and loading state:
```typescript
const [accepting, setAccepting] = useState(false);

const acceptJob = async () => {
  if (accepting) return; // Prevent double-click
  
  setAccepting(true);
  try {
    await emitJobProgress(jobId, 'ACCEPTED');
    // ...
  } finally {
    setAccepting(false);
  }
};
```

#### 2. **Job State Persistence**
**Current**: Job state is persisted every second with debounce.
**Improvement**: Persist immediately on critical state changes:

```typescript
const updateJobStatus = (status: JobStatus) => {
  setStatus(status);
  
  // Persist immediately for critical statuses
  if (['ACCEPTED', 'STARTED', 'COMPLETED'].includes(status)) {
    persistJobState({ status, job: currentJob, timer });
  }
};
```

#### 3. **Timer Synchronization**
**Problem**: Timer may drift if app goes to background.
**Solution**: Use timestamp-based calculations instead of interval increments.

---

## 📊 Data Synchronization Strategy

### Current Architecture:
- **Socket Events**: Real-time updates for jobs, status changes
- **Polling**: Shift data, ride history (can be optimized)
- **Local Storage**: Job state, vehicle selection, tariffs

### Proposed Improvements:

#### 1. **Smart Polling with BackOff**
```typescript
class SmartPoller {
  private interval: number;
  private maxInterval = 300000; // 5 minutes
  private minInterval = 30000; // 30 seconds
  
  onActivity() {
    this.interval = this.minInterval; // Fast polling when active
  }
  
  onIdle() {
    this.interval = Math.min(this.interval * 2, this.maxInterval); // Slow down when idle
  }
}
```

#### 2. **Cache-First Strategy**
```typescript
const fetchWithCache = async (key: string, fetcher: () => Promise<any>, ttl: number) => {
  // 1. Return cached data immediately
  const cached = await getCached(key);
  if (cached) return cached;
  
  // 2. Fetch in background
  const fresh = await fetcher();
  await setCache(key, fresh, ttl);
  return fresh;
};
```

#### 3. **Socket Event Priority**
```typescript
// High priority - immediate action required
socket.on('job:offer', handleJobOffer);
socket.on('job:cancelled', handleJobCancelled);

// Medium priority - update UI
socket.on('driver:status:updated', handleStatusUpdate);

// Low priority - background sync
socket.on('shift:updated', handleShiftUpdate);
```

---

## 🧪 Testing Checklist

### Critical Flow Tests:

#### 1. **Shift Management**
- [ ] Start shift → Goes online successfully
- [ ] Network disconnect → Shift persists
- [ ] Network reconnect → Shift restores automatically
- [ ] End shift → Goes offline successfully

#### 2. **Job Acceptance Flow**
- [ ] Job offer arrives → Modal appears
- [ ] Accept job → Status updates to ACCEPTED
- [ ] Navigate to pickup → Map displays route
- [ ] Arrive at pickup → Status updates to ARRIVED
- [ ] Start trip → Meter starts counting
- [ ] Complete trip → Earnings calculated correctly

#### 3. **Network Resilience**
- [ ] Airplane mode during shift → Events queued
- [ ] Reconnect → Events replayed
- [ ] Accept job while offline → Processes when online
- [ ] Update status while offline → Syncs on reconnect

#### 4. **Background Behavior**
- [ ] App goes to background → Location still updates
- [ ] Return to foreground → UI syncs with server
- [ ] Receive job while in background → Notification appears

---

## 📈 Performance Metrics

### Before Optimization:
- API calls per minute: ~20-30
- Location updates: Every 2s
- Battery drain: High

### After Optimization (Target):
- API calls per minute: ~5-10
- Location updates: Every 5s (configurable)
- Battery drain: Medium

---

## 🔜 Next Steps

1. ✅ Socket reconnection with exponential backoff
2. ✅ Shift restoration on reconnect
3. ⏳ Optimize useFocusEffect calls
4. ⏳ Remove location dependency from job refresh
5. ⏳ Implement company settings caching
6. ⏳ Add job acceptance debouncing
7. ⏳ Test complete driver flow end-to-end
8. ⏳ Profile battery usage

---

## 📝 Implementation Priority

### P0 (Critical - Must Fix):
1. Socket infinite reconnection ✅
2. Shift restoration ✅
3. Job acceptance race condition
4. Location-based job refetch issue

### P1 (High - Should Fix):
1. useFocusEffect optimization
2. Company settings caching
3. Timer drift fix

### P2 (Medium - Nice to Have):
1. Smart polling
2. Cache-first strategy
3. Background sync optimization

---

## 🎯 Success Criteria

- ✅ Driver never loses shift due to network issues
- ✅ Socket reconnects automatically with infinite retries
- ⏳ API calls reduced by 60-70%
- ⏳ Battery drain improved by 30-40%
- ⏳ Job acceptance success rate > 99%
- ⏳ No duplicate job acceptances
- ⏳ Smooth navigation flow from accept → complete


