# ✅ Real Job Flow Implementation - Available Jobs Nearby

## Overview
The "Available Jobs Nearby" section now creates **REAL jobs** that go through the complete job lifecycle, from claim to payment collection.

## Complete Job Lifecycle

### 1. **Job Discovery** (`UNASSIGNED`/`PENDING`)
- Driver sees available jobs in their zone on the HomeScreen
- Jobs are fetched from `/api/mobile/driver/jobs/upcoming` 
- Real-time updates via Socket.IO `job:available:nearby` event
- Shows distance, pickup/dropoff, estimated fare

### 2. **Claim Job** (`UNASSIGNED` → `OFFERED`)
**Frontend:**
```typescript
// HomeScreen.tsx - Driver taps "Start Ride" on an available job
const handleClaimUpcomingJob = async (jobId: string) => {
  const result = await claimUpcomingJob(jobId);
  setIncomingJob(result.job); // Sets job as INCOMING in JobContext
};
```

**Backend:**
```javascript
// /api/mobile/driver/jobs/:jobId/claim
jobService.claimJob(jobId, driverId, io)
  → Creates Assignment record (status: OFFERED)
  → Creates Offer record (with expiry timer)
  → Updates Job status to OFFERED
  → Updates Job.assignedDriverId
  → Notifies driver via Socket.IO
  → Notifies dispatch portal
```

**Database Changes:**
- `Job`: `status = 'OFFERED'`, `assignedDriverId = driver.id`
- `Assignment`: Created with `status = 'OFFERED'`
- `Offer`: Created with `status = 'SENT'`, `expiresAt`

### 3. **Accept Job** (`OFFERED` → `ACCEPTED` → `ON_THE_WAY`)
**Frontend:**
```typescript
// JobOfferScreen.tsx or JobProgressScreen.tsx
acceptJob() → emits socket event + updates status
```

**Backend:**
- Driver acceptance emitted via Socket.IO
- Assignment updated to `ACCEPTED`
- Job status updated to `ACCEPTED`
- Dispatch notified in real-time

### 4. **Navigate to Pickup** (`ON_THE_WAY`)
- Driver presses "Proceed to Pickup"
- Real-time location tracking starts
- Route displayed on map
- Auto-arrival when within 500m

### 5. **Arrive at Pickup** (`ARRIVED`)
- Manual: Driver presses "Mark Arrived"
- Auto: Triggered when within 500m of pickup
- Options: "Start Ride" or "No Show"

### 6. **Start Ride** (`STARTED`/`ACTIVE`)
- Driver picks up passenger
- Meter starts running (time + distance tracking)
- Real-time telemetry sent to backend
- Socket.IO: `meter:telemetry` events

### 7. **Complete Ride** (`STARTED` → `COMPLETED`)
**Frontend:**
```typescript
// JobProgressScreen.tsx
const handleComplete = () => {
  updateStatus('COMPLETED');
  navigation.navigate('PaymentCollection', {
    jobId: currentJob.id,
    amount: actualFare || estimatedFare,
    customerId: passenger.id,
    customerName: passenger.name,
    driverId: driver.id,
  });
};
```

**Backend (Automatic):**
```javascript
// jobService.handleJobCompleted(job)
await prisma.payment.create({
  jobId,
  tripId,
  customerId,
  driverId,
  companyId,
  amount: job.estimatedPrice,
  paymentMethod: job.paymentMethod || 'CASH',
  status: 'PENDING',
});
```

### 8. **Collect Payment** (`COMPLETED` → Payment Collection)
**Payment Screen Features:**
- Select payment method: Cash, Card, Wallet, UPI, Bank Transfer
- Displays total amount
- Shows customer name
- Confirms payment collection

**Frontend:**
```typescript
// PaymentCollectionScreen.tsx
await httpClient.post('/mobile/driver/jobs/payment', {
  jobId,
  amount,
  paymentMethod,
  customerId,
  driverId,
  status: 'COMPLETED',
  collectedAt: new Date(),
});
```

**Backend:**
```javascript
// POST /api/mobile/driver/jobs/payment
1. Verify job belongs to driver
2. Calculate commission split:
   - Company: 20% (configurable)
   - Driver: 80%
3. Create Payment record:
   - amount: total fare
   - driverEarnings: 80%
   - fees (commission): 20%
   - paymentMethod
   - status: 'COMPLETED'
4. Update Job.actualFare
5. Update Ride (Trip) payment status
```

**Database Changes:**
- `Payment`: Created with all details, earnings split, status = 'COMPLETED'
- `Job`: `actualFare = amount`, `paymentMethod = selected method`
- `Ride`: `actualFare = amount`, `paymentStatus = 'PAID'`

## Data Flow Diagram

```
Driver Sees Job → Claim Job → Job Offered → Accept
                                               ↓
Payment ← Complete Ride ← Start Ride ← Arrive ← On The Way
   ↓
Driver Earns $ + Commission Split + History Updated
```

