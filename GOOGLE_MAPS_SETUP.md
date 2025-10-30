# 🗺️ Google Maps API Setup Guide

## ✅ Package Installed

- `react-native-maps-directions` ✅ Installed successfully

---

## 📝 Setup Google Maps API Key

### **Step 1: Get API Key**

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Click **"Create Credentials"** → **"API Key"**
4. Copy the API key

### **Step 2: Enable Required APIs**

Enable these APIs for your project:
- ✅ **Maps SDK for Android**
- ✅ **Maps SDK for iOS**
- ✅ **Directions API** (required for MapViewDirections)
- ✅ **Geocoding API** (optional, for address lookup)

### **Step 3: Add API Key to Config**

Open: `/src/config/maps.ts`

Replace the placeholder:
```typescript
export const GOOGLE_MAPS_API_KEY = 'YOUR_ACTUAL_API_KEY_HERE';
```

---

## 🔒 Security: Restrict API Key (Recommended)

### **For Android:**

1. In Google Cloud Console, click on your API key
2. Under **"Application restrictions"**, select **"Android apps"**
3. Add package name: `com.taxitime.driver` (or your actual package name)
4. Add SHA-1 certificate fingerprint:
   ```bash
   # Debug keystore
   keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
   ```

### **For iOS:**

1. Select **"iOS apps"**
2. Add bundle identifier: `com.taxitime.driver` (from your Xcode project)

---

## 🧪 Testing

After adding your API key:

```bash
# Restart metro bundler
npm start -- --reset-cache

# Run app
npm run ios
# or
npm run android
```

---

## 📊 Usage in Code

The API key is now centrally configured in `/src/config/maps.ts`:

```typescript
import { GOOGLE_MAPS_API_KEY } from "../config/maps";

// Use in MapViewDirections
<MapViewDirections
  origin={pickup}
  destination={dropoff}
  apikey={GOOGLE_MAPS_API_KEY}
  strokeWidth={4}
  strokeColor="#38bdf8"
/>
```

---

## 💰 Pricing (as of 2025)

Google Maps Platform offers **$200 free credit** per month.

**Directions API Pricing:**
- $5 per 1,000 requests
- With $200 credit = **40,000 free requests/month**

**For typical usage:**
- 100 drivers × 50 jobs/day × 30 days = 150,000 requests/month
- Cost after free tier: (150,000 - 40,000) × $5/1,000 = **$550/month**

---

## 🚨 Error: "API key is invalid"

If you see this error:

1. ✅ **Check API key is correct** in `/src/config/maps.ts`
2. ✅ **Verify Directions API is enabled** in Google Cloud Console
3. ✅ **Wait 1-5 minutes** for changes to propagate
4. ✅ **Restart app** with cache reset: `npm start -- --reset-cache`

---

## 📱 Platform-Specific Setup

### **Android Additional Setup:**

In `android/app/src/main/AndroidManifest.xml`, add:

```xml
<application>
  <!-- Add your Google Maps API key -->
  <meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="YOUR_API_KEY_HERE"/>
</application>
```

### **iOS Additional Setup:**

In `ios/Podfile`, ensure you have:

```ruby
pod 'GoogleMaps'
pod 'Google-Maps-iOS-Utils'
```

Then run:
```bash
cd ios && pod install && cd ..
```

---

## ✅ Verification Checklist

- [ ] API key obtained from Google Cloud Console
- [ ] Directions API enabled
- [ ] API key added to `/src/config/maps.ts`
- [ ] Metro bundler restarted with cache reset
- [ ] App runs without "react-native-maps-directions" error
- [ ] Map shows route between pickup and driver
- [ ] Navigation buttons work (Google Maps/Waze)

---

## 🎯 Current Status

✅ **Package installed:** `react-native-maps-directions`  
✅ **Config file created:** `/src/config/maps.ts`  
✅ **Component updated:** `JobOfferMap.tsx`  

⚠️ **Action needed:** Add your Google Maps API key to `/src/config/maps.ts`

---

**Once you add the API key and restart the app, the job offer map will show the route from driver to pickup location!** 🗺️

