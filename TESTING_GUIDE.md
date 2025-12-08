# Driver App - Testing Guide

## Quick Testing Checklist

### 1. Map Appearance Test ✓

**Goal:** Verify minimal map style (roads only, no POIs)

**Steps:**

1. Open app and log in
2. Navigate to Home screen
3. Observe map display

**Expected:**

- ✅ Roads clearly visible
- ✅ Driver marker (blue navigation icon) visible
- ✅ Zone boundary (if selected) visible
- ❌ NO business logos (restaurants, shops, etc.)
- ❌ NO points of interest markers
- ❌ NO transit icons

**Status:** ✅ Implemented

---

### 2. Background Meter Test ✓

**Goal:** Verify meter continues when app is minimized

**Steps:**

1. Start a walk-in job
2. Wait for meter to start (verify time/distance updates)
3. Minimize app (press home button)
4. Wait 2-3 minutes
5. Reopen app

**Expected:**

- ✅ Notification visible showing ride metrics
- ✅ Time continues accumulating
- ✅ Distance updates if moving
- ✅ When reopened, time reflects actual elapsed time (not frozen)

**Check:**

- Before minimize: Note the elapsed time
- After 3 min minimized: Elapsed time should be ~3 min more
- NO time jump or reset

**Status:** ✅ Implemented

---

### 3. App Close/Restart Test ✓

**Goal:** Verify meter survives app closure

**Steps:**

1. Start a walk-in job
2. Note current metrics (time: X, distance: Y)
3. Swipe app away (force close)
4. Wait 2 minutes
5. Reopen app

**Expected:**

- ✅ Job still active (not lost)
- ✅ Time = X + 2 minutes (approximately)
- ✅ Distance preserved or increased
- ✅ Waiting time preserved
- ✅ No data loss

**Status:** ✅ Implemented

---

### 4. Movement Detection Test ✓

**Goal:** Verify smart waiting time tracking

**Steps:**

1. Start walk-in job while stationary
2. Wait 1 minute without moving
3. Check waiting time (should be ~1 min)
4. Drive for 2 minutes
5. Check waiting time (should still be ~1 min, NOT 3 min)
6. Stop and wait 1 more minute
7. Check waiting time (should be ~2 min now)

**Expected:**

- ✅ Waiting time only increases when stopped
- ✅ Waiting time does NOT increase while moving
- ✅ Movement detection is stable (no false positives)

**Validation:**

```
Total time: 4 min
Waiting time: 2 min
Moving time: 2 min
```

**Status:** ✅ Implemented with rolling average

---

### 5. GPS Glitch Test ✓

**Goal:** Verify GPS errors don't corrupt meter data

**Steps:**

1. Start walk-in job
2. Simulate GPS glitch (if possible) or wait for natural GPS jump
3. Observe logs for "GPS GLITCH DETECTED" warnings
4. Verify distance doesn't jump unrealistically

**Expected:**

- ✅ Large GPS jumps are filtered out
- ✅ Distance remains realistic
- ✅ No sudden 500m+ movements from noise

**Status:** ✅ Implemented (filters > 200 km/h)

---

### 6. Pause/Resume Test ✓

**Goal:** Verify pause functionality works correctly

**Steps:**

1. Start walk-in job
2. Let it run for 1 minute
3. Pause the job
4. Wait 1 minute (app visible)
5. Resume the job
6. Check metrics

**Expected:**

- ✅ Time stops accumulating during pause
- ✅ Elapsed time after resume ≈ 1 min (not 2 min)
- ✅ Pause duration recorded in pause records
- ✅ Notification updates to show paused state

**Status:** ✅ Implemented

---

### 7. Time Accuracy Test ✓

**Goal:** Verify elapsed time is always correct

**Steps:**

1. Start walk-in job at time T
2. Note start time
3. Minimize, close, reopen app multiple times
4. After 10 real minutes, check elapsed time

**Expected:**

- ✅ Elapsed time = 10 minutes (±10 seconds tolerance)
- ✅ NO time jumps
- ✅ NO time freezing
- ✅ Waiting time ≤ Elapsed time (always)

**Status:** ✅ Implemented with timestamp-based calculation

---

### 8. Offline Test

**Goal:** Verify meter works without network

**Steps:**

1. Start walk-in job
2. Enable airplane mode
3. Wait 2 minutes
4. Drive around (GPS should still work)
5. Disable airplane mode

