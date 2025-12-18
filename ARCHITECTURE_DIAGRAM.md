# TaxiTime Driver App - Architecture Diagram

## 📱 Application Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DRIVER APP v1                                       │
│                         React Native 0.79 + TypeScript                           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                                    App.tsx                                         │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │                            Provider Stack                                     │  │
│  │                                                                               │  │
│  │  ErrorBoundary                                                                │  │
│  │    └─ StripeProvider                                                          │  │
│  │         └─ ThemeProvider                                                      │  │
│  │              └─ AuthProvider ─────────────────────┐                           │  │
│  │                   └─ ShiftProvider                │                           │  │
│  │                        └─ LocationProvider        │  Context Flow             │  │
│  │                             └─ ZoneProvider       │  (Top to Bottom)          │  │
│  │                                  └─ JobProvider   │                           │  │
│  │                                       └─ JobQueueProvider                     │  │
│  │                                            └─ RootNavigator                   │  │
│  └─────────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📂 Folder Structure

```
src/
├── components/          # Reusable UI components
│   ├── design/         # Design system components
│   ├── jobs/           # Job-related components
│   └── zone/           # Zone-related components
│
├── config/             # Environment & configuration
│   └── environment.ts  # API_BASE_URL, SOCKET_BASE_URL
│
├── context/            # React Context providers (State Management)
│   ├── AuthContext.tsx
│   ├── ShiftContext.tsx
│   ├── LocationContext.tsx
│   ├── ZoneContext.tsx
│   ├── JobContext.tsx
│   └── JobQueueContext.tsx
│
├── hooks/              # Custom React hooks
│   ├── useActiveJob.ts
│   ├── useDriverLocation.ts
│   ├── useEnhancedDriverStatus.ts
│   ├── usePODCapture.ts
│   ├── usePreventAppClose.ts
│   └── useStopActions.ts
│
├── native/             # Native module bridges
│   ├── locationService.ts
│   └── jobMeterService.ts
│
├── navigation/         # React Navigation setup
│   └── RootNavigator.tsx
│
├── screens/            # Screen components
│   ├── Auth/           # Login, Register
│   ├── Home/           # Main dashboard
│   ├── Jobs/           # Job management screens
│   ├── Shift/          # Tariff selection
│   └── Zone/           # Zone management
│
├── services/           # API & business logic services
│   ├── httpClient.ts   # Axios instance
│   ├── driverSocket.ts # Socket.IO client
│   ├── authService.ts
│   ├── driverService.ts
│   ├── jobProcessor.ts
│   ├── locationService.ts
│   ├── offlineQueue.ts
│   └── ...more
│
├── theme/              # Styling & theming
│   ├── colors.ts
│   └── ThemeContext.tsx
│
├── types/              # TypeScript definitions
│   ├── driver.ts
│   ├── rides.ts
│   └── tariff.ts
│
└── utils/              # Utility functions
    ├── distance.ts
    ├── permissions.ts
    └── soundNotification.ts
```

---

