#!/bin/bash
# Install expo-av for driver app sound notifications
# Run this from the project root directory

echo "🔊 Installing expo-av for driver app sound notifications..."
echo ""

cd /Applications/A_B_TAXI/mobile/driver-app-v1

echo "📦 Installing expo-av..."
npm install expo-av

if [ $? -eq 0 ]; then
    echo "✅ expo-av installed successfully!"
    echo ""
    echo "🏗️  Next steps:"
    echo "1. Rebuild the driver app:"
    echo "   npm run android  # For Android"
    echo "   npm run ios      # For iOS"
    echo ""
    echo "2. Test the sound notification:"
    echo "   - Start backend server"
    echo "   - Start dispatch panel"
    echo "   - Open driver app"
    echo "   - Assign a job from dispatch"
    echo "   - You should hear a notification sound! 🔊"
    echo ""
else
    echo "❌ Failed to install expo-av"
    echo "Please try manually:"
    echo "cd /Applications/A_B_TAXI/mobile/driver-app-v1"
    echo "npm install expo-av"
    exit 1
fi
