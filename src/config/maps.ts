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

// Matches the key already in use on the Android manifest (Places /
// Directions APIs enabled on the Google Cloud project `taxilatest`).
// Without this the Places autocomplete silently returns zero results,
// which read as "the walk-in drop-off search doesn't work".
export const GOOGLE_MAPS_API_KEY = 'AIzaSyBhcA7J8ZefAwlzhuYUNDIf_W3Yzy_16gA';

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