## Real-Time Updates (Socket.IO)

### Driver Events Emitted:
- `driver:location:update` - Every 2s (configurable)
- `driver:status:update` - On AVAILABLE/BUSY/AWAY change
- `job:progress:update` - On status change
- `meter:telemetry` - During active ride (every 5s)

### Driver Events Received:
- `job_assigned` / `jobAssigned` - New job offer
- `job:available:nearby` - New unassigned job nearby
- `job_unassigned` / `jobUnassigned` - Job recalled

### Dispatch Events:
- `job:progress:updated` - Real-time job status changes
- `job:data:updated` - Complete job data updates
- Real-time map updates for driver location

## Payment API Details

### Endpoint: `POST /api/mobile/driver/jobs/payment`

**Request Body:**
```json
{
  "jobId": "uuid",
  "amount": 25.50,
  "paymentMethod": "CASH" | "CARD" | "WALLET" | "UPI" | "BANK_TRANSFER",
  "customerId": "uuid",
  "driverId": "uuid",
  "status": "COMPLETED",
  "collectedAt": "2025-10-27T12:34:56Z"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "paymentId": "uuid",
    "amount": 25.50,
    "driverEarnings": 20.40,
    "companyCommission": 5.10,
    "paymentMethod": "CASH",
    "status": "COMPLETED"
  },
  "message": "Payment recorded successfully"
}
```

**Earnings Split Logic:**
```javascript
const companyCommissionRate = 0.20; // 20% (from company.commissionRate)
const companyCommission = amount * commissionRate;
const driverEarnings = amount - companyCommission;
```

## Job Status State Machine

```
UNASSIGNED/PENDING
    ↓ (claim)
OFFERED
    ↓ (accept)
ACCEPTED
    ↓ (proceed)
ON_THE_WAY
    ↓ (arrive | auto-arrive @ 500m)
ARRIVED
    ↓ (start)
STARTED/ACTIVE
    ↓ (complete)
COMPLETED
    ↓ (payment collected)
[Navigate to Home with earnings recorded]
```

## Special Actions

### NO_SHOW (from ARRIVED)
- Driver marks "No Show" if passenger doesn't appear
- Job moved to NO_SHOW status
- Driver availability: AVAILABLE
- Minimal cancellation fee charged (if configured)

### RECALL (from ACCEPTED/ON_THE_WAY/ARRIVED)
- Driver or dispatcher can recall
- Job moved to RECALLED status
- Job returns to UNASSIGNED
- Driver availability: AVAILABLE

### CANCELLED
- Can be cancelled by customer/dispatcher
- Job moved to CANCELLED status
- No payment collected

## Files Modified/Created

### Mobile App (React Native)
1. **New:** `/src/screens/Jobs/PaymentCollectionScreen.tsx`
   - Payment method selection UI
   - Amount display
   - Confirmation logic

2. **Modified:** `/src/navigation/RootNavigator.tsx`
   - Added PaymentCollection screen to navigation
   - Added params type definition

3. **Modified:** `/src/screens/Jobs/JobProgressScreen.tsx`
   - `handleComplete()` now navigates to PaymentCollection
   - Passes job details and customer info

4. **Modified:** `/src/screens/Home/HomeScreen.tsx`
   - Already has `handleClaimUpcomingJob` for real job claiming

### Backend (Node.js + Prisma)
1. **Modified:** `/src/routes/mobile/driverJobs.js`
   - **New Endpoint:** `POST /api/mobile/driver/jobs/payment`
   - Payment collection with commission split
   - Updates Job, Ride, and creates Payment record

2. **Existing:** `/services/jobService.js`
   - `claimJob()` - Creates real job assignment
   - `assignDriver()` - Assigns job with offer expiry
   - `handleJobCompleted()` - Creates initial payment record

## Testing Checklist

- [ ] Claim job from "Available Jobs Nearby"
- [ ] Accept job offer
- [ ] Navigate to pickup (ON_THE_WAY)
- [ ] Auto-arrive when within 500m
- [ ] Start ride (meter running)
- [ ] Complete ride
- [ ] Payment screen appears
- [ ] Select payment method
- [ ] Confirm payment
- [ ] Verify payment recorded in database
- [ ] Verify driver earnings calculated correctly
- [ ] Verify job history shows completed job
- [ ] Verify dispatch portal updates in real-time

## Benefits of Real Job Flow

✅ **Proper Audit Trail** - Every job has complete Assignment + Offer history  
✅ **Real Payments** - Driver earnings properly tracked and split  
✅ **Dispatch Visibility** - Real-time job status updates  
✅ **Commission Tracking** - Automatic company commission calculation  
✅ **Job History** - Complete job lifecycle stored in database  
✅ **Financial Reports** - Accurate earnings and payment data  
✅ **Dispute Resolution** - Full job timeline with timestamps  

## Date Implemented
October 27, 2025

