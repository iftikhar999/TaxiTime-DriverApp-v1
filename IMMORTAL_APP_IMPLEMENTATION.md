# 🔥 IMMORTAL APP - NEVER DIES, NEVER FORGETS

## 🎯 **OBJECTIVE**

This app will be a **ZOMBIE** - it never dies, always runs, always tracks, always ready.

**Rules:**
1. ✅ App NEVER closes when shift is active
2. ✅ If killed, it auto-restarts IMMEDIATELY
3. ✅ If swiped away, keeps running in background
4. ✅ Location always tracked, always sent to dispatcher
5. ✅ When job assigned, app wakes up INSTANTLY
6. ✅ When reopened, restores EXACT last state
7. ✅ NEVER shows "Select Vehicle" screen if shift was active

---

## 🛠️ **IMPLEMENTATION COMPONENTS**

### **1. Android Foreground Service** 🔴
**Purpose**: Keeps app alive 24/7 with persistent notification

**Features:**
- Runs continuously when shift is active
- Shows persistent notification: "🚕 On Shift - Receiving Jobs"
- Cannot be swiped away or killed by Android
- Automatically restarts if killed
- Tracks location in background
- Sends heartbeat to server every 5 seconds

**Files to Create:**
```
android/app/src/main/java/com/taxitime/driverv1/
├── ForegroundService.java          # Main foreground service
├── RestartServiceBroadcast.java    # Auto-restart receiver
└── BootReceiver.java                # Start on device boot
```

---

### **2. Push Notifications (FCM)** 📲
**Purpose**: Wake up app INSTANTLY when job assigned

**Features:**
- Server sends FCM push when job assigned
- App wakes up even if fully closed
- Immediately shows job acceptance screen
- Plays loud notification sound
- Vibrates device
- Shows heads-up notification

**Files to Create:**
```
src/services/
├── pushNotifications.ts     # FCM setup
└── jobNotificationHandler.ts # Handle incoming jobs
```

---

### **3. Work Manager** ⚙️
**Purpose**: Periodic background tasks even if app killed

**Features:**
- Runs every 15 minutes to check if app should be alive
- If shift is active and app killed, restarts it
- Sends location update if main app not responding
- Syncs offline queue

**Files to Create:**
```
android/app/src/main/java/com/taxitime/driverv1/
└── KeepAliveWorker.java
```

---

### **4. State Persistence** 💾
**Purpose**: NEVER lose state - restore exactly where driver left off

**What Gets Saved:**
- ✅ Active shift data
- ✅ Current job (if any)
- ✅ Job status (ON_THE_WAY, ARRIVED, STARTED, etc.)
- ✅ Selected vehicle
- ✅ Selected tariff
- ✅ Driver location
- ✅ Route coordinates
- ✅ Timer data (distance, waiting time, elapsed time)
- ✅ Pricing breakdown
- ✅ Navigation state

**When Saved:**
- On every state change
- Every 5 seconds during active job
- Before app goes to background
- When app is about to be killed

**Files to Update:**
```
src/context/
├── ShiftContext.tsx     # Persist shift
├── JobContext.tsx       # Persist job state
└── LocationContext.tsx  # Persist location
```

---

### **5. Boot Receiver** 🚀
**Purpose**: Auto-start app when device reboots

**Features:**
- Listens for device boot
- If shift was active before shutdown, restarts app
- Starts foreground service automatically
- Restores last state

---

### **6. Task Killer Protection** 🛡️
**Purpose**: Detect when app is killed and restart immediately

**Features:**
- Broadcast receiver for app kill events
- Restarts foreground service within 1 second
- Reconnects socket
- Resumes location tracking

---

### **7. Battery Optimization Bypass** 🔋
**Purpose**: Prevent Android from killing app to save battery

**Features:**
- Request battery optimization exemption
- Add app to battery whitelist
- Prevent doze mode from stopping app

---

### **8. Overlay Permission** 🎭
**Purpose**: Show job screen on top of any app

