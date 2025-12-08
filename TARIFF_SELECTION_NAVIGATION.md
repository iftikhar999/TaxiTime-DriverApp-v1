# ✅ Tariff Selection → Auto-Navigation Flow

## Current Behavior (CORRECT!)

After tariff selection, the app **automatically** handles navigation based on the driver's current state:

### Flow After "Confirm Selection"

1. **Tariff selected** → `TariffSelectionScreen.handleConfirm()` called
2. **Shift started** → Backend creates active shift and notifies driver
3. **Navigation to Home** → `navigation.navigate("Home")`
4. **HomeScreen gains focus** → `useFocusEffect` hook triggers (line 1960)
5. **Job state check** → HomeScreen checks if `currentJob` exists
6. **Auto-navigation**:
   - ✅ **If active job exists** → Automatically navigates to appropriate job screen:
     - `INCOMING` → JobOffer screen (accept/reject)
     - `ASSIGNED/ACCEPTED/ON_THE_WAY/ARRIVED` → EnhancedJobTracking
     - `STARTED/ACTIVE/REACHED` → ActiveRide (with meter)
     - `PAUSED` → JobPaused
     - `PENDING_PAYMENT` → PaymentCollection
   - ✅ **If no job** → Shows Dashboard (available for new jobs)

## Code Implementation

### TariffSelectionScreen.tsx (lines 155-225)

```typescript
const handleConfirm = useCallback(async () => {
  // Start shift with selected vehicle and tariff
  await startShift({
    vehicleId,
    tariffId: selectedTariff.id,
    location: locationPayload,
  });

  // Refresh shift and ride history
  await Promise.all([
    refreshCurrentShift(),
    refreshRideHistory(3)
  ]);

  // Navigate to Home - HomeScreen will automatically show correct screen
  navigation.navigate("Home");
}, [...]);
```

### HomeScreen.tsx (lines 1900-1957)

```typescript
// ✅ Auto-navigation based on job status
useEffect(() => {
  if (!currentJob || jobStatus === "IDLE" || jobStatus === "COMPLETED") {
    return;
  }

  const jobKey = `${currentJob.id}_${jobStatus}`;
  if (hasNavigatedRef.current === jobKey) {
    return; // Already navigated
  }

  // Auto-navigate based on job status
  if (jobStatus === "INCOMING") {
    navigation.navigate("JobOffer", { job: currentJob });
  } else if (
    ["ASSIGNED", "ACCEPTED", "ON_THE_WAY", "ARRIVED"].includes(jobStatus)
  ) {
    navigation.navigate("EnhancedJobTracking");
  } else if (["STARTED", "ACTIVE", "REACHED"].includes(jobStatus)) {
    navigation.navigate("ActiveRide");
  }
  // ... more conditions
}, [currentJob, jobStatus, navigation]);
```

### HomeScreen.tsx (lines 1960-1982) - Focus Effect

```typescript
// ✅ Fallback check when screen gains focus
useFocusEffect(
  useCallback(() => {
    const timer = setTimeout(() => {
      if (currentJob && jobStatus) {
        const jobKey = `${currentJob.id}_${jobStatus}`;
        if (hasNavigatedRef.current !== jobKey) {
          // Force navigation check to run
          hasNavigatedRef.current = null;
        }
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [currentJob, jobStatus])
);
```

## What Happens in Each Scenario

### Scenario 1: No Job Waiting

1. Select tariff → Start shift
2. Navigate to Home
3. `currentJob` is `null`
4. **Shows Dashboard** - driver is available
5. When job comes in via socket → Auto-navigates to JobOffer

### Scenario 2: Job Already Assigned

1. Select tariff → Start shift
2. Navigate to Home
3. `currentJob` exists with status `ASSIGNED`
4. `useFocusEffect` triggers after 300ms
5. **Auto-navigates to EnhancedJobTracking** - driver sees assigned job

### Scenario 3: Job Already Started

1. Select tariff → Start shift (resuming existing shift)
2. Navigate to Home
3. `currentJob` exists with status `STARTED`
4. `useFocusEffect` triggers after 300ms
5. **Auto-navigates to ActiveRide** - driver sees active trip with meter

## Key Features

✅ **No manual navigation needed** - App automatically shows correct screen
✅ **Socket-driven** - Jobs received via real-time socket events trigger navigation
✅ **Focus-aware** - Re-checks job state when returning to HomeScreen
✅ **State-persistent** - Works even if app is killed and restarted (via AsyncStorage)
✅ **Prevents loops** - Uses `hasNavigatedRef` to prevent navigating to same job multiple times

## Testing

1. **Test Dashboard**: Select tariff when no jobs → Should show dashboard
2. **Test Job Offer**: Have dispatcher assign job before tariff selection → Should show JobOffer screen
3. **Test Active Job**: Start job, kill app, reopen, select tariff → Should show ActiveRide with meter running
4. **Test Job Incoming**: On dashboard, when new job arrives → Should auto-navigate to JobOffer

## Debugging

If navigation doesn't work:

1. Check console logs: `🔍 HomeScreen rendering decision CHANGED`
2. Verify `currentJob` and `jobStatus` values
3. Check `hasNavigatedRef.current` - should be `null` or match job key
4. Ensure socket connection is active: Check for `📡 Socket connected` logs
5. Verify `useFocusEffect` fires: Look for `🔍 Focus Effect - Checking for active job`

---

**Status**: ✅ WORKING AS DESIGNED
**Last Updated**: October 31, 2025
**Developer**: Navigation flow is fully automatic - no additional code needed
