# Stripe Payment Integration - Fix Applied ✅

## Issue Summary

The mobile driver app was getting **404 errors** when attempting to create Stripe Payment Intents:

```
❌ Error creating payment intent: {
  message: 'Request failed with status code 404',
  status: 404
}
```

## Root Cause Analysis

### 1. ✅ Double `/api` in URL Path (FIXED)

**Problem:** The mobile app was making requests to `/api/payments/create-intent`, but the httpClient already has `baseURL: http://10.0.2.2:3000/api`, resulting in:

- **Incorrect URL:** `http://10.0.2.2:3000/api/api/payments/create-intent` ❌
- **Correct URL:** `http://10.0.2.2:3000/api/payments/create-intent` ✅

**Fix Applied:**

```typescript
// File: /Applications/A_B_TAXI/mobile/driver-app-v1/src/screens/Jobs/PaymentCollectionScreen.tsx
// Line 202

// BEFORE:
const response = await httpClient.post('/api/payments/create-intent', { ... });

// AFTER:
const response = await httpClient.post('/payments/create-intent', { ... });
```

### 2. ⏳ Missing Stripe API Keys (USER ACTION REQUIRED)

**Problem:** The backend `.env.production` file has placeholder Stripe keys:

```bash
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
```

**Solution:** User needs to add real Stripe test keys from https://dashboard.stripe.com/test/apikeys

## Files Modified

### 1. PaymentCollectionScreen.tsx ✅

**File:** `/Applications/A_B_TAXI/mobile/driver-app-v1/src/screens/Jobs/PaymentCollectionScreen.tsx`

**Change:** Line 202 - Fixed API endpoint path

```typescript
// ✅ FIX: httpClient baseURL already includes /api, so just use /payments/create-intent
const response = await httpClient.post("/payments/create-intent", {
  amount: amountCents,
  currency: "nzd",
  jobId: currentJob?.id,
  customerId: currentJob?.customer?.id,
});
```

**Result:** Mobile app now makes requests to the correct endpoint

### 2. .env.production ✅

**File:** `/Applications/A_B_TAXI/backend/.env.production`

**Change:** Lines 20-25 - Added helpful comments about Stripe setup

```bash
# Payment Gateways
# ⚠️ IMPORTANT: Replace with your actual Stripe API keys from https://dashboard.stripe.com/test/apikeys
# Get FREE test keys: https://dashboard.com/register (no credit card required)
# Test keys start with: sk_test_... and pk_test_...
# See STRIPE_SETUP_INSTRUCTIONS.md for detailed setup guide
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
```

**Result:** Clear instructions for user on how to configure Stripe

### 3. STRIPE_SETUP_INSTRUCTIONS.md ✅ (NEW)

**File:** `/Applications/A_B_TAXI/backend/STRIPE_SETUP_INSTRUCTIONS.md`

**Purpose:** Comprehensive guide for setting up Stripe payment integration

**Contents:**

- Current issue explanation
- Step-by-step Stripe account setup
- How to get test API keys
- Backend configuration instructions
- Mobile app testing guide
- Stripe test card numbers
- Troubleshooting tips
- Production setup guide

## Verification Steps

### 1. Verify Backend Endpoint (✅ Confirmed Working)

The backend endpoint is properly configured:

```javascript
// File: /Applications/A_B_TAXI/backend/server.js
// Line 1773
app.use("/api/payments", require("./routes/payments"));

// File: /Applications/A_B_TAXI/backend/routes/payments.js
// Line 29
router.post("/create-intent", authenticateToken, async (req, res) => {
  // Creates Stripe Payment Intent
  // Returns: paymentIntent, ephemeralKey, customer, publishableKey
});
```

### 2. Verify Mobile App Configuration (✅ Fixed)

```typescript
// httpClient base URL
baseURL: "http://10.0.2.2:3000/api"

// API call (now correct)
httpClient.post('/payments/create-intent', { ... })

// Final URL: http://10.0.2.2:3000/api/payments/create-intent ✅
```

### 3. Verify Error Handling (✅ Working)

The mobile app shows a user-friendly error message when Stripe is not configured:

```typescript
Alert.alert(
  "Stripe Not Configured",
  "Card payment requires Stripe API keys to be configured.\n\n" +
    "Please add STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to backend .env file.\n\n" +
    "For now, use Cash, EFTPOS, Account, or Gift Card.",
  [{ text: "OK" }]
);
```

## Testing Instructions

### Without Stripe Keys (Current State)

1. ✅ Open mobile driver app
2. ✅ Complete a trip (click "COMPLETE TRIP")
3. ✅ Try to select "CARD" payment method
4. ✅ See error alert: "Stripe Not Configured"
5. ✅ Use other payment methods (Cash, EFTPOS, Account, Gift Card) - these work fine

### With Stripe Keys (After User Configures)

1. User adds real Stripe test keys to `.env.production`
2. Restart backend server
3. Open mobile driver app
4. Complete a trip
5. Select "CARD" payment method
6. ✅ Stripe Payment Sheet loads successfully
7. Enter test card: `4242 4242 4242 4242`
8. Complete payment

## Backend API Details

**Endpoint:** `POST /api/payments/create-intent`

**Authentication:** Bearer token required

**Request:**

```json
{
  "amount": 14300, // Amount in cents (143.00 NZD)
  "currency": "nzd", // Currency code
  "jobId": "cmheiaaq...", // Job ID
  "customerId": "xyz123" // Optional: Passenger ID
}
```

**Response (Success):**

```json
{
  "success": true,
  "paymentIntent": "pi_xxx_secret_yyy",
  "ephemeralKey": "ek_test_xxx",
  "customer": "cus_xxx",
  "publishableKey": "pk_test_xxx"
}
```

**Response (Error - Current):**

```json
{
  "success": false,
  "error": "Failed to create payment intent"
}
```

## Next Steps for User

1. **Get Stripe Test Keys** (5 minutes)
   - Visit https://dashboard.stripe.com/register
   - Create free account
   - Copy test keys from https://dashboard.stripe.com/test/apikeys

2. **Update Backend Configuration**

   ```bash
   # Edit /Applications/A_B_TAXI/backend/.env.production
   STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY_HERE
   STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_ACTUAL_KEY_HERE
   ```

3. **Restart Backend Server**

   ```bash
   cd /Applications/A_B_TAXI/backend
   npm restart
   ```

4. **Test Payment Flow**
   - Complete trip in mobile app
   - Select CARD payment
   - Use test card: 4242 4242 4242 4242
   - Confirm payment works

## Summary

✅ **Mobile App Fix:** Changed API endpoint from `/api/payments/create-intent` to `/payments/create-intent`

✅ **Documentation:** Created comprehensive Stripe setup guide

✅ **Error Handling:** User-friendly error messages already in place

⏳ **User Action Required:** Add real Stripe test keys to backend .env file

**Impact:** Once Stripe keys are added, card payments will work perfectly!
