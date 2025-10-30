/**
 * Sound notification utility for driver app
 * Plays notification sound when a new job arrives
 *
 * NOTE: This requires expo-av to be installed:
 * npm install expo-av
 * or
 * yarn add expo-av
 *
 * Then rebuild the app with: npm run android or npm run ios
 */

import { Platform } from "react-native";

let Sound: any = null;
let soundInstance: any = null;
let isInitialized = false;

// Initialize sound library
const initializeSound = async () => {
  if (isInitialized) return true;

  try {
    // Try to load expo-av if available
    if (Platform.OS === "ios" || Platform.OS === "android") {
      try {
        // @ts-ignore - Dynamic require to avoid compile errors when expo-av not installed
        const ExpoAV = require("expo-av");
        Sound = ExpoAV.Audio;

        // Configure audio mode for notifications
        await Sound.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        isInitialized = true;
        console.log("✅ Sound notifications initialized");
        return true;
      } catch (requireError) {
        console.warn(
          "⚠️ expo-av not installed. Install with: npm install expo-av"
        );
        return false;
      }
    }
  } catch (error) {
    console.warn("⚠️ Failed to initialize sound:", error);
  }
  return false;
};

/**
 * Play notification sound when a job is assigned
 */
export const playJobNotificationSound = async () => {
  try {
    // Initialize sound if not already done
    if (!Sound) {
      await initializeSound();
    }

    if (!Sound) {
      console.warn("⚠️ Sound library not available");
      return;
    }

    // Unload previous sound instance if exists
    if (soundInstance) {
      await soundInstance.unloadAsync();
      soundInstance = null;
    }

    // Load and play the notification sound
    // You'll need to add a sound file to the assets folder
    // For now, using a system sound or you can add a custom sound file
    console.log("🔊 Playing job notification sound");

    const { sound } = await Sound.createAsync(
      // Add your custom sound file here, e.g.:
      // require('../../assets/sounds/notification.mp3')
      // For now using a default system sound
      {
        uri: "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWi68N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWi7",
      },
      { shouldPlay: true, volume: 1.0 }
    );

    soundInstance = sound;

    // Set callback for when sound finishes playing
    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.didJustFinish) {
        sound.unloadAsync();
        soundInstance = null;
      }
    });
  } catch (error) {
    console.error("❌ Error playing job notification sound:", error);
  }
};

/**
 * Stop the currently playing notification sound
 */
export const stopJobNotificationSound = async () => {
  try {
    if (soundInstance) {
      await soundInstance.stopAsync();
      await soundInstance.unloadAsync();
      soundInstance = null;
    }
  } catch (error) {
    console.error("❌ Error stopping notification sound:", error);
  }
};

export default {
  playJobNotificationSound,
  stopJobNotificationSound,
};
