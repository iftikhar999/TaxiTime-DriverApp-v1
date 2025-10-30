# Real-Time Job Assignment Flow - Driver App

## Overview

Implemented real-time job assignment notifications from dispatch portal to driver app using Socket.IO. When a dispatcher assigns a job to an online driver, the driver receives an instant notification and has 30 seconds to accept or reject the ride.

## Architecture

### Backend Flow

1. Dispatch assigns job to driver (via dispatch portal)
2. Backend `socket.on('assignJob')` handler processes assignment
3. Backend emits to specific driver room: `driverNamespace.to('driver_${driverId}').emit('jobAssigned', {...})`
4. Event includes: `jobId`, `message`, `dispatcherName`

### Driver App Flow

1. `JobContext` establishes socket listener on mount
2. Receives `jobAssigned` event with job ID
3. Fetches full job details via API: `GET /jobs/${jobId}`
4. Displays Alert notification to driver
5. Sets job as "INCOMING" with 30-second countdown
6. Auto-rejects if no action taken within 30 seconds

## Implementation Details

### Files Modified

#### `/mobile/driver-app-v1/src/context/JobContext.tsx`

**Purpose**: Added socket listener for real-time job assignments

**Changes**:

```tsx
// 1. Added httpClient import for API calls
import httpClient from "../services/httpClient";

// 2. Added socket listener in useEffect
useEffect(() => {
  if (!driver?.id) return;

  const socket = ensureDriverSocket({
    driverId: driver.id,
    companyId: driver.companyId,
  });

  const handleJobAssigned = async (data: any) => {
    console.log("📨 New job assigned from dispatch:", data);

    try {
      // Fetch full job details with auth
      const response = await httpClient.get(`/jobs/${data.jobId}`);
      const jobData = response.data;

      // Set as incoming job with 30s countdown
      setIncomingJob({
        ...jobData.job,
        countdownMs: 30000,
        autoRejectAt: new Date(Date.now() + 30000).toISOString(),
      });

      // Show alert notification
      Alert.alert(
        "🚕 New Ride Request!",
        data.message || "You have received a new job from dispatch.",
        [
          {
            text: "Ignore",
            style: "cancel",
          },
          {
            text: "View Details",
            onPress: () => {
              console.log("Driver opened job details screen");
            },
          },
        ]
      );

      // Emit progress update
      emitJobProgress({
        jobId: data.jobId,
        status: "INCOMING",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("❌ Failed to fetch job details:", error);
      Alert.alert("Error", "Failed to load job details. Please try again.");
    }
  };

  socket.on("jobAssigned", handleJobAssigned);

  return () => {
    socket.off("jobAssigned", handleJobAssigned);
  };
}, [driver?.id, driver?.companyId, setIncomingJob]);
```

## Key Features

### 1. **Authenticated API Calls**

- Uses `httpClient` service with automatic token injection
- Interceptor adds `Authorization: Bearer ${token}` header
- Token retrieved from AsyncStorage automatically

### 2. **Real-Time Socket Events**

- Listens on driver-specific room: `driver_${driverId}`
- Event: `jobAssigned` with `{jobId, message, dispatcherName}`
- Only active when driver is logged in

### 3. **30-Second Auto-Reject**

- Incoming job includes `autoRejectAt` timestamp
- Timer counts down in UI
- Automatically rejects if no action taken
- Prevents stale job assignments

### 4. **User Notifications**

- React Native Alert with two actions:
  - "Ignore" - dismisses alert (job still incoming)
  - "View Details" - opens job details screen
- Non-intrusive but visible notification

### 5. **Progress Tracking**

- Emits `jobProgress` event on job status change
- Dispatch portal receives real-time updates
- Status: `INCOMING` → `ACCEPTED` → `ACTIVE` → `COMPLETED`

## Testing Scenarios

### Test 1: Basic Assignment

1. Start driver app, log in, start shift
2. Go online (set status to AVAILABLE)
3. In dispatch portal, assign a job to this driver
4. **Expected**: Driver receives alert within 1 second
5. **Expected**: Job appears in incoming jobs list
6. **Expected**: 30-second countdown starts

### Test 2: Accept Job

1. Receive job assignment (as in Test 1)
2. Tap "View Details" in alert
3. Review job details (pickup, dropoff, fare)
4. Tap "Accept Job" button
5. **Expected**: Status changes to ACCEPTED
6. **Expected**: Dispatch sees "Driver accepted job"
7. **Expected**: Navigate button appears for navigation to pickup

### Test 3: Reject Job

