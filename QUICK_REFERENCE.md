# Driver App V1 - Quick Reference

## 🚀 Quick Start Commands

### First Time Setup

```bash
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npm install
cd ios && pod install && cd ..
```

### Run Android

```bash
# Terminal 1 - Start Metro
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npm start

# Terminal 2 - Run app
npm run android
```

### Run iOS

```bash
# Terminal 1 - Start Metro
cd /Applications/A_B_TAXI/mobile/driver-app-v1
npm start

# Terminal 2 - Run app
npm run ios
```

## 📦 Project Info

- **App Name:** DriverAppV1
- **Display Name:** TaxiTime Driver V1
- **Package:** com.taxitime.driverv1
- **RN Version:** 0.79.2
- **React Version:** 19.0.0

## 🎨 Theme Colors

```typescript
import { Colors } from './src/theme/colors';

// Usage
<View style={{ backgroundColor: Colors.primary[500] }}>
  <Text style={{ color: Colors.text.primary }}>Hello</Text>
</View>
```

### Available Colors

- `Colors.primary[50-900]` - Blue shades
- `Colors.secondary[100-800]` - Cyan shades
- `Colors.success` - Green
- `Colors.danger` - Red
- `Colors.warning` - Orange
- `Colors.surface.default` - Light gray
- `Colors.surface.card` - White
- `Colors.text.primary` - Dark blue
- `Colors.text.secondary` - Medium blue
- `Colors.text.muted` - Light blue
- `Colors.text.inverse` - White

## 🔤 Typography Component

```typescript
import Typography from './src/components/design/Typography';

// Usage
<Typography variant="titleLarge" color={Colors.primary[600]}>
  Welcome
</Typography>

<Typography variant="body">
  Regular text
</Typography>
```

## 📁 Project Structure

```
driver-app-v1/
├── android/          # Android native code
├── ios/              # iOS native code
├── src/
│   ├── components/   # Reusable components
│   ├── screens/      # App screens (add here)
│   ├── navigation/   # Navigation config (add here)
│   ├── services/     # API services (add here)
│   ├── store/        # Zustand stores (add here)
│   ├── theme/        # Theme system
│   └── utils/        # Utility functions (add here)
├── App.tsx           # Main app component
└── index.js          # Entry point
```

## 🛠️ Common Tasks

### Add a New Screen

1. Create file: `src/screens/YourScreen/YourScreen.tsx`
2. Use theme and typography:

```typescript
import React from 'react';
import { View } from 'react-native';
import Typography from '@/components/design/Typography';
import { Colors } from '@/theme/colors';

export default function YourScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.surface.default }}>
      <Typography variant="titleLarge">Your Screen</Typography>
    </View>
  );
}
```

### Add Navigation

```bash
# Already have React Navigation installed
# Just need to configure it
```

Create `src/navigation/AppNavigator.tsx`:

```typescript
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### Add State Management

```bash
# Zustand is already installed
```

Create `src/store/authStore.ts`:

```typescript
import { create } from "zustand";

interface AuthState {
  user: any | null;
  setUser: (user: any) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

### Add API Service

Create `src/services/api.ts`:

```typescript
import axios from "axios";

const API_BASE_URL = "https://your-api.com";

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

export const authApi = {
  login: (email: string, password: string) =>
    api.post("/auth/login", { email, password }),
  register: (data: any) => api.post("/auth/register", data),
};
```

## 🐛 Troubleshooting

### Metro won't start

```bash
npx react-native start --reset-cache
```

### Build fails

```bash
cd android && ./gradlew clean && cd ..
npm run android
```

### App crashes on launch

```bash
adb logcat | grep ReactNative
```

### Dependencies issue

```bash
rm -rf node_modules package-lock.json
npm install
```

### iOS build fails

```bash
cd ios
rm -rf Pods Podfile.lock
pod install
cd ..
```

## 📱 Device Commands

### List devices

```bash
# Android
adb devices

# iOS
xcrun simctl list devices
```

### Install app manually

```bash
# Android
cd android
./gradlew installDebug

# iOS
npx react-native run-ios --device "iPhone 15"
```

### View logs

```bash
# Android
adb logcat

# iOS
npx react-native log-ios
```

### Clear app data

```bash
# Android
adb shell pm clear com.taxitime.driverv1

# iOS
xcrun simctl erase all
```

## 🔥 Firebase Setup (Optional)

1. Create Firebase project
2. Download `google-services.json`
3. Place in `android/app/`
4. Download `GoogleService-Info.plist`
5. Place in `ios/DriverAppV1/`

## ✅ Status

- ✅ Project initialized
- ✅ Android configured
- ✅ iOS configured
- ✅ Dependencies installed
- ✅ Theme system ready
- ✅ Typography ready
- ✅ Metro running
- 🔄 First build in progress

## 🎯 Next Steps

1. Wait for build to complete
2. Verify app launches
3. Add navigation structure
4. Create authentication screens
5. Build core features

---

**Last Updated:** October 12, 2025  
**Status:** ✅ Ready for Development
