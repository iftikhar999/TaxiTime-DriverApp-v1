/**
 * Centralized Vehicle Icon Mapping Utility for Driver App
 * Maps vehicle types to their corresponding SVG icons
 */

export type VehicleType = "sedan" | "suv" | "van" | "motorcycle";

// Vehicle type mapping - maps various input formats to standardized vehicle types
const VEHICLE_TYPE_MAPPING: Record<string, VehicleType> = {
  // Standard types
  sedan: "sedan",
  suv: "suv",
  van: "van",
  motorcycle: "motorcycle",

  // Common variations
  car: "sedan",
  taxi: "sedan",
  saloon: "sedan",
  hatchback: "sedan",
  coupe: "sedan",

  truck: "van",
  pickup: "van",
  minivan: "van",
  bus: "van",

  bike: "motorcycle",
  motorbike: "motorcycle",
  scooter: "motorcycle",

  // Uppercase variations
  SEDAN: "sedan",
  SUV: "suv",
  VAN: "van",
  MOTORCYCLE: "motorcycle",
  CAR: "sedan",
  TRUCK: "van",
  BIKE: "motorcycle",
};

/**
 * Get the standardized vehicle type from various input formats
 */
export const getVehicleType = (vehicleType?: string | null): VehicleType => {
  if (!vehicleType) return "sedan"; // Default fallback

  const normalized = vehicleType.toLowerCase().trim();
  return VEHICLE_TYPE_MAPPING[normalized] || "sedan";
};

/**
 * Get display name for vehicle type
 */
export const getVehicleDisplayName = (vehicleType?: string | null): string => {
  const type = getVehicleType(vehicleType);

  const displayNames: Record<VehicleType, string> = {
    sedan: "Sedan",
    suv: "SUV",
    van: "Van",
    motorcycle: "Motorcycle",
  };

  return displayNames[type];
};

/**
 * Get vehicle type color (matching the SVG gradients)
 */
export const getVehicleTypeColor = (vehicleType?: string | null): string => {
  const type = getVehicleType(vehicleType);

  const colors: Record<VehicleType, string> = {
    sedan: "#3D76F0", // Blue (matches sedan SVG)
    suv: "#2FBC7A", // Green (matches SUV SVG)
    van: "#FF9F3C", // Orange (matches van SVG)
    motorcycle: "#F15B6C", // Red/Pink (matches motorcycle SVG)
  };

  return colors[type];
};
