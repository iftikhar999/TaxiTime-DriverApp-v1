#!/bin/bash

# Driver App V1 - Quick Setup Script
# This script sets up and runs the Driver App V1 project

set -e

echo "🚀 Setting up Driver App V1..."

# Navigate to project directory
cd /Applications/A_B_TAXI/mobile/driver-app-v1

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Check if Pods directory exists (iOS)
if [ ! -d "ios/Pods" ]; then
    echo "🍎 Installing iOS pods..."
    cd ios
    pod install
    cd ..
else
    echo "✅ iOS pods already installed"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To run the app:"
echo "  Android: npm run android"
echo "  iOS:     npm run ios"
echo ""
