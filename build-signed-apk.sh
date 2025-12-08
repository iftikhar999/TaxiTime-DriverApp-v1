#!/bin/bash

# TaxiTime Driver - Signed Release APK Builder
# This script builds a production-ready signed APK

set -e

echo "🚗 TaxiTime Driver - Building Signed Release APK"
echo "=================================================="

# Step 1: Navigate to Android directory
echo ""
echo "📂 Step 1: Navigating to Android directory..."
cd android

# Step 2: Build the signed release APK
echo ""
echo "🔨 Step 2: Building signed release APK..."
echo "This may take a few minutes..."
./gradlew assembleRelease

# Step 3: Locate the APK
APK_PATH="app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
    echo "❌ Error: APK not found at $APK_PATH"
    exit 1
fi

# Step 4: Copy to Desktop with timestamp
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
DESKTOP_PATH="$HOME/Desktop/TaxiTimeDriver-Signed-${TIMESTAMP}.apk"
echo ""
echo "📦 Step 3: Copying APK to Desktop..."
cp "$APK_PATH" "$DESKTOP_PATH"

# Get APK size
APK_SIZE=$(du -h "$DESKTOP_PATH" | cut -f1)

echo ""
echo "✅ SUCCESS! Signed release APK created"
echo "=================================================="
echo "📱 APK Location: $DESKTOP_PATH"
echo "📊 APK Size: $APK_SIZE"
echo ""
echo "🔑 Keystore Info:"
echo "   Store: android/app/taxitime-driver-release.keystore"
echo "   Alias: taxitime-driver"
echo "   Password: TaxiTime2025"
echo ""
echo "🚀 You can now install this APK on any Android device"
echo "=================================================="
