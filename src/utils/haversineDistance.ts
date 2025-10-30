/**
 * Haversine Distance Calculator
 * 
 * Calculates the great-circle distance between two points on Earth
 * using the Haversine formula. This is accurate for most taxi applications.
 * 
 * @see https://en.wikipedia.org/wiki/Haversine_formula
 */

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/**
 * Earth's mean radius in meters
 * Using the IUGG value for consistency with GPS systems
 */
const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculate the distance between two coordinates in meters
 * 
 * @param point1 First coordinate {latitude, longitude}
 * @param point2 Second coordinate {latitude, longitude}
 * @returns Distance in meters
 * 
 * @example
 * const distance = calculateHaversineDistance(
 *   { latitude: 40.7128, longitude: -74.0060 }, // New York
 *   { latitude: 51.5074, longitude: -0.1278 }   // London
 * );
 * console.log(distance); // ~5570000 meters (5570 km)
 */
export function calculateHaversineDistance(
  point1: Coordinate,
  point2: Coordinate
): number {
  // Validate inputs
  if (!point1?.latitude || !point1?.longitude || !point2?.latitude || !point2?.longitude) {
    console.warn('[Haversine] Invalid coordinates provided:', { point1, point2 });
    return 0;
  }

  // Convert degrees to radians
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const lat1 = toRadians(point1.latitude);
  const lat2 = toRadians(point2.latitude);
  const deltaLat = toRadians(point2.latitude - point1.latitude);
  const deltaLon = toRadians(point2.longitude - point1.longitude);

  // Haversine formula
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Distance in meters
  const distance = EARTH_RADIUS_METERS * c;

  return distance;
}

/**
 * Format distance for display
 * @param meters Distance in meters
 * @returns Formatted string (e.g., "1.5 km" or "350 m")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Calculate bearing (direction) from point1 to point2
 * Returns bearing in degrees (0-360), where 0° is North
 * 
 * @param point1 Start coordinate
 * @param point2 End coordinate
 * @returns Bearing in degrees
 */
export function calculateBearing(point1: Coordinate, point2: Coordinate): number {
  if (!point1?.latitude || !point1?.longitude || !point2?.latitude || !point2?.longitude) {
    return 0;
  }

  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const toDegrees = (radians: number) => (radians * 180) / Math.PI;

  const lat1 = toRadians(point1.latitude);
  const lat2 = toRadians(point2.latitude);
  const deltaLon = toRadians(point2.longitude - point1.longitude);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  const bearing = toDegrees(Math.atan2(y, x));

  // Normalize to 0-360
  return (bearing + 360) % 360;
}

/**
 * Check if a point is within a certain radius of another point
 * 
 * @param point Point to check
 * @param center Center point
 * @param radiusMeters Radius in meters
 * @returns true if point is within radius
 */
export function isWithinRadius(
  point: Coordinate,
  center: Coordinate,
  radiusMeters: number
): boolean {
  const distance = calculateHaversineDistance(point, center);
  return distance <= radiusMeters;
}

