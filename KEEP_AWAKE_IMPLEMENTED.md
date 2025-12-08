# 🔋 KEEP AWAKE - SCREEN NEVER SLEEPS DURING ACTIVE RIDES

## ✅ WHAT WAS IMPLEMENTED:

The driver app now **PREVENTS THE SCREEN FROM SLEEPING** during active rides using `react-native-keep-awake`.

---

## 🚀 HOW IT WORKS:

### Multi-Layer Wake Lock Strategy:

```
Layer 1: App-Level Wake Lock (Already Exists ✅)
    ↓
ForegroundService with PowerManager.PARTIAL_WAKE_LOCK
- Prevents CPU sleep when shift is active
- Keeps location tracking running in background
- Maintains socket connection to server
- File: android/app/src/main/java/com/taxitime/driverv1/ForegroundService.java

Layer 2: Screen-Level Wake Lock (NEWLY ADDED ✅)
    ↓
react-native-keep-awake in ActiveRideScreen
- Prevents screen from dimming/turning off
- Only active when ActiveRideScreen is mounted
- Automatically released when screen is unmounted
- File: src/screens/Jobs/ActiveRideScreen.tsx
```

### When Driver Starts Active Ride:

```
Driver: Taps "Start Meter" → Job status changes to STARTED
    ↓
Navigation: Automatically navigates to ActiveRideScreen
    ↓
KeepAwake Component: <KeepAwake /> is rendered
    ↓
Android: Screen stays ON, brightness maintained
    ↓
Result: Driver can see fare, distance, time without touching screen
    ↓
When Job Ends: ActiveRideScreen unmounts → KeepAwake released → Screen can sleep normally
```

---

## 📂 FILES MODIFIED:

### 1. **package.json**

```json
{
  "dependencies": {
    "react-native-keep-awake": "^4.0.0" // ✅ ADDED
  }
}
```

### 2. **src/screens/Jobs/ActiveRideScreen.tsx**

```tsx
// @ts-ignore - No type definitions available
import KeepAwake from "react-native-keep-awake";

const ActiveRideScreen: React.FC = () => {
  // ... existing code ...

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* ✅ KEEP SCREEN AWAKE - Prevent device sleep during active ride */}
      <KeepAwake />

      {/* Rest of screen content... */}
    </SafeAreaView>
  );
};
```

**Why This Location?**

- Only activates during active rides (STARTED status)
- Automatically deactivates when job ends
- No manual cleanup needed
- No interference with other screens

---

## 🎯 BENEFITS:

### For Drivers:

✅ **Screen Never Sleeps** - No need to constantly touch screen to keep it on  
✅ **Always Visible** - Fare, distance, time always displayed  
✅ **No Distractions** - Can focus on driving, not on unlocking phone  
✅ **Professional** - Clean, uninterrupted display like a real taxi meter

### For App:

✅ **Battery Efficient** - Only keeps screen on during active rides  
✅ **Automatic** - No driver interaction needed  
✅ **Reliable** - Uses native Android wake lock APIs  
✅ **Safe** - Released automatically when screen unmounts

---

## 📱 USER EXPERIENCE:

### Before (WITHOUT KeepAwake):

```
Driver starts ride → Screen on
    ↓
30 seconds pass → Screen dims
    ↓
1 minute passes → Screen turns off
    ↓
Driver needs to unlock → Distraction while driving ❌
```

### After (WITH KeepAwake):

```
Driver starts ride → Screen on
    ↓
Screen stays on → Always visible ✅
    ↓
Ride ends → Screen can sleep normally ✅
```

---

## ⚠️ IMPORTANT NOTES:

### Battery Consideration:

- Screen wake lock uses more battery than background wake lock
- This is EXPECTED and NECESSARY for driver safety
- Screen only stays on during ACTIVE RIDES (not idle time)
- Automatically released when ride ends

### Permissions:

- No additional Android permissions required
- `react-native-keep-awake` uses standard Android APIs
- Works on all Android versions

### Testing:

1. Start a shift
2. Accept a job
3. Start the meter (job status → STARTED)
4. ActiveRideScreen appears
5. Wait 2+ minutes WITHOUT touching the screen
6. ✅ Screen should stay ON and bright
7. End the ride
8. ✅ Screen should return to normal sleep behavior

