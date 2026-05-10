import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Walking speed assumption: ~80 m/min (brisk NYC walking).
const WALK_SPEED_M_PER_MIN = 80;

interface UnwalkedPoint {
  lng: number;
  lat: number;
  length_meters: number;
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

    // Find unwalked street segment centroids nearby.
    const rows = (await query(
      `SELECT
         ST_X(ST_Centroid(ss.geom::geometry)) AS lng,
         ST_Y(ST_Centroid(ss.geom::geometry)) AS lat,
         ss.length_meters
       FROM street_segments ss
       LEFT JOIN walked_segments ws ON ss.osm_way_id = ws.osm_way_id
       WHERE ws.osm_way_id IS NULL
         AND ST_DWithin(ss.geom, ST_MakePoint($1, $2)::geography, $3)`,
      [userLng, userLat, searchRadius]
    )) as unknown as UnwalkedPoint[];

    if (rows.length < 3) {
      return Response.json({
        error: "Not enough unwalked streets nearby. Try a different area!",
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

    // Build loop waypoints: target + two flanking points at ±60°.
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

    // Build Mapbox Directions request: user → wp1 → wp2 → wp3 → user.
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
      return Response.json(
        { error: "Mapbox routing failed" },
        { status: 502 }
      );
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
      return Response.json(
        { error: "No route found" },
        { status: 404 }
      );
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
  points: UnwalkedPoint[]
): { lat: number; lng: number } | null {
  let best: UnwalkedPoint | null = null;
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
