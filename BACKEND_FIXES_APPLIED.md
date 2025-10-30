# Backend API Fixes - Driver Shift & Ride History

## Date: October 12, 2025

## Issues Fixed

### 1. ✅ Shift API - 500 Error (Cannot include vehicle relation)

**Problem:** Backend throwing 500 error on `/api/mobile/driver/shift/current`

**Root Cause:** The code was trying to include a `vehicle` relation on the `Shift` model, but the Prisma schema doesn't have a `vehicleId` field or vehicle relation on the Shift model.

**Database Schema:**

```prisma
model Shift {
  id            String      @id @default(cuid())
  driverId      String
  companyId     String
  startTime     DateTime
  endTime       DateTime?
  status        ShiftStatus
  // NO vehicleId field!
  // NO vehicle relation!
  company       Company     @relation(fields: [companyId], references: [id])
  driver        User        @relation("DriverShifts", fields: [driverId], references: [id])
  @@map("shifts")
}
```

**Fix Applied:**
Removed all `include: { vehicle: {...} }` from shift queries in `/backend/src/routes/mobile/driverShift.js`

**Lines Modified:**

- Line 116: Removed vehicle include from existing shift query
- Line 258: Removed vehicle include from shift findUnique
- Line 318: Removed vehicle include from active shift query
- Line 430: Removed vehicle include from current shift endpoint

---

### 2. ✅ Ride History API - 500 Error (Wrong relation name)

**Problem:** Backend throwing 500 error on `/api/mobile/driver/jobs/history`

**Root Cause:** The code was trying to include `payment` (singular) relation, but the Prisma schema has `Payment` (plural array).

**Database Schema:**

```prisma
model Ride {
  id          String    @id
  // ... other fields
  Payment     Payment[] // <-- It's an array, not a single relation!
  @@map("rides")
}
```

**Fix Applied:**
Changed `payment:` to `Payment:` with array handling in `/backend/src/routes/mobile/driverJobs.js`

```javascript
// Before:
payment: {
  select: { amount: true, ... }
}

// After:
Payment: {
  select: { amount: true, ... },
  take: 1,
  orderBy: { createdAt: 'desc' }
}
```

---

### 3. ✅ Icons Still Showing X

**Status:** Fonts are properly linked, but app needs full rebuild

**Verification:**

```bash
ls /Applications/A_B_TAXI/mobile/driver-app-v1/android/app/src/main/assets/fonts/
# MaterialCommunityIcons.ttf ✅ Present (1.1MB)
```

**Why Icons Still Show X:**
The app was already running when fonts were linked. React Native doesn't hot-reload native assets.

---

## Required Actions

### 1. Rebuild the Android App (REQUIRED)

```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1

# Kill any running metro bundler
pkill -f "react-native"

# Uninstall the old app from device/emulator
adb uninstall com.taxitime.driverv1

# Clean and rebuild
cd android && ./gradlew clean && cd ..

# Run the app fresh
npx react-native run-android
```

### 2. Backend is Already Fixed

The backend changes are already applied. If using nodemon, it auto-restarted.

---

## Testing Checklist

After rebuilding the app:

- [ ] Icons display correctly (no X boxes)
  - MaterialCommunityIcons should show properly
  - `arrow-left` icon should appear
  - `checkbox-marked-circle` icon should appear

- [ ] API Errors Fixed:
  - [ ] `/api/mobile/driver/shift/current` returns 200 (not 500)
  - [ ] `/api/mobile/driver/jobs/history` returns 200 (not 500)
  - [ ] App loads without console errors
  - [ ] Can start a shift successfully
  - [ ] Can view ride history

---

## Technical Details

### Files Modified (Backend):

1. `/backend/src/routes/mobile/driverShift.js`
   - Removed 4 vehicle include statements
   - Changed `prisma.driverShift` to `prisma.shift` (18 occurrences)

2. `/backend/src/routes/mobile/driverJobs.js`
   - Changed `payment` to `Payment` with array handling

### Files Created (Frontend):

1. `/mobile/driver-app-v1/react-native.config.js`
   - Configured icon fonts asset linking

### Commands Executed:

```bash
npx react-native-asset          # Linked fonts
cd android && ./gradlew clean   # Cleaned build
```

---

## Why The Fixes Were Needed

### Prisma Model Mismatch

The backend code was written assuming the `Shift` model had a `vehicle` relation, but it doesn't exist in the schema. This is a database design issue - shifts don't track which vehicle was used.

**Possible Future Enhancement:**
Add `vehicleId` to the Shift model if tracking vehicles per shift is needed:

```prisma
model Shift {
  //  ... existing fields
  vehicleId     String?
  vehicle       Vehicle? @relation(fields: [vehicleId], references: [id])
}
```

### Payment Relation Type

Rides can have multiple payments (refunds, partial payments, etc.), so it's an array.

---

## Related Documentation

- Backend API: `/backend/src/routes/mobile/driverShift.js`
- Database Schema: `/backend/prisma/schema.prisma`
- Icon Config: `/mobile/driver-app-v1/react-native.config.js`
