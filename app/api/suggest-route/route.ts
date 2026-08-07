import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Walking speed assumption: ~80 m/min (brisk walking).
const WALK_SPEED_M_PER_MIN = 80;

interface CandidatePoint {
  lng: number;
  lat: number;
  length_meters: number;
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
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Candidate unwalked streets from the seeded street_segments table
// (covers NYC only — seeded by scripts/prepare-streets.ts).
async function candidatesFromDb(
  lat: number,
  lng: number,
  radius: number
): Promise<CandidatePoint[]> {
  return (await query(
    `SELECT
       ST_X(ST_Centroid(ss.geom::geometry)) AS lng,
       ST_Y(ST_Centroid(ss.geom::geometry)) AS lat,
       ss.length_meters
     FROM street_segments ss
     LEFT JOIN walked_segments ws ON ss.osm_way_id = ws.osm_way_id
     WHERE ws.osm_way_id IS NULL
       AND ST_DWithin(ss.geom, ST_MakePoint($1, $2)::geography, $3)`,
    [lng, lat, radius]
  )) as unknown as CandidatePoint[];
}

interface OverpassWay {
  type: string;
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
}

type WalkedPt = { lat: number; lng: number };

async function nearbyWalkedPoints(
  lat: number,
  lng: number,
  radius: number
): Promise<WalkedPt[]> {
  const walked = (await query(
    `SELECT DISTINCT ROUND(lat::numeric, 4) AS lat, ROUND(lng::numeric, 4) AS lng
     FROM gps_points
     WHERE ST_DWithin(geom, ST_MakePoint($1, $2)::geography, $3)`,
    [lng, lat, radius]
  )) as unknown as Array<{ lat: string | number; lng: string | number }>;
  return walked.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
}

// Primary fallback outside NYC: Mapbox Tilequery on the streets
// tileset. First-party (same token as the map + Directions), no
// third-party rate limiting.
async function candidatesFromTilequery(
  lat: number,
  lng: number,
  radius: number,
  token: string,
  walkedPts: WalkedPt[]
): Promise<CandidatePoint[]> {
  const url =
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
    `?radius=${Math.round(radius)}&limit=50&layers=road&dedupe=true&access_token=${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Tilequery ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;

  const EXCLUDE = new Set([
    "motorway", "motorway_link", "trunk", "trunk_link", "service",
    "ferry", "aerialway", "golf",
  ]);

  const out: CandidatePoint[] = [];
  for (const f of data.features ?? []) {
    const cls = String((f.properties as Record<string, unknown> | null)?.class ?? "");
    if (EXCLUDE.has(cls)) continue;

    const g = f.geometry;
    let coords: number[][] = [];
    if (g.type === "LineString") coords = g.coordinates as number[][];
    else if (g.type === "MultiLineString") coords = (g.coordinates as number[][][]).flat();
    else if (g.type === "Point") coords = [g.coordinates as number[]];
    if (coords.length === 0) continue;

    let length = 0;
    for (let i = 1; i < coords.length; i++) {
      length += haversineMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    }
    if (coords.length >= 2 && length < 20) continue;

    const mid = coords[Math.floor(coords.length / 2)];
    const isWalked = walkedPts.some(
      (p) => haversineMeters(p.lat, p.lng, mid[1], mid[0]) < 25
    );
    if (isWalked) continue;

    // Point-only results have no measurable length; assume a short block.
    out.push({ lng: mid[0], lat: mid[1], length_meters: Math.max(length, 50) });
  }
  return out;
}

// Last-resort fallback: OpenStreetMap via the Kumi Overpass mirror
// (the main overpass-api.de instance rate-limits datacenter IPs).
async function candidatesFromOsm(
  lat: number,
  lng: number,
  radius: number,
  walkedPts: WalkedPt[]
): Promise<CandidatePoint[]> {
  const overpassQuery =
    `[out:json][timeout:8];` +
    `way["highway"~"^(residential|tertiary|secondary|primary|footway|path|pedestrian|living_street|unclassified)$"]` +
    `(around:${Math.round(radius)},${lat},${lng});out geom;`;

  const res = await fetch("https://overpass.kumi.systems/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(overpassQuery)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = (await res.json()) as { elements?: OverpassWay[] };

  const candidates: CandidatePoint[] = [];
  for (const way of data.elements ?? []) {
    const geom = way.geometry;
    if (!geom || geom.length < 2) continue;

    let length = 0;
    for (let i = 1; i < geom.length; i++) {
      length += haversineMeters(
        geom[i - 1].lat, geom[i - 1].lon,
        geom[i].lat, geom[i].lon
      );
    }
    if (length < 20) continue;

    const mid = geom[Math.floor(geom.length / 2)];
    const isWalked = walkedPts.some(
      (p) => haversineMeters(p.lat, p.lng, mid.lat, mid.lon) < 25
    );
    if (isWalked) continue;

    candidates.push({ lng: mid.lon, lat: mid.lat, length_meters: length });
  }
  return candidates;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userLat = parseFloat(searchParams.get("lat") ?? "");
  const userLng = parseFloat(searchParams.get("lng") ?? "");
  const durationMin = parseFloat(searchParams.get("duration") ?? "45");

  if (!isFinite(userLat) || !isFinite(userLng)) {
    return Response.json(
      { error: "lat and lng query params required" },
      { status: 400 }
    );
  }

  const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();
  if (!token) {
    return Response.json(
      { error: "NEXT_PUBLIC_MAPBOX_TOKEN not set" },
      { status: 500 }
    );
  }

  try {
    const targetDistM = durationMin * WALK_SPEED_M_PER_MIN;
    const searchRadius = Math.min(targetDistM / 2, 2000);

    // Seeded NYC data first; outside NYC fall back to live street
    // lookups: Mapbox Tilequery (first-party, reliable), then an
    // Overpass mirror as a last resort.
    let rows = await candidatesFromDb(userLat, userLng, searchRadius);
    if (rows.length < 3) {
      const walkedPts = await nearbyWalkedPoints(userLat, userLng, searchRadius * 2);
      try {
        rows = await candidatesFromTilequery(userLat, userLng, searchRadius, token, walkedPts);
      } catch (e) {
        console.error("Tilequery fallback error:", e);
      }
      if (rows.length < 3) {
        try {
          rows = await candidatesFromOsm(userLat, userLng, searchRadius, walkedPts);
        } catch (e) {
          console.error("OSM fallback error:", e);
        }
      }
    }

    if (rows.length < 3) {
      return Response.json({
        error: "Couldn't find enough streets nearby to build a route — try again in a minute.",
        unwalked_count: rows.length,
      });
    }

    // Grid-bin to find the densest cluster of unwalked streets.
    const CELL_SIZE = 0.002; // ~200m in degrees
    const cells = new Map<string, { lng: number; lat: number; meters: number; count: number }>();
    for (const r of rows) {
      const cx = Math.floor(r.lng / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
      const cy = Math.floor(r.lat / CELL_SIZE) * CELL_SIZE + CELL_SIZE / 2;
      const key = `${cx},${cy}`;
      const cell = cells.get(key) ?? { lng: cx, lat: cy, meters: 0, count: 0 };
      cell.meters += Number(r.length_meters);
      cell.count += 1;
      cells.set(key, cell);
    }

    // Pick the cell with most unwalked meters as the target.
    let best = { lng: userLng, lat: userLat, meters: 0, count: 0 };
    for (const c of cells.values()) {
      if (c.meters > best.meters) best = c;
    }

    // Build loop waypoints: target + two flanking points.
    const bearingToTarget = bearing(userLat, userLng, best.lat, best.lng);
    const idealDist = targetDistM / 4;

    const wp1 = pointAtBearing(userLat, userLng, bearingToTarget - 50, idealDist);
    const wp2 = { lat: best.lat, lng: best.lng };
    const wp3 = pointAtBearing(userLat, userLng, bearingToTarget + 50, idealDist);

    // Snap waypoints to nearest unwalked segment for relevance.
    const waypoints = [
      snapToNearest(wp1, rows) ?? wp1,
      snapToNearest(wp2, rows) ?? wp2,
      snapToNearest(wp3, rows) ?? wp3,
    ];

    // Mapbox Directions: user → wp1 → wp2 → wp3 → user.
    const coords = [
      `${userLng},${userLat}`,
      ...waypoints.map((w) => `${w.lng},${w.lat}`),
      `${userLng},${userLat}`,
    ].join(";");

    const dirUrl =
      `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
      `?geometries=geojson&overview=full&access_token=${token}`;

    const dirRes = await fetch(dirUrl);
    if (!dirRes.ok) {
      const errText = await dirRes.text();
      console.error("Mapbox Directions error:", errText);
      return Response.json({ error: "Mapbox routing failed" }, { status: 502 });
    }

    const dirData = (await dirRes.json()) as {
      routes?: Array<{
        geometry: GeoJSON.LineString;
        distance: number;
        duration: number;
      }>;
    };

    const route = dirData.routes?.[0];
    if (!route) {
      return Response.json({ error: "No route found" }, { status: 404 });
    }

    return Response.json({
      route: {
        type: "Feature",
        geometry: route.geometry,
        properties: {},
      },
      distance_m: Math.round(route.distance),
      distance_miles: Number((route.distance / 1609.34).toFixed(2)),
      duration_min: Math.round(route.duration / 60),
      unwalked_nearby: rows.length,
      waypoints,
    });
  } catch (error) {
    console.error("Suggest route error:", error);
    return Response.json({ error: "failed to generate route" }, { status: 500 });
  }
}

function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function pointAtBearing(
  lat: number,
  lng: number,
  bearingDeg: number,
  distM: number
): { lat: number; lng: number } {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distM / R) +
      Math.cos(lat1) * Math.sin(distM / R) * Math.cos(brng)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distM / R) * Math.cos(lat1),
      Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: toDeg(lat2), lng: toDeg(lng2) };
}

function snapToNearest(
  target: { lat: number; lng: number },
  points: CandidatePoint[]
): { lat: number; lng: number } | null {
  let best: CandidatePoint | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    const d = (p.lat - target.lat) ** 2 + (p.lng - target.lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}
