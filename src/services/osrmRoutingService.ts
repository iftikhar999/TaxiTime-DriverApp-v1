// Free road-following routing via OSRM's public demo server (OpenStreetMap).
// No API key, no billing. Used instead of Google Directions so the path on the
// map follows actual roads, Uber-style.

export type LatLng = { latitude: number; longitude: number };

export type OsrmRoute = {
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
};

const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";

// Module-scope cache: key is "lon1,lat1;lon2,lat2;...". We refetch only when
// the driver has moved enough that the geometry would materially change.
const cache = new Map<string, { ts: number; data: OsrmRoute }>();
const CACHE_TTL_MS = 60_000; // 60s is plenty for in-ride display

const buildKey = (points: LatLng[]) =>
  points.map((p) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`).join(";");

export async function fetchOsrmRoute(
  points: LatLng[],
  opts?: { signal?: AbortSignal },
): Promise<OsrmRoute | null> {
  if (!points || points.length < 2) return null;

  const key = buildKey(points);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const coords = points
    .map((p) => `${p.longitude},${p.latitude}`)
    .join(";");

  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&continue_straight=true`;

  const res = await fetch(url, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`OSRM HTTP ${res.status}`);
  }
  const json: any = await res.json();
  if (json?.code !== "Ok" || !Array.isArray(json.routes) || json.routes.length === 0) {
    return null;
  }

  const r = json.routes[0];
  const geom = r?.geometry?.coordinates;
  if (!Array.isArray(geom) || geom.length < 2) return null;

  const data: OsrmRoute = {
    coordinates: geom.map((c: [number, number]) => ({
      longitude: c[0],
      latitude: c[1],
    })),
    distanceMeters: Number(r.distance) || 0,
    durationSeconds: Number(r.duration) || 0,
  };

  cache.set(key, { ts: Date.now(), data });
  return data;
}
