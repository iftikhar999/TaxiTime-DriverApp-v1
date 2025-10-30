#!/bin/bash

# 🚀 COMPLETE REBUILD SCRIPT FOR FOREGROUND SERVICE FIX
# This script rebuilds the Android app with the new native modules

echo "🔥 =========================================="
echo "🔥 DRIVER APP COMPLETE REBUILD"
echo "🔥 Integrating Foreground Service Fix"
echo "🔥 =========================================="
echo ""

# Change to app directory
cd "$(dirname "$0")"
echo "📂 Working directory: $(pwd)"
echo ""

# Step 1: Uninstall old app
echo "1️⃣ Uninstalling old app..."
adb uninstall com.taxitime.driverv1
echo "✅ Old app uninstalled"
echo ""

# Step 2: Clean Android build
echo "2️⃣ Cleaning Android build..."
cd android
./gradlew clean
cd ..
echo "✅ Android build cleaned"
echo ""

# Step 3: Clean Metro bundler cache
echo "3️⃣ Cleaning Metro bundler cache..."
rm -rf /tmp/metro-* 2>/dev/null
npx react-native start --reset-cache &
METRO_PID=$!
echo "✅ Metro cache cleared, bundler starting (PID: $METRO_PID)"
echo ""

# Wait for Metro to start
echo "⏳ Waiting for Metro bundler to start..."
sleep 5
echo ""

# Step 4: Rebuild and install
echo "4️⃣ Building and installing app with new native modules..."
echo "⏳ This will take 2-3 minutes..."
echo ""

npx react-native run-android

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ =========================================="
    echo "✅ BUILD SUCCESSFUL!"
    echo "✅ =========================================="
    echo ""
    echo "🎯 NEXT STEPS:"
    echo "1. Login to the app"
    echo "2. Start your shift"
    echo "3. Verify notification appears: '🚕 AB Taxi - On Shift'"
    echo "4. Verify notification CANNOT be dismissed"
    echo "5. Open recent apps and SWIPE AWAY the driver app"
    echo "6. ✨ Notification should STAY visible"
    echo "7. Check dispatch - location should keep updating"
    echo "8. Wait 30 seconds and check again"
    echo "9. Reopen app - should be on dashboard with shift still active"
    echo ""
    echo "🔥 THE APP IS NOW IMMORTAL DURING SHIFTS! 🔥"
    echo ""
else
    echo ""
    echo "❌ =========================================="
    echo "❌ BUILD FAILED!"
    echo "❌ =========================================="
    echo ""
    echo "🔍 TROUBLESHOOTING:"
    echo "1. Check if Android SDK is installed"
    echo "2. Check if ANDROID_HOME is set"
    echo "3. Check if adb devices shows your device"
    echo "4. Try running: cd android && ./gradlew clean && cd .."
    echo "5. Then run: npx react-native run-android"
    echo ""
    exit 1
fi

