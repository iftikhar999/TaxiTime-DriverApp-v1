#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# TAXITIME DRIVER APP - APK BUILDER
# ═══════════════════════════════════════════════════════════════
# Builds production APK with server URL: http://54.252.241.150
# ═══════════════════════════════════════════════════════════════

set -e  # Exit on error

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "🚀 TaxiTime Driver App - APK Builder"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="/Applications/A_B_TAXI/mobile/driver-app-v1"
SERVER_URL="http://54.252.241.150"
BUILD_TYPE="release"  # or "debug"
OUTPUT_DIR="$APP_DIR/android/app/build/outputs/apk/release"

echo "📱 App Directory: $APP_DIR"
echo "🌐 Server URL: $SERVER_URL"
echo "🔨 Build Type: $BUILD_TYPE"
echo ""

# Navigate to app directory
cd "$APP_DIR"

# Step 1: Verify environment config
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 Step 1: Verifying Environment Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if grep -q "http://54.252.241.150" src/config/environment.ts; then
    echo -e "${GREEN}✅ Production server URL configured${NC}"
else
    echo -e "${RED}❌ Server URL not configured correctly${NC}"
    echo "Expected: http://54.252.241.150"
    exit 1
fi
echo ""

# Step 2: Clean previous builds
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 Step 2: Cleaning Previous Builds"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd android
./gradlew clean
cd ..
echo -e "${GREEN}✅ Clean completed${NC}"
echo ""

# Step 3: Install dependencies
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📦 Step 3: Installing Dependencies"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"
echo ""

# Step 4: Build APK
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔨 Step 4: Building APK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd android

if [ "$BUILD_TYPE" = "release" ]; then
    echo -e "${YELLOW}Building RELEASE APK...${NC}"
    ./gradlew assembleRelease
    APK_PATH="$OUTPUT_DIR/app-release.apk"
else
    echo -e "${YELLOW}Building DEBUG APK...${NC}"
    ./gradlew assembleDebug
    APK_PATH="$APP_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
fi

cd ..
echo -e "${GREEN}✅ APK built successfully${NC}"
echo ""

# Step 5: Locate and display APK info
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📍 Step 5: APK Location"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ -f "$APK_PATH" ]; then
    APK_SIZE=$(du -h "$APK_PATH" | cut -f1)
    echo -e "${GREEN}✅ APK Generated Successfully!${NC}"
    echo ""
    echo "📦 APK Details:"
    echo "   Location: $APK_PATH"
    echo "   Size: $APK_SIZE"
    echo "   Server: $SERVER_URL"
    echo ""
    
    # Copy to desktop for easy access
    DESKTOP_PATH="$HOME/Desktop/TaxiTimeDriver-$(date +%Y%m%d-%H%M%S).apk"
    cp "$APK_PATH" "$DESKTOP_PATH"
    echo -e "${GREEN}✅ APK copied to Desktop: $DESKTOP_PATH${NC}"
    echo ""
    
    # Display installation instructions
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📱 Installation Instructions"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "For Physical Device:"
    echo "  1. Connect device via USB"
    echo "  2. Enable USB debugging on device"
    echo "  3. Run: adb install \"$DESKTOP_PATH\""
    echo ""
    echo "Or transfer the APK file to your device and install manually"
    echo ""
    echo "For Emulator:"
    echo "  1. Start emulator"
    echo "  2. Drag and drop APK onto emulator"
    echo "  Or run: adb install \"$APK_PATH\""
    echo ""
    
else
    echo -e "${RED}❌ APK not found at expected location${NC}"
    echo "Expected: $APK_PATH"
    echo ""
    echo "Searching for APK files..."
    find "$APP_DIR/android/app/build/outputs/apk" -name "*.apk" -type f
    exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✅ Build Process Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
