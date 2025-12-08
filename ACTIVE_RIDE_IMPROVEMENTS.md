# Active Ride Screen Logic Improvements

## Issues Fixed

### 1. **GPS Glitch Detection & Filtering**

**Problem:** GPS can show fake jumps (e.g., suddenly jumping 500m), which were being counted as movement.

**Solution:**

- Added `MAX_REASONABLE_SPEED_KMH = 200` (maximum realistic taxi speed)
- Added `MAX_REASONABLE_DISTANCE_PER_SECOND = 55` meters (~200 km/h)
- If distance moved exceeds reasonable limits for the time elapsed, the update is ignored as a GPS glitch
- Increased `GPS_NOISE_FILTER_METERS` from 10 to 15 meters
- Increased `MIN_MOVEMENT_DISTANCE_METERS` from 3 to 5 meters

**File:** `/src/utils/enhancedJobTimer.ts`

```typescript
// GPS GLITCH DETECTION
const maxDistanceForTimeDiff =
  MAX_REASONABLE_DISTANCE_PER_SECOND * timeDiffSeconds;
if (distanceMovedThisTick > maxDistanceForTimeDiff) {
  console.warn("GPS GLITCH DETECTED - IGNORING");
  distanceMovedThisTick = 0;
}
```

### 2. **Total Time vs Waiting Time Bug**

**Problem:** Waiting time was exceeding total elapsed time (e.g., waiting: 5min 11sec, total: 3min 19sec)

**Root Cause:**

- `elapsed` time was calculated from `Date.now()` continuously
- `waiting` time was accumulated from previous updates
- This could cause waiting time to be counted in intervals that weren't included in elapsed time

**Solution:**

- Changed elapsed time calculation to use `lastUpdateTime` instead of `Date.now()`
- Added validation: `waiting time = Math.min(waitingTime, elapsedTime)`
- This ensures waiting time can NEVER exceed total elapsed time

**File:** `/src/utils/enhancedJobTimer.ts`

```typescript
private getCurrentMetrics(currentLocation: LocationUpdate | null): TimerMetrics {
  // Use lastUpdateTime to ensure we only count time we've actually measured
  let elapsed = this.lastUpdateTime
    ? (this.lastUpdateTime - this.startTime) / 1000
    : 0;

  // Validation: waiting can't exceed elapsed
  const validWaitingTime = Math.min(this.totalWaitingSeconds, elapsed);

  if (this.totalWaitingSeconds > elapsed) {
    console.warn('WAITING TIME EXCEEDED ELAPSED TIME - Correcting');
  }

  return {
    distance: this.totalDistanceMeters,
    waiting: validWaitingTime,
    elapsed: elapsed,
    isMoving,
  };
}
```

### 3. **Persistent Data Across App Restarts**

**Problem:** When closing and reopening the app, job metrics (distance, time, waiting time, tariff) were lost.

**Solution:**

- Enhanced `PersistedJobState` type to include:
  - `selectedTariffId` - remembers which tariff was selected
  - `pricingBreakdown` - preserves real-time pricing data
  - `pauseRecords` - keeps pause history
- Updated hydration logic to restore all these fields from AsyncStorage
- Timer now initializes from persisted job data

**File:** `/src/context/JobContext.tsx`

```typescript
type PersistedJobState = {
  status: JobStatus;
  job: ActiveJob;
  timer: JobTimerState;
  routePoints: RoutePoint[];
  timestamp: number;
  selectedTariffId?: string; // ✅ NEW
  pricingBreakdown?: PricingBreakdown; // ✅ NEW
  pauseRecords?: PauseRecord[]; // ✅ NEW
};
```

### 4. **Smarter Movement Detection**

**Problem:** Vehicle was considered "moving" even when GPS speed showed 1-3 km/h (GPS drift).

**Solution:**

- Increased `MIN_MOVING_SPEED_KMH` from 1 to 5 km/h
- Uses coordinate-based detection as primary method:
  - Calculates actual distance moved between GPS points
  - Calculates effective speed: `(distance / time) * 3.6`
  - More accurate than GPS-provided speed