**Features:**
- When job assigned, show job acceptance screen OVER any app
- Driver doesn't need to manually open app
- Immediate visibility

---

## 📦 **REQUIRED PERMISSIONS**

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- ✅ Foreground Service (REQUIRED) -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />

<!-- ✅ Background Location (REQUIRED) -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- ✅ Auto-Start & Keep Alive (REQUIRED) -->
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

<!-- ✅ Overlay (Show job over other apps) -->
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />

<!-- ✅ Push Notifications -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- ✅ Network & Internet -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

<!-- ✅ Vibration & Sound -->
<uses-permission android:name="android.permission.VIBRATE" />

<!-- ✅ Android 12+ Exact Alarms -->
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
```

---

## 🎯 **USER FLOW**

### **Scenario 1: Normal Shift**
```
1. Driver starts shift
   ↓
2. Foreground service starts
   ↓
3. Persistent notification appears: "🚕 On Shift"
   ↓
4. Location tracked every 5 seconds
   ↓
5. Heartbeat sent to server every 5 seconds
   ↓
6. Job assigned → FCM push received
   ↓
7. App shows job screen INSTANTLY (even over other apps)
   ↓
8. Driver accepts job
   ↓
9. All job progress saved continuously
   ↓
10. Job completed → Shift continues
```

### **Scenario 2: App Swiped Away**
```
1. Driver swipes app away
   ↓
2. Main UI closes BUT...
   ↓
3. ✅ Foreground service KEEPS RUNNING
   ↓
4. ✅ Location still tracked
   ↓
5. ✅ Socket still connected
   ↓
6. ✅ Notification still visible
   ↓
7. Job assigned → FCM push
   ↓
8. ✅ App relaunches AUTOMATICALLY
   ↓
9. ✅ Shows job acceptance screen
```

### **Scenario 3: App Killed by System**
```
1. Android kills app (low memory)
   ↓
2. ⚡ RestartServiceBroadcast triggered
   ↓
3. ✅ Foreground service restarts within 1 second
   ↓
4. ✅ State loaded from AsyncStorage
   ↓
5. ✅ Socket reconnects
   ↓
6. ✅ Location tracking resumes
   ↓
7. ✅ Driver sees EXACT same state they left
```

### **Scenario 4: Device Reboots**
```
1. Device shuts down
   ↓
2. Device boots up
   ↓
3. ✅ BootReceiver triggered
   ↓
4. ✅ Checks for active shift in storage
   ↓
5. If shift active:
   ✅ Starts foreground service
   ✅ Restores shift state
   ✅ Reconnects socket
   ✅ Resumes location tracking
   ✅ Driver sees dashboard (NOT vehicle selection)
```

### **Scenario 5: Active Job, App Closed**
```
1. Driver has active job (ON_THE_WAY)
   ↓
2. App accidentally closed
   ↓
3. Driver reopens app
   ↓
4. ✅ App reads last state from storage
   ↓
5. ✅ Sees: JobProgressScreen with status "ON_THE_WAY"
   ↓
6. ✅ Timer continues from where it left off
   ↓
7. ✅ Route still displayed
   ↓
8. ✅ All job data intact
   ↓
9. ❌ NEVER shows "Select Vehicle" screen
```

---

## 🔥 **STATE RESTORATION LOGIC**

### **Priority 1: Active Job**
```typescript
if (activeJob exists in storage) {
  → Navigate to JobProgressScreen
  → Restore job status
  → Resume timer
  → Reconnect socket for job updates
}
```

### **Priority 2: Active Shift**
```typescript
else if (activeShift exists in storage) {
  → Show Dashboard (HomeScreen)
  → Display shift info
  → Show available jobs
  → Ready to receive new jobs
}
```

### **Priority 3: No Active Shift**
```typescript
else {
  → Show Vehicle Selection
  → Driver can start new shift
}
```

---

## 📱 **PERSISTENT NOTIFICATION**

When shift is active, notification shows:

```
🚕 AB Taxi - On Shift
───────────────────────
Status: Available
Duration: 2h 34m
Trips: 5
Earnings: $127.50
───────────────────────
[End Shift]  [View Dashboard]
```

**Features:**
- Cannot be dismissed (except by ending shift)
- Shows real-time stats
- Quick actions to end shift or view dashboard
- Tapping opens app to dashboard

---

## 🚨 **CRITICAL IMPLEMENTATION DETAILS**

### **1. Foreground Service MUST Show Notification**
```java
// Required by Android
Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
    .setContentTitle("🚕 AB Taxi - On Shift")
    .setContentText("Status: Available - Earning: $127.50")
    .setSmallIcon(R.drawable.ic_taxi)
    .setPriority(NotificationCompat.PRIORITY_HIGH)
    .setOngoing(true) // Cannot be dismissed
    .build();

