import { GOOGLE_MAPS_API_KEY, MAPS_CONFIG } from "../config/maps";

export type PlaceSuggestion = {
  id: string;
  title: string;
  subtitle?: string;
  address: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  source: "google" | "osm";
};

const isGoogleConfigured =
  typeof GOOGLE_MAPS_API_KEY === "string" &&
  GOOGLE_MAPS_API_KEY.trim().length > 0 &&
  !GOOGLE_MAPS_API_KEY.includes("XXXX");

const NOMINATIM_HEADERS = {
  "User-Agent": "TaxiTimeDriver/1.0 (+support@taxitime.app)",
};

const buildQueryString = (params: Record<string, string | number | undefined>) =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&");

const sanitizeCoordinate = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed =
    typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const searchPlaces = async (
  query: string,
  options?: { latitude?: number; longitude?: number }
): Promise<PlaceSuggestion[]> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  try {
    if (isGoogleConfigured) {
      const queryString = buildQueryString({
        query: trimmedQuery,
        key: GOOGLE_MAPS_API_KEY,
        language: "en",
        location:
          typeof options?.latitude === "number" &&
          typeof options?.longitude === "number"
            ? `${options.latitude},${options.longitude}`
            : undefined,
        radius:
          typeof options?.latitude === "number" &&
          typeof options?.longitude === "number"
            ? "40000"
            : undefined,
      });

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/textsearch/json?${queryString}`
      );
      const payload = await response.json();

      if (payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
        console.warn(
          "⚠️ Google Places search failed:",
          payload.status,
          payload.error_message
        );
        return [];
      }

      const results: PlaceSuggestion[] = (payload.results || []).slice(0, 8).map(
        (result: any) => ({
          id: result.place_id || result.id || result.reference,
          title: result.name || result.formatted_address || trimmedQuery,
          subtitle: result.formatted_address || result.vicinity || undefined,
          address: result.formatted_address || result.name || "Pinned location",
          latitude: result.geometry?.location?.lat ?? 0,
          longitude: result.geometry?.location?.lng ?? 0,
          placeId: result.place_id,
          source: "google",
        })
      );

      return results.filter(
        (item) =>
          Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
      );
    }

    const params: Record<string, string> = {
      q: trimmedQuery,
      format: "json",
      addressdetails: "1",
      limit: "8",
    };

    if (
      typeof options?.latitude === "number" &&
      typeof options?.longitude === "number"
    ) {
      params.viewbox = [
        options.longitude - 0.25,
        options.latitude + 0.25,
        options.longitude + 0.25,
        options.latitude - 0.25,
      ].join(",");
      params.bounded = "1";
    }

    const osmResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?${buildQueryString(params)}`,
      {
        headers: NOMINATIM_HEADERS,
      }
    );
    const osmPayload = await osmResponse.json();

    return (osmPayload || []).map((entry: any) => ({
      id:
        entry.place_id?.toString() ||
        entry.osm_id?.toString() ||
        entry.display_name,
      title: entry.display_name?.split(",")?.[0]?.trim() || trimmedQuery,
      subtitle: entry.display_name,
      address: entry.display_name || trimmedQuery,
      latitude: sanitizeCoordinate(
        entry.lat,
        MAPS_CONFIG.defaultRegion.latitude
      ),
      longitude: sanitizeCoordinate(
        entry.lon,
        MAPS_CONFIG.defaultRegion.longitude
      ),
      source: "osm",
    }));
  } catch (error) {
    console.error("❌ Place search failed:", error);
    return [];
  }
};

export const reverseGeocode = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  try {
    if (isGoogleConfigured) {
      const queryString = buildQueryString({
        latlng: `${latitude},${longitude}`,
        key: GOOGLE_MAPS_API_KEY,
        language: "en",
      });

      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?${queryString}`
      );
      const payload = await response.json();
      if (payload.status !== "OK") {
        console.warn(
          "⚠️ Google reverse geocode failed:",
          payload.status,
          payload.error_message
        );
        return null;
      }

      return payload.results?.[0]?.formatted_address ?? null;
    }

    const params = buildQueryString({
      format: "json",
      lat: latitude,
      lon: longitude,
      addressdetails: "1",
    });

    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      {
        headers: NOMINATIM_HEADERS,
      }
    );
    const payload = await response.json();
    return payload?.display_name ?? null;
  } catch (error) {
    console.error("❌ Reverse geocode failed:", error);
    return null;
  }
};