**Expected:**

- ✅ Meter continues running offline
- ✅ Location updates continue (GPS doesn't need internet)
- ✅ Distance accumulates
- ✅ When online, data eventually syncs to server

**Status:** ✅ Should work (GPS is independent of network)

---

### 9. Battery/Performance Test

**Goal:** Ensure app doesn't drain battery excessively

**Steps:**

1. Start walk-in job
2. Let app run for 30 minutes (background + foreground)
3. Check battery usage in device settings

**Expected:**

- ✅ Reasonable battery usage (~5-10% per hour)
- ✅ No excessive CPU usage
- ✅ GPS updates are efficient

**Note:** Foreground services with GPS will use battery, but should be optimized

**Status:** ⚠️ Needs real-world testing

---

### 10. Notification Test ✓

**Goal:** Verify notifications show correct data

**Steps:**

1. Start walk-in job
2. Minimize app
3. Check notification panel

**Expected:**

- ✅ Two notifications visible:
  1. "TaxiTime Driver" - Location tracking
  2. "Active Ride" - Meter data
- ✅ Meter notification updates every second
- ✅ Shows: Time, Distance, Waiting time
- ✅ Shows movement status: "Moving" or "Stopped"

**Status:** ✅ Implemented

---

## Debugging Commands

### View Logs

```bash
# All app logs
adb logcat | grep ReactNativeJS

# Job meter service logs
adb logcat | grep JobMeterService

# Location tracking logs
adb logcat | grep LocationTracking

# Enhanced job timer logs
adb logcat | grep EnhancedJobTimer
```

### Check Running Services

```bash
# List all running services
adb shell dumpsys activity services | grep taxitime

# Check if job meter service is running
adb shell dumpsys activity services | grep JobMeterService
```

### Monitor GPS

```bash
# Watch GPS location updates
adb logcat | grep "GPS LOCATION RECEIVED"
```

---

## Known Issues & Limitations

### 1. Physical Device Required for Full Testing

- Emulator GPS may not be realistic
- Actual movement needed for accurate testing
- Battery usage can only be tested on real device

### 2. Android Version Compatibility

- Tested on Android 10+
- Foreground services work differently on older versions
- Background restrictions vary by manufacturer (Samsung, Xiaomi, etc.)

### 3. Battery Optimization

- Some manufacturers aggressively kill background services
- Users may need to disable battery optimization for the app
- Instructions should be provided in app settings

---

## Production Checklist

Before deploying to production:

- [ ] Test on multiple physical devices
- [ ] Test with different Android versions (10, 11, 12, 13, 14)
- [ ] Test with different manufacturers (Samsung, Google, Xiaomi, etc.)
- [ ] Verify battery usage is acceptable
- [ ] Test in low battery scenarios
- [ ] Test with poor GPS signal
- [ ] Test in areas with GPS drift (near tall buildings)
- [ ] Verify server sync works correctly
- [ ] Test with multiple rides in sequence
- [ ] Test edge cases (very short rides, very long rides)
- [ ] Verify fare calculations are correct
- [ ] Test with different tariffs
- [ ] Verify all pause/resume scenarios
- [ ] Check memory usage (no leaks)
- [ ] Verify no ANR (Application Not Responding) errors

---

## Rollback Plan

If issues are discovered in production:

1. **Quick Fix:** Revert to previous APK
2. **Data Recovery:** Persisted state should survive rollback
3. **User Communication:** Notify drivers of any temporary issues
4. **Logs Collection:** Gather crash reports and logs for analysis

---

## Support Contacts

**Technical Issues:**

- Check logs with commands above
- Review DRIVER_APP_REFACTORING_COMPLETE.md for implementation details

**Testing Support:**

- Use this guide for systematic testing
- Report issues with: device model, Android version, logs

---

## Success Criteria

The refactoring is successful if:

✅ Map shows only roads and driver marker (no POIs)
✅ Meter runs continuously in background
✅ Time is always accurate (calculated from job start)
✅ Distance tracking is reliable (no GPS glitches)
✅ Waiting time is accurate (only when stopped)
✅ Data persists across app restarts
✅ No false movement detection
✅ No false waiting time accumulation
✅ Battery usage is reasonable
✅ No crashes or ANR errors
✅ Drivers trust the meter accuracy

---

**Last Updated:** November 2, 2025  
**Version:** 1.0.0  
**Status:** Ready for Testing