startForeground(NOTIFICATION_ID, notification);
```

### **2. Service Auto-Restart**
```java
@Override
public int onStartCommand(Intent intent, int flags, int startId) {
    // ...
    return START_STICKY; // Auto-restart if killed
}
```

### **3. State Save Strategy**
```typescript
// Save state every 5 seconds during active job
setInterval(() => {
  if (currentJob) {
    await AsyncStorage.multiSet([
      ['activeJob', JSON.stringify(currentJob)],
      ['jobStatus', status],
      ['jobTimer', JSON.stringify(timer)],
      ['routePoints', JSON.stringify(routePoints)],
      ['pricingBreakdown', JSON.stringify(pricingBreakdown)],
    ]);
  }
}, 5000);
```

### **4. FCM Message Handling**
```typescript
messaging().onMessage(async remoteMessage => {
  if (remoteMessage.data?.type === 'JOB_ASSIGNED') {
    // Wake up app
    await notifee.displayNotification({
      title: '🚕 New Job Assignment',
      body: 'Pickup in 2.5 km - $15.00 estimated',
      android: {
        channelId: 'job-assignments',
        importance: AndroidImportance.HIGH,
        pressAction: {
          id: 'job-assignment',
          launchActivity: 'JobOfferScreen',
        },
        sound: 'job_notification',
        vibrationPattern: [300, 500, 300, 500],
      },
    });
    
    // Show overlay if permission granted
    if (hasOverlayPermission) {
      showJobOverlay(remoteMessage.data);
    }
  }
});
```

---

## 🎯 **PACKAGES REQUIRED**

```bash
# Foreground Service & Notifications
yarn add @notifee/react-native

# Push Notifications
yarn add @react-native-firebase/app
yarn add @react-native-firebase/messaging

# Background Tasks
yarn add react-native-background-actions

# State Management (already have AsyncStorage)
# (Already installed)

