# Fixes Applied - Tariff Selection & Icons

## Date: October 12, 2025

## Issues Fixed

### 1. ✅ Confirm Selection Button Not Working

**Problem:** When clicking "Confirm Selection" on the Tariff Selection screen, the shift wouldn't start and navigation wouldn't proceed.

**Root Cause:** The `startShift` API call was missing the `tariffId` parameter in the payload.

**Files Modified:**

- `/src/types/shift.ts` - Added `tariffId: string` to `StartShiftPayload` interface
- `/src/screens/Shift/TariffSelectionScreen.tsx` - Added `tariffId: selectedTariff.id` to the shift start payload

**Changes:**

```typescript
// Before
await startShift({
  vehicleId,
  location: { latitude: 25.2854, longitude: 51.531 },
});

// After
await startShift({
  vehicleId,
  tariffId: selectedTariff.id,
  location: { latitude: 25.2854, longitude: 51.531 },
});
```

---

### 2. ✅ Backend API Error - Cannot read properties of undefined (reading 'findFirst')

**Problem:** Backend was throwing error: `TypeError: Cannot read properties of undefined (reading 'findFirst')`

**Root Cause:** The code was using `prisma.driverShift` but the actual Prisma model name is `Shift` (which becomes `prisma.shift` in the client).

**Files Modified:**

- `/backend/src/routes/mobile/driverShift.js` - Replaced all 18 occurrences of `prisma.driverShift` with `prisma.shift`

**Database Model:**

```prisma
model Shift {
  id            String      @id @default(cuid())
  driverId      String
  companyId     String
  startTime     DateTime
  endTime       DateTime?
  status        ShiftStatus @default(OFFLINE)
  // ... other fields
  @@map("shifts")
}
```

---

### 3. ✅ Icons Showing X Instead of Proper Icons

**Problem:** Material Community Icons were showing as 'X' boxes instead of the actual icons.

**Root Cause:** Vector icon fonts were not properly linked to the Android project.

**Files Created:**

- `/react-native.config.js` - Added configuration to link icon font assets

**Commands Executed:**

```bash
npx react-native-asset     # Link icon fonts
cd android && ./gradlew clean   # Clean build
```

**Configuration Added:**

```javascript
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  assets: ["./node_modules/react-native-vector-icons/Fonts"],
};
```

---

## Next Steps

### To Apply These Fixes:

1. **Backend Changes** (Already Applied):
   - The backend fix is complete. No restart needed if using nodemon.

2. **Mobile App** (Requires Rebuild):

   ```bash
   cd /Applications/A_B_TAXI/mobile/driver-app-v1

   # For Android:
   cd android && ./gradlew clean && cd ..
   npx react-native run-android

   # For iOS (if needed):
   cd ios && pod install && cd ..
   npx react-native run-ios
   ```

3. **Test the Fixes:**
   - Open the app
   - Navigate to Start Shift
   - Select a vehicle
   - Choose a tariff
   - Click "Confirm Selection"
   - ✅ Should navigate to Home screen with active shift
   - ✅ Icons should display properly (not X)

---

## Technical Details

### API Endpoint

`POST /api/mobile/driver/shift/start`

**Expected Payload:**

```json
{
  "vehicleId": "clxxx...",
  "tariffId": "clyyy...",
  "location": {
    "latitude": 25.2854,
    "longitude": 51.531
  }
}
```

### Shift Status Flow

1. Driver selects vehicle → `VehicleSelectionScreen`
2. Driver selects tariff → `TariffSelectionScreen`
3. Click confirm → `startShift()` API call with vehicleId + tariffId
4. Backend creates `Shift` record with status `ACTIVE`
5. Navigate to → `Home` screen with active shift

---

## Verification Checklist

- [x] Backend model name corrected (`Shift` not `DriverShift`)
- [x] Frontend sends `tariffId` in shift start payload
- [x] Type definitions updated with `tariffId`
- [x] Vector icons properly configured
- [x] Icon fonts linked to Android project
- [x] Clean build completed
- [ ] App tested on device/emulator (user to verify)
- [ ] Shift starts successfully (user to verify)
- [ ] Icons display correctly (user to verify)

---

## Related Files

- Frontend: `/mobile/driver-app-v1/src/screens/Shift/TariffSelectionScreen.tsx`
- Types: `/mobile/driver-app-v1/src/types/shift.ts`
- Backend: `/backend/src/routes/mobile/driverShift.js`
- Config: `/mobile/driver-app-v1/react-native.config.js`
- Database: `/backend/prisma/schema.prisma` (line 708 - Shift model)