## 🔄 Context Dependencies & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           CONTEXT LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────┐                                                                │
│  │ AuthContext  │ ◄─── Login/Logout, Token, Driver Profile                       │
│  │              │                                                                │
│  │  Provides:   │                                                                │
│  │  • token     │                                                                │
│  │  • driver    │                                                                │
│  │  • login()   │                                                                │
│  │  • logout()  │                                                                │
│  └──────┬───────┘                                                                │
│         │                                                                        │
│         ▼                                                                        │
│  ┌──────────────┐                                                                │
│  │ ShiftContext │ ◄─── Vehicle Selection, Tariff, Active Shift                   │
│  │              │                                                                │
│  │  Provides:   │     Depends on: AuthContext (driver, companyId)                │
│  │  • vehicles  │                                                                │
│  │  • tariffs   │                                                                │
│  │  • activeShift│                                                               │
│  │  • startShift()│                                                              │
│  │  • endShift()  │                                                              │
│  └──────┬───────┘                                                                │
│         │                                                                        │
│         ▼                                                                        │
│  ┌────────────────┐                                                              │
│  │LocationContext │ ◄─── GPS Tracking, Location Updates                          │
│  │                │                                                              │
│  │  Provides:     │     Depends on: AuthContext, ShiftContext                    │
│  │  • location    │                                                              │
│  │  • tracking    │                                                              │
│  │  • startTracking()│                                                           │
│  │  • stopTracking() │                                                           │
│  └──────┬─────────┘                                                              │
│         │                                                                        │
│         ▼                                                                        │
│  ┌──────────────┐                                                                │
│  │ ZoneContext  │ ◄─── Zone Selection, Driver Assignment                         │
│  │              │                                                                │
│  │  Provides:   │     Depends on: AuthContext, LocationContext                   │
│  │  • zones     │                                                                │
│  │  • currentZone│                                                               │
│  │  • selectZone()│                                                              │
│  └──────┬───────┘                                                                │
│         │                                                                        │
│         ▼                                                                        │
│  ┌──────────────┐                                                                │
│  │ JobContext   │ ◄─── Job Management, Meter, Timer (2659 lines!)                │
│  │   (LARGE)    │                                                                │
│  │              │     Depends on: AuthContext, LocationContext, ShiftContext     │
│  │  Provides:   │                                                                │
│  │  • currentJob│                                                                │
│  │  • status    │                                                                │
│  │  • timer     │                                                                │
│  │  • acceptJob()│                                                               │
│  │  • startTrip()│                                                               │
│  │  • completeJob()│                                                             │
│  │  • pauseJob()   │                                                             │
│  └──────┬───────┘                                                                │
│         │                                                                        │
│         ▼                                                                        │
│  ┌────────────────┐                                                              │
│  │JobQueueContext │ ◄─── Nearby Jobs Queue (during active trips)                 │
│  │                │                                                              │
│  │  Provides:     │     Depends on: AuthContext, LocationContext, JobContext     │
│  │  • queuedJobs  │                                                              │
│  │  • addToQueue()│                                                              │
│  │  • removeFromQueue()│                                                         │
│  └────────────────┘                                                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 Navigation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           NAVIGATION STRUCTURE                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                         ┌─────────────────┐                                      │
│                         │  RootNavigator  │                                      │
│                         └────────┬────────┘                                      │
│                                  │                                               │
│            ┌─────────────────────┴─────────────────────┐                         │
│            │                                           │                         │
│            ▼                                           ▼                         │
│  ┌─────────────────┐                        ┌─────────────────┐                  │
│  │   AuthStack     │                        │    AppStack     │                  │
│  │ (Not Logged In) │                        │   (Logged In)   │                  │
│  └────────┬────────┘                        └────────┬────────┘                  │
│           │                                          │                           │
│     ┌─────┴─────┐                    ┌───────────────┼───────────────┐           │
│     │           │                    │               │               │           │
│     ▼           ▼                    ▼               ▼               ▼           │
│ ┌───────┐  ┌──────────┐       ┌──────────┐   ┌─────────────┐  ┌────────────┐    │
│ │ Login │  │ Register │       │   Home   │   │  JobOffer   │  │ActiveRide  │    │
│ └───────┘  └──────────┘       └──────────┘   └─────────────┘  └────────────┘    │
│                                     │                                │           │
│                                     │                                │           │
│                         ┌───────────┴───────────┐                    │           │
│                         │                       │                    │           │
│                         ▼                       ▼                    ▼           │
│                  ┌─────────────┐        ┌─────────────┐      ┌─────────────┐     │
│                  │  Tariff     │        │  JobPaused  │      │  Payment    │     │
│                  │  Selection  │        │             │      │ Collection  │     │
│                  └─────────────┘        └─────────────┘      └─────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📡 Communication Layer

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL COMMUNICATION                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                           BACKEND SERVER                                 │    │
│  │                       (localhost:3000/api)                              │    │
│  └──────────────────────────────┬──────────────────────────────────────────┘    │
│                                 │                                               │
│                    ┌────────────┴────────────┐                                  │
│                    │                         │                                  │
│                    ▼                         ▼                                  │
│  ┌─────────────────────────┐    ┌─────────────────────────┐                     │
│  │      HTTP/REST API      │    │       Socket.IO         │                     │
│  │      (httpClient.ts)    │    │    (driverSocket.ts)    │                     │
│  │                         │    │                         │                     │
│  │  • Auth endpoints       │    │  Real-time Events:      │                     │
│  │  • Driver profile       │    │  • driver:location      │                     │
│  │  • Job CRUD             │    │  • driver:status        │                     │
│  │  • Shift management     │    │  • job:new              │                     │
│  │  • Zone management      │    │  • job:progress         │                     │
│  │  • Payments             │    │  • meter:telemetry      │                     │
│  │                         │    │  • driver:kicked        │                     │
│  └─────────────────────────┘    └─────────────────────────┘                     │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                        OFFLINE SUPPORT                                   │    │
│  │                                                                          │    │
│  │  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │    │
│  │  │  offlineQueue.ts │    │offlineEventQueue │    │AsyncStorage      │   │    │
│  │  │                  │    │      .ts         │    │                  │   │    │
│  │  │  Queue HTTP      │    │  Queue Socket    │    │  Persist state   │   │    │
│  │  │  requests when   │    │  events when     │    │  across app      │   │    │
│  │  │  offline         │    │  disconnected    │    │  restarts        │   │    │
│  │  └──────────────────┘    └──────────────────┘    └──────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏠 HomeScreen State Machine

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          HOME SCREEN STATES                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│                              ┌─────────────┐                                     │
│                              │  LOADING    │                                     │
│                              │  (Initial)  │                                     │
│                              └──────┬──────┘                                     │
│                                     │                                            │
│                                     ▼                                            │
│                         ┌───────────────────────┐                                │
│                         │   NO ACTIVE SHIFT?    │                                │
│                         └───────────┬───────────┘                                │
│                                     │                                            │
│                    ┌────────────────┴────────────────┐                           │
│                    │ YES                        NO   │                           │
│                    ▼                                 ▼                           │
│         ┌─────────────────┐              ┌─────────────────┐                     │
│         │  SELECT VEHICLE │              │   SHIFT ACTIVE  │                     │
│         │  & START SHIFT  │              │                 │                     │
│         └────────┬────────┘              └────────┬────────┘                     │
│                  │                                │                              │
│                  │                                ▼                              │
│                  │                    ┌───────────────────────┐                  │
│                  │                    │    HAS ACTIVE JOB?    │                  │
│                  │                    └───────────┬───────────┘                  │
│                  │                                │                              │
│                  │               ┌────────────────┴────────────────┐             │
│                  │               │ YES                        NO   │             │
│                  │               ▼                                 ▼             │
│                  │    ┌─────────────────┐              ┌─────────────────┐       │
│                  │    │  Navigate to    │              │   AVAILABLE     │       │
│                  │    │  ActiveRide     │              │  (Waiting for   │       │
│                  │    │                 │              │   job offers)   │       │
│                  │    └─────────────────┘              └─────────────────┘       │
│                  │                                              │                │
│                  └──────────────────────────────────────────────┘                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚗 Job Lifecycle Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              JOB STATUS FLOW                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   ┌────────┐    Socket Event:     ┌──────────┐                                   │
│   │  IDLE  │ ───job:new─────────► │ INCOMING │                                   │
│   └────────┘                      └────┬─────┘                                   │
│        ▲                               │                                         │
│        │                     ┌─────────┴─────────┐                               │
│        │                     │                   │                               │
│        │               Accept│                   │Reject                         │
│        │                     ▼                   ▼                               │
│        │             ┌───────────┐        ┌───────────┐                          │
│        │             │ ACCEPTED  │        │ REJECTED  │───────────┐              │
│        │             └─────┬─────┘        └───────────┘           │              │
│        │                   │                                      │              │
│        │              Start│Navigation                            │              │
│        │                   ▼                                      │              │
│        │            ┌─────────────┐                               │              │
│        │            │ ON_THE_WAY  │                               │              │
│        │            └──────┬──────┘                               │              │
│        │                   │                                      │              │
│        │         Arrive at │Pickup                                │              │
│        │                   ▼                                      │              │
│        │             ┌───────────┐                                │              │
│        │             │  ARRIVED  │                                │              │
│        │             └─────┬─────┘                                │              │
│        │                   │                                      │              │
│        │         Start Trip│(Meter starts)                        │              │
│        │                   ▼                                      │              │
│        │             ┌───────────┐                                │              │
│        │             │  STARTED  │◄─────┐                         │              │
│        │             └─────┬─────┘      │                         │              │
│        │                   │            │ Resume                  │              │
│        │             Pause │            │                         │              │
│        │                   ▼            │                         │              │
│        │             ┌───────────┐      │                         │              │
│        │             │  PAUSED   │──────┘                         │              │
│        │             └───────────┘                                │              │
│        │                   │                                      │              │
│        │         Arrive at │Destination                           │              │
│        │                   ▼                                      │              │
│        │             ┌───────────┐                                │              │
│        │             │  REACHED  │                                │              │
│        │             └─────┬─────┘                                │              │
│        │                   │                                      │              │
│        │        Collect    │Payment                               │              │
│        │                   ▼                                      │              │
│        │          ┌────────────────┐                              │              │
│        │          │PENDING_PAYMENT │                              │              │
│        │          └───────┬────────┘                              │              │
│        │                  │                                       │              │
│        │        Payment   │Confirmed                              │              │
│        │                  ▼                                       │              │
│        │            ┌───────────┐                                 │              │
│        └────────────│ COMPLETED │◄────────────────────────────────┘              │
│                     └───────────┘                                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Services Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SERVICES LAYER                                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                         Core Services                                    │    │
│  │                                                                          │    │
│  │    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐   │    │
│  │    │ httpClient   │         │driverSocket  │         │AsyncStorage  │   │    │
│  │    │              │         │              │         │   (RN)       │   │    │
│  │    │  Axios       │         │  Socket.IO   │         │              │   │    │
│  │    │  REST API    │         │  Real-time   │         │  Persistence │   │    │
│  │    └──────┬───────┘         └──────┬───────┘         └──────┬───────┘   │    │
│  │           │                        │                        │           │    │
│  └───────────┼────────────────────────┼────────────────────────┼───────────┘    │
│              │                        │                        │                │
│              ▼                        ▼                        ▼                │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │                       Business Services                                  │    │
│  │                                                                          │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐             │    │
│  │  │  authService   │  │ driverService  │  │  zoneService   │             │    │
│  │  │                │  │                │  │                │             │    │
│  │  │ • login()      │  │ • getProfile() │  │ • getZones()   │             │    │
│  │  │ • logout()     │  │ • updateStatus │  │ • joinZone()   │             │    │
│  │  │ • register()   │  │                │  │                │             │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘             │    │
│  │                                                                          │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐             │    │
│  │  │ jobProcessor   │  │  meterService  │  │locationService │             │    │
│  │  │                │  │                │  │                │             │    │
│  │  │ • accept()     │  │ • calculate()  │  │ • startTracking│             │    │
│  │  │ • complete()   │  │ • snapshot()   │  │ • stopTracking │             │    │
│  │  │ • reject()     │  │                │  │                │             │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘             │    │
│  │                                                                          │    │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐             │    │
│  │  │foregroundSvc   │  │  appStateService│ │videoStreaming  │             │    │
│  │  │                │  │                │  │                │             │    │
│  │  │ • keepAwake()  │  │ • ACTIVE       │  │ • startStream()│             │    │
│  │  │ • notification │  │ • BACKGROUND   │  │ • stopStream() │             │    │
│  │  └────────────────┘  └────────────────┘  └────────────────┘             │    │
│  │                                                                          │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚠️ Identified Optimization Areas