# Permissions
yarn add react-native-permissions
```

---

## 📂 **FILE STRUCTURE**

```
mobile/driver-app-v1/
├── android/app/src/main/
│   ├── AndroidManifest.xml                    # ✅ Permissions & Service declarations
│   └── java/com/taxitime/driverv1/
│       ├── ForegroundService.java             # ✅ Main immortal service
│       ├── RestartServiceBroadcast.java       # ✅ Auto-restart
│       ├── BootReceiver.java                  # ✅ Boot listener
│       └── KeepAliveWorker.java               # ✅ Background worker
│
├── src/
│   ├── services/
│   │   ├── foregroundService.ts               # ✅ Control native service
│   │   ├── pushNotifications.ts               # ✅ FCM setup
│   │   ├── jobNotificationHandler.ts          # ✅ Handle job push
│   │   └── stateRestoration.ts                # ✅ Restore app state
│   │
│   ├── context/
│   │   ├── ShiftContext.tsx                   # ✅ Enhanced persistence
│   │   ├── JobContext.tsx                     # ✅ Enhanced persistence
│   │   └── LocationContext.tsx                # ✅ Enhanced persistence
│   │
│   └── navigation/
│       └── RootNavigator.tsx                  # ✅ State-aware routing
│
└── package.json                               # ✅ Updated dependencies
```

---

## ⚡ **IMPLEMENTATION PRIORITY**

### **Phase 1: Foundation** (Day 1-2)
1. ✅ Install required packages
2. ✅ Add Android permissions to manifest
3. ✅ Create ForegroundService.java
4. ✅ Create notification channel
5. ✅ Test: Service starts and shows notification

### **Phase 2: Persistence** (Day 2-3)
6. ✅ Enhanced state persistence in all contexts
7. ✅ Create stateRestoration.ts service
8. ✅ Update RootNavigator to restore state
9. ✅ Test: Close app, reopen, see exact state

### **Phase 3: Auto-Restart** (Day 3-4)
10. ✅ Create RestartServiceBroadcast.java
11. ✅ Create BootReceiver.java
12. ✅ Test: Kill app, see it restart
13. ✅ Test: Reboot device, see app auto-start

### **Phase 4: Push Notifications** (Day 4-5)
14. ✅ Setup FCM
15. ✅ Create jobNotificationHandler.ts
16. ✅ Test: Send job from dispatcher, see instant notification
17. ✅ Test: App closed, push received, app wakes up

### **Phase 5: Polish** (Day 5-6)
18. ✅ Battery optimization bypass flow
19. ✅ Overlay permission flow
20. ✅ Keep-alive worker for redundancy
21. ✅ End-to-end testing

---

## 🧪 **TESTING SCENARIOS**

### **Test 1: Basic Foreground Service**
- [ ] Start shift
- [ ] See persistent notification
- [ ] Minimize app
- [ ] Notification still visible
- [ ] Open notification tray, tap notification
- [ ] App opens to dashboard

### **Test 2: Swipe Away**
- [ ] Start shift
- [ ] Swipe app away from recent apps
- [ ] Check notification - still visible
- [ ] Send job from dispatcher
- [ ] App automatically opens
- [ ] Job screen shown

### **Test 3: Force Kill**
- [ ] Start shift
- [ ] Force stop app from Settings
- [ ] Wait 2 seconds
- [ ] App automatically restarts
- [ ] Shift still active
- [ ] Dashboard shown (NOT vehicle selection)

### **Test 4: Device Reboot**
- [ ] Start shift
- [ ] Reboot device
- [ ] After boot, app automatically starts
- [ ] Shift still active
- [ ] Dashboard shown

### **Test 5: Active Job State**
- [ ] Accept a job
- [ ] Change status to "ON_THE_WAY"
- [ ] Close app completely
- [ ] Reopen app
- [ ] JobProgressScreen shown with "ON_THE_WAY" status
- [ ] Timer continues from where it left off
- [ ] Route still displayed

### **Test 6: Background Location**
- [ ] Start shift
- [ ] Minimize app
- [ ] Open another app
- [ ] Wait 1 minute
- [ ] Check dispatcher - see driver location updating every 5 seconds

---

## 🎯 **SUCCESS CRITERIA**

✅ **App Never Dies:**
- Service runs continuously when shift active
- Automatically restarts if killed
- Survives device reboot

✅ **State Never Lost:**
- Active job state persists across app restarts
- Never shows vehicle selection if shift was active
- Timer, route, pricing all restored perfectly

✅ **Instant Job Delivery:**
- FCM push wakes app within 1 second
- Job screen shown immediately
- Loud sound + vibration

✅ **Always Tracking:**
- Location sent every 5 seconds
- Works even when app minimized
- Heartbeat confirms "I'm still here"

---

## 🔥 **FINAL NOTES**

This is the **NUCLEAR OPTION**. The app will be:
- ☠️ **UNKILLABLE** - Restarts automatically if killed
- 🧟 **ZOMBIE MODE** - Survives everything
- 📍 **ALWAYS TRACKING** - Location never stops
- 💾 **PERFECT MEMORY** - Never forgets state
- ⚡ **INSTANT WAKE** - Jobs delivered in <1 second

**The driver will never miss a job. The app will never reset. The dispatcher will always know where the driver is.**

**End of story.** 🎯

