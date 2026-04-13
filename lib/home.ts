// Home-area exclusion helpers.
//
// Configure via env vars:
//   HOME_LAT                e.g. 40.6782
//   HOME_LNG                e.g. -73.9442
//   HOME_RADIUS_METERS      default 100
//
// When lat/lng are unset, filters become no-ops so the app works without config.

export interface HomeConfig {
  lat: number;
  lng: number;
  radius: number;
}

export function getHome(): HomeConfig | null {
  const lat = parseFloat(process.env.HOME_LAT ?? "");
  const lng = parseFloat(process.env.HOME_LNG ?? "");
  const radius = parseFloat(process.env.HOME_RADIUS_METERS ?? "100");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return { lat, lng, radius };
}

/**
 * Returns a SQL boolean expression that is TRUE when the given geography
 * column is OUTSIDE the configured home radius. Safe to inline: the env
 * values are validated as finite numbers before being stringified.
 *
 * If no home is configured, returns "TRUE" so the filter is a no-op.
 */
export function homeExclusionSql(geomCol: string = "geom"): string {
  const home = getHome();
  if (!home) return "TRUE";
  return `NOT ST_DWithin(${geomCol}, ST_MakePoint(${home.lng}, ${home.lat})::geography, ${home.radius})`;
}

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** True when (lat, lng) is inside the configured home radius. */
export function isWithinHome(lat: number, lng: number): boolean {
  const home = getHome();
  if (!home) return false;
  return haversineMeters(lat, lng, home.lat, home.lng) <= home.radius;
}
