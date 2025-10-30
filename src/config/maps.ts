/**
 * Maps Configuration
 * 
 * Google Maps API Key for directions and geocoding
 * 
 * Setup:
 * 1. Get API key from: https://console.cloud.google.com/apis/credentials
 * 2. Enable: Maps SDK for Android, Maps SDK for iOS, Directions API
 * 3. Replace the key below
 */

export const GOOGLE_MAPS_API_KEY = 
  // TODO: Replace with your actual Google Maps API key
  'AIzaSyBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'; // Placeholder - replace with real key

export const MAPS_CONFIG = {
  // Default region for map initialization
  defaultRegion: {
    latitude: 37.78825,
    longitude: -122.4324,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  },
  
  // Map settings
  showsUserLocation: true,
  showsMyLocationButton: true,
  showsCompass: true,
  showsScale: false,
  showsTraffic: false,
  
  // Route settings
  strokeWidth: 4,
  strokeColor: '#38bdf8',
  optimizeWaypoints: true,
};