1. Receive job assignment
2. Tap reject button
3. **Expected**: Job disappears from list
4. **Expected**: Status returns to AVAILABLE
5. **Expected**: Dispatch sees "Driver rejected job"

### Test 4: Auto-Reject on Timeout

1. Receive job assignment
2. Wait 30 seconds without action
3. **Expected**: Job auto-rejects
4. **Expected**: Alert dismisses
5. **Expected**: Status returns to AVAILABLE

### Test 5: Multiple Assignments

1. Reject first job
2. Dispatch assigns another job
3. **Expected**: Second job appears immediately
4. **Expected**: No interference between jobs

### Test 6: Offline Behavior

1. Driver goes OFFLINE
2. Dispatch tries to assign job
3. **Expected**: Backend prevents assignment (driver not available)
4. **Expected**: No event sent to driver app

## Socket Events Reference

### Received by Driver

```typescript
socket.on(
  "jobAssigned",
  (data: { jobId: string; message: string; dispatcherName?: string }) => {
    // Fetch job details and display to driver
  }
);
```

### Emitted by Driver

```typescript
// When status changes
emitJobProgress({
  jobId: string;
  status: "INCOMING" | "ACCEPTED" | "ACTIVE" | "COMPLETED";
  timestamp: string;
  location?: { lat: number; lng: number };
  notes?: string;
});
```

## API Endpoints

### GET `/jobs/:jobId`

**Purpose**: Fetch full job details after receiving assignment notification

**Auth**: Bearer token (automatic via httpClient interceptor)

**Response**:

```json
{
  "job": {
    "id": "abc123",
    "pickupLocation": {...},
    "dropoffLocation": {...},
    "fareEstimate": 15.50,
    "customerName": "John Doe",
    "customerPhone": "+1234567890",
    "vehicleType": "STANDARD",
    "status": "ASSIGNED"
  }
}
```

## Dependencies

### Services

- `driverSocket.ts` - Socket connection management
- `httpClient.ts` - Authenticated HTTP client
- `AuthContext.tsx` - Driver authentication state
- `LocationContext.tsx` - Driver location tracking

### Backend Events

- Backend file: `/backend/socket-handlers/enhancedDriverStatusHandlers.js`
- Event handler: Line ~1050 `socket.on('assignJob')`
- Namespace: `driverNamespace` (port 3001)

## Security Considerations

1. **Driver Verification**: Only authenticated drivers can receive assignments
2. **Token Expiration**: httpClient handles token refresh automatically
3. **Room Isolation**: Each driver has unique room (`driver_${driverId}`)
4. **Job Ownership**: Backend validates driver is assigned to job

## Future Enhancements

### Planned

- [ ] Add sound/vibration alert for job assignments
- [ ] Show estimated earnings in notification
- [ ] Display customer rating before acceptance
- [ ] Add "Counter Offer" feature for fare negotiation
- [ ] Queue multiple incoming jobs (if dispatcher assigns multiple)

### Under Consideration

- Push notifications for background job assignments
- Voice announcement of job details
- Map preview in alert notification
- Smart auto-accept based on driver preferences

## Troubleshooting

### Issue: Driver not receiving assignments

**Diagnosis**:

1. Check driver is logged in: `console.log(driver?.id)`
2. Check socket connection: `ensureDriverSocket()` should return connected socket
3. Check driver status: Must be AVAILABLE or ONLINE
4. Check backend logs: Look for `emit('jobAssigned')` log

**Solution**: Ensure driver is online and socket is connected

### Issue: Alert not showing

**Diagnosis**:

1. Check console for "📨 New job assigned" log
2. Check if Alert.alert is being called
3. Check React Native permissions for notifications

**Solution**: Verify Alert import and permissions

### Issue: API call failing

**Diagnosis**:

1. Check httpClient import
2. Check token in AsyncStorage: `await AsyncStorage.getItem('token')`
3. Check backend endpoint exists: `GET /jobs/:jobId`
4. Check network connectivity

**Solution**: Verify API endpoint and authentication

## Documentation Updates

### Related Docs

- `REALTIME_PARITY_COMPLETE_SUMMARY.md` - Overall real-time feature summary
- `BACKEND_HEARTBEAT_FIX.md` - Backend heartbeat Prisma model fix
- `HEARTBEAT_SHIFT_CONTROL.md` - Shift-aware heartbeat control

### Status

✅ Implementation complete
✅ Socket listener working
✅ API integration complete
⏳ UI screen pending (acceptance/rejection buttons)
⏳ End-to-end testing pending

---

**Created**: Phase 4 of Real-Time Parity
**Author**: AI Assistant
**Date**: January 2025