- Falls back to GPS speed only if coordinate data unavailable
- Threshold: Vehicle is "stopped" if moved < 5 meters between updates

**File:** `/src/utils/enhancedJobTimer.ts`

```typescript
private isVehicleMoving(location, distanceMoved, timeDiff): boolean {
  // PRIORITY 1: Coordinate-based detection
  if (timeDiff > 0) {
    if (distanceMoved < MIN_MOVEMENT_DISTANCE_METERS) {
      return false; // STOPPED
    }
    const calculatedSpeedKmh = (distanceMoved / timeDiff) * 3.6;
    return calculatedSpeedKmh >= MIN_MOVING_SPEED_KMH;
  }

  // PRIORITY 2: GPS speed fallback
  if (location?.speed !== undefined) {
    return location.speed >= MIN_MOVING_SPEED_KMH;
  }

  // No data - assume stopped (safer)
  return false;
}
```

### 5. **Top Padding Fixed for All Screens**

**Problem:** Status bar was overlapping content on all screens.

**Solution:**

- Added `paddingTop: 40` to container styles in all screen files:
  - HomeScreen.tsx ✅
  - TariffSelectionScreen.tsx ✅
  - JobOfferScreen.tsx ✅
  - LoginScreen.tsx ✅
  - RegisterScreen.tsx ✅
  - ZoneManagementScreen.tsx ✅
  - JobPausedScreen.tsx ✅
  - EnhancedJobTrackingScreen.tsx ✅
  - ActiveRideScreen.tsx ✅
  - PaymentCollectionScreen.tsx ✅
  - ActiveJobScreen.tsx ✅

## Configuration Constants (Updated)

```typescript
// Enhanced Job Timer Configuration
const GPS_NOISE_FILTER_METERS = 15; // Ignore movements below 15m
const MIN_MOVING_SPEED_KMH = 5; // Must be moving at 5+ km/h
const MIN_MOVEMENT_DISTANCE_METERS = 5; // Must move 5+ meters
const MAX_REASONABLE_SPEED_KMH = 200; // Max taxi speed
const MAX_REASONABLE_DISTANCE_PER_SECOND = 55; // ~200 km/h in m/s
```

## Testing Checklist

### GPS Glitch Filtering

- [ ] Start active ride
- [ ] Watch logs for "GPS GLITCH DETECTED" messages
- [ ] Verify unrealistic jumps are ignored
- [ ] Verify real movement is still tracked

### Time Calculation Fix

- [ ] Start active ride and let it run for 5+ minutes
- [ ] Stop vehicle and wait for 2+ minutes
- [ ] Verify: `total time >= waiting time` (always true)
- [ ] Check logs for any "WAITING TIME EXCEEDED" warnings

### Data Persistence

- [ ] Start active ride
- [ ] Drive for a bit (accumulate distance and time)
- [ ] Force close the app completely
- [ ] Reopen the app
- [ ] Verify all metrics are preserved:
  - Total distance
  - Total time
  - Waiting time
  - Selected tariff
  - Pricing breakdown

### Movement Detection

- [ ] Start active ride
- [ ] Park vehicle completely (engine off)
- [ ] Watch logs: should show "🛑 STOPPED"
- [ ] Drive slowly (< 5 km/h)
- [ ] Should still count as stopped
- [ ] Drive normally (> 5 km/h)
- [ ] Should show "🚗 MOVING"

### Screen Padding

- [ ] Open each screen and verify no overlap with status bar
- [ ] Check on different Android devices/simulators

## Debugging

All enhanced logging includes emojis for easy filtering:

```bash
# Filter for movement detection
adb logcat | grep "🚗\|🛑"

# Filter for GPS glitches
adb logcat | grep "🚨 GPS GLITCH"

# Filter for time tracking
adb logcat | grep "⏱️ WAITING TIME"

# Filter for distance tracking
adb logcat | grep "✅ Distance added"

# Filter for timer metrics
adb logcat | grep "📊 Timer metrics"
```

## Next Steps

1. Build and install new APK with fixes
2. Test walk-in job creation (database fix should now work)
3. Monitor logs during active rides for any remaining issues
4. Verify data persists across app restarts