---

## 🔧 TECHNICAL DETAILS:

### How react-native-keep-awake Works:

**Android Implementation:**

```java
// Under the hood, react-native-keep-awake uses:
getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

// This is equivalent to Android XML:
android:keepScreenOn="true"
```

**React Native Component:**

```tsx
<KeepAwake /> // Activates wake lock when mounted
// Component unmounts → wake lock released automatically
```

### Wake Lock Comparison:

| Type                | Location          | Scope           | Battery Impact |
| ------------------- | ----------------- | --------------- | -------------- |
| PARTIAL_WAKE_LOCK   | ForegroundService | CPU stays awake | Low            |
| FLAG_KEEP_SCREEN_ON | ActiveRideScreen  | Screen stays on | Medium         |

---

## 🚨 TROUBLESHOOTING:

### Screen Still Turns Off?

**Check 1: Verify KeepAwake is rendered**

```bash
# Add temporary log to confirm:
console.log('✅ KeepAwake component mounted');
```

**Check 2: Verify ActiveRideScreen is mounted**

```bash
# Job status must be STARTED
# Check JobContext: status === 'STARTED'
```

**Check 3: Android Battery Optimization**

```
Settings → Battery → App Battery Usage → TaxiTime Driver → Unrestricted
```

**Check 4: Developer Options**

```
Settings → Developer Options → Stay Awake (should be OFF - our app handles this)
```

### Screen TOO Bright?

**Solution: Adjust Auto-Brightness**

```
Settings → Display → Adaptive Brightness → ON
(Screen will dim slightly but not turn off)
```

---

## 🎉 DEPLOYMENT:

### Steps to Deploy:

1. **Install Dependencies:**

   ```bash
   cd /Applications/A_B_TAXI/mobile/driver-app-v1
   npm install  # Already done ✅
   ```

2. **Clean Build (IMPORTANT):**

   ```bash
   cd android
   ./gradlew clean
   cd ..
   ```

3. **Rebuild Android App:**

   ```bash
   npx react-native run-android
   ```

4. **Test on Device:**
   - Start shift → Accept job → Start meter
   - Wait 2+ minutes
   - Screen should stay ON ✅

---

## ✅ STATUS:

- [x] Package installed: `react-native-keep-awake@4.0.0`
- [x] Component imported in `ActiveRideScreen.tsx`
- [x] `<KeepAwake />` added to render tree
- [x] Documentation created
- [ ] **PENDING:** Clean build (`cd android && ./gradlew clean`)
- [ ] **PENDING:** Rebuild app (`npx react-native run-android`)
- [ ] **PENDING:** Test on device with 2+ minute active ride

---

## 📚 RELATED FEATURES:

### Other Wake Lock Implementations in App:

1. **ForegroundService** (`/android/app/src/main/java/com/taxitime/driverv1/ForegroundService.java`)
   - PARTIAL_WAKE_LOCK for CPU
   - Active during entire shift
   - Documented in: `FOREGROUND_SERVICE_COMPLETE_FIX.md`

2. **LocationTrackingService** (`/android/app/src/main/java/com/taxitime/driverv1/location/LocationTrackingService.java`)
   - GPS wake lock
   - Active during shift
   - Ensures location updates continue

3. **KeepAwake** (`ActiveRideScreen.tsx` - NEWLY ADDED)
   - Screen wake lock
   - Active only during rides
   - THIS IMPLEMENTATION

---

## 🎯 SUMMARY:

The app now uses **THREE wake locks** to ensure it NEVER sleeps when needed:

| Wake Lock           | Purpose          | Active When          | File                         |
| ------------------- | ---------------- | -------------------- | ---------------------------- |
| PARTIAL_WAKE_LOCK   | CPU stays awake  | Shift active         | ForegroundService.java       |
| GPS Wake Lock       | Location updates | Shift active         | LocationTrackingService.java |
| FLAG_KEEP_SCREEN_ON | Screen stays on  | **Ride in progress** | **ActiveRideScreen.tsx** ✅  |

**Result:** Professional, reliable taxi meter experience with no screen sleep interruptions! 🎉
