# 🔄 Clear Cache and Rebuild - Driver App

## Quick Guide to See Your Changes

If you're still seeing the old map with dropoff markers before the ride starts, follow these steps:

---

## 🚀 Quick Fix (Try This First)

### Step 1: Stop Metro Bundler
Press `Ctrl + C` in the terminal where Metro is running

### Step 2: Clear Metro Cache
```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npx react-native start --reset-cache
```

### Step 3: Rebuild App
In a **new terminal**:

**For iOS:**
```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npx react-native run-ios
```

**For Android:**
```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npx react-native run-android
```

---

## 🔧 Deep Clean (If Quick Fix Doesn't Work)

### For iOS:

```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1

# 1. Stop Metro
# Press Ctrl+C

# 2. Clean iOS build
cd ios
rm -rf build
rm -rf Pods
rm -rf ~/Library/Developer/Xcode/DerivedData/*
pod install
cd ..

# 3. Clear Metro cache
rm -rf node_modules/.cache
npx react-native start --reset-cache &

# 4. Rebuild
npx react-native run-ios
```

### For Android:

```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1

# 1. Stop Metro
# Press Ctrl+C

# 2. Clean Android build
cd android
./gradlew clean
cd ..

# 3. Clear app data
adb shell pm clear com.taxitime.driverv1

# 4. Clear Metro cache
rm -rf node_modules/.cache
npx react-native start --reset-cache &

# 5. Rebuild
npx react-native run-android
```

---

## 📱 Manual App Reset

### iOS Simulator:
1. Open Simulator
2. Go to Device → Erase All Content and Settings
3. Or: Long press app icon → Remove App → Delete App
4. Rebuild: `npx react-native run-ios`

### Android Emulator:
1. Open Settings on emulator
2. Apps → TaxiTime Driver → Storage → Clear Data
3. Or: `adb shell pm clear com.taxitime.driverv1`
4. Rebuild: `npx react-native run-android`

### Physical Device:
1. Delete the app
2. Rebuild and reinstall

---

## ✅ Verification

After rebuilding, test the flow:

### Test 1: Job Acceptance
1. Accept a job
2. **Expected:** Map shows ONLY pickup (green) + driver (yellow/blue)
3. **Not Expected:** Red dropoff marker should NOT be visible

### Test 2: On The Way
1. Tap "Proceed to Pickup"
2. **Expected:** Map still shows only pickup + driver
3. **Not Expected:** Dropoff should NOT appear yet

### Test 3: Arrived
1. Arrive at pickup
2. **Expected:** Map still shows only pickup + driver
3. **Not Expected:** Dropoff should NOT appear yet

### Test 4: Ride Started ✨
1. Tap "Start Ride"
2. **Expected:** Map NOW shows pickup + dropoff + driver
3. **Success:** This is when dropoff SHOULD appear!

---

## 🐛 Still Not Working?

### Check Console Logs
1. Open Metro bundler terminal
2. Look for errors or warnings
3. Check if `showDropoffOnMap` is logging correct values

### Add Debug Logging
Add this to `JobProgressScreen.tsx` after line 271:

```typescript
console.log('🗺️ Map Debug:', {
  status,
  showDropoffOnMap,
  hasPickup: !!pickupCoordinate,
  hasDropoff: !!dropoffCoordinate,
  hasDriver: !!driverCoordinate
});
```

### Check Job Status
Make sure the job status is being set correctly:
- ASSIGNED → Map shows pickup only ✅
- ACCEPTED → Map shows pickup only ✅
- ON_THE_WAY → Map shows pickup only ✅
- ARRIVED → Map shows pickup only ✅
- STARTED → Map shows pickup + dropoff ✅

---

## 📞 Common Issues

### Issue 1: "Map still shows dropoff before START"
**Solution:** 
- Clear cache: `npx react-native start --reset-cache`
- Delete app and reinstall
- Verify status in console logs

### Issue 2: "Map shows no markers at all"
**Solution:**
- Check location permissions
- Verify GPS is enabled
- Check console for coordinate validation errors

### Issue 3: "Changes not reflecting"
**Solution:**
- Make sure you saved all files
- Stop and restart Metro bundler
- Clear watchman cache: `watchman watch-del-all`

### Issue 4: "Build errors after clearing cache"
**Solution:**
```bash
# Clear everything and start fresh
rm -rf node_modules
npm install
cd ios && pod install && cd ..
npx react-native start --reset-cache
```

---

## 🎯 Expected Behavior Summary

| Job Status | Dropoff Marker Visible? | Why? |
|------------|------------------------|------|
| ASSIGNED | ❌ NO | Driver going to pickup |
| ACCEPTED | ❌ NO | Driver going to pickup |
| ON_THE_WAY | ❌ NO | Driver going to pickup |
| ARRIVED | ❌ NO | Driver at pickup, waiting |
| **STARTED** | ✅ **YES** | **Ride started, going to dropoff** |
| ACTIVE | ✅ YES | Ride in progress |
| REACHED | ✅ YES | Reached destination |
| COMPLETED | ✅ YES | Showing full route history |

---

## 💡 Pro Tips

### 1. Always Clear Cache After Big Changes
```bash
npx react-native start --reset-cache
```

### 2. Use Debug Mode
Enable React Native debugger to see console logs:
- iOS: Cmd+D → Toggle Inspector
- Android: Cmd+M → Toggle Inspector

### 3. Check File Timestamps
Make sure your editor saved the files:
```bash
ls -la src/screens/Jobs/*.tsx
```

### 4. Verify Git Changes
```bash
git status
git diff src/screens/Jobs/JobProgressScreen.tsx
```

---

## 📋 Quick Command Reference

```bash
# Clear Metro cache
npx react-native start --reset-cache

# Clear watchman
watchman watch-del-all

# Clear Android app data
adb shell pm clear com.taxitime.driverv1

# iOS clean build
cd ios && rm -rf build && pod install && cd ..

# Android clean build
cd android && ./gradlew clean && cd ..

# Rebuild iOS
npx react-native run-ios

# Rebuild Android
npx react-native run-android

# Clear all node modules
rm -rf node_modules && npm install
```

---

## ✅ Success Indicators

You'll know it's working when:

1. ✅ Job acceptance screen shows only pickup + driver
2. ✅ Dropoff marker is NOT visible until ride STARTS
3. ✅ After tapping "Start Ride", dropoff marker appears
4. ✅ Map transitions smoothly between states
5. ✅ No console errors or warnings

---

Good luck! The changes are in place, you just need to clear the cache and rebuild. 🚀