### 1. **JobContext.tsx - 2659 Lines!**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        🔴 CRITICAL: JobContext is TOO LARGE                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Current State:                                                                  │
│  • 2659 lines of code in one file                                               │
│  • Handles: Job state, Timer, Meter, Pausing, Video, Tariffs                    │
│  • Multiple useState hooks causing re-renders                                    │
│  • All subscribers re-render on ANY state change                                 │
│                                                                                  │
│  Recommended Split:                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐     │
│  │ JobContext    │  │ MeterContext  │  │ TimerContext  │  │ VideoContext  │     │
│  │ (~500 lines)  │  │ (~400 lines)  │  │ (~300 lines)  │  │ (~300 lines)  │     │
│  │               │  │               │  │               │  │               │     │
│  │ • currentJob  │  │ • meterState  │  │ • elapsed     │  │ • streaming   │     │
│  │ • status      │  │ • earnings    │  │ • waiting     │  │ • startVideo  │     │
│  │ • accept/rej  │  │ • calculate   │  │ • start/stop  │  │ • stopVideo   │     │
│  └───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2. **Re-render Optimization**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           RE-RENDER ISSUES                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Current:                                                                        │
│  • Context value changes → ALL consumers re-render                              │
│  • Timer updates every second → Full tree re-render                             │
│  • Location updates → Multiple context updates                                  │
│                                                                                  │
│  Solutions:                                                                       │
│  • Split contexts by update frequency                                            │
│  • Use React.memo() on expensive components                                      │
│  • Use useMemo() for derived values                                             │
│  • Use useCallback() for stable function references                              │
│  • Consider Zustand for fine-grained subscriptions                              │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3. **Socket Event Optimization**

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SOCKET OPTIMIZATION                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Current:                                                                        │
│  • Location emitted every 5 seconds (configurable)                              │
│  • Meter telemetry sent frequently                                              │
│  • Multiple listeners registered/unregistered                                    │
│                                                                                  │
│  Solutions:                                                                       │
│  • Batch location updates                                                        │
│  • Debounce meter updates                                                        │
│  • Use refs for socket instance (avoid re-connections)                           │
│  • Implement connection pooling                                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📈 Performance Metrics to Track

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        KEY PERFORMANCE INDICATORS                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Memory:                                                                         │
│  • JS Heap size during active ride                                              │
│  • Memory growth over time (leak detection)                                      │
│                                                                                  │
│  Render Performance:                                                             │
│  • FPS during map animation                                                      │
│  • Re-render count per second                                                   │
│  • Component mount/unmount frequency                                            │
│                                                                                  │
│  Network:                                                                        │
│  • API response times                                                           │
│  • Socket latency                                                               │
│  • Offline queue size                                                           │
│                                                                                  │
│  Battery:                                                                        │
│  • GPS usage impact                                                             │
│  • Background service drain                                                      │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Optimization Priority

| Priority  | Area                      | Impact | Effort |
| --------- | ------------------------- | ------ | ------ |
| 🔴 HIGH   | Split JobContext          | High   | High   |
| 🔴 HIGH   | Memo expensive components | High   | Medium |
| 🟡 MEDIUM | Socket event batching     | Medium | Medium |
| 🟡 MEDIUM | API call deduplication    | Medium | Low    |
| 🟢 LOW    | Bundle size optimization  | Low    | High   |
| 🟢 LOW    | Image optimization        | Low    | Low    |

---

_Generated: December 17, 2025_
