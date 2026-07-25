/**
 * Format currency amount — delegates to the app-wide currency formatter so
 * Home + all its cards use the same currency as the rest of the app.
 */
export { formatCurrency } from "../../../config/currency";

/**
 * Format duration in seconds to human-readable format
 */
export const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

/**
 * Format duration with seconds for shift timer labels
 */
export const formatShiftDuration = (seconds: number): string => {
  const normalizedSeconds = Number.isFinite(seconds) ? seconds : 0;
  const totalSeconds = Math.max(0, Math.round(normalizedSeconds));

  if (totalSeconds <= 0) {
    return "0s";
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${secs.toString().padStart(2, "0")}s`);
  return parts.join(" ");
};

/**
 * Normalize map provider string to ensure consistent format
 */
export const normalizeMapProvider = (provider: string | undefined): "NATIVE" | "GOOGLE_MAPS" => {
  if (!provider) return "NATIVE";
  const upper = provider.toUpperCase();
  if (upper === "GOOGLE_MAPS" || upper === "GOOGLE") return "GOOGLE_MAPS";
  return "NATIVE";
};
