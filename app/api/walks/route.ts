import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

// Always evaluate at request time — no CDN caching of this endpoint.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Gap between consecutive GPS fixes at which we stop drawing a line.
const SESSION_GAP_SECONDS = 5 * 60;

interface Point {
  lat: number;
  lng: number;
  timestamp: string;
  ts: number; // epoch ms cache
}

interface ModeRange {
  start: number;
  end: number;
  mode: string;
}

interface SegmentFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    mode: string | null; // "walk" | "subway" | "car" | "bike" | null
    speed_mps: number;
    distance_m: number;
    duration_s: number;
    start_time: string;
    end_time: string;
  };
}

function haversineMeters(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadModes(): Promise<ModeRange[]> {
  try {
    const rows = (await query(
      `SELECT start_ts, end_ts, mode FROM gps_modes ORDER BY created_at DESC`
    )) as unknown as Array<{ start_ts: string; end_ts: string; mode: string }>;
    return rows.map((r) => ({
      start: new Date(r.start_ts).getTime(),
      end: new Date(r.end_ts).getTime(),
      mode: r.mode,
    }));
  } catch {
    // Table doesn't exist yet — nothing is overridden.
    return [];
  }
}

// Resolve a timestamp against the override list. Newest (lower index
// given our ORDER BY created_at DESC) wins. Returns null if no
// override covers the timestamp, or if the covering override is "auto".
function resolveMode(ts: number, modes: ModeRange[]): string | null {
  for (const m of modes) {
    if (ts >= m.start && ts <= m.end) {
      return m.mode === "auto" ? null : m.mode;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");
  const before = searchParams.get("before");

  try {
    const conditions: string[] = [homeExclusionSql()];
    if (after) conditions.push(`timestamp >= '${after}'`);
    if (before) conditions.push(`timestamp <= '${before}'`);
    const where = `WHERE ${conditions.join(" AND ")}`;

    const [rows, modes] = await Promise.all([
      query(
        `SELECT lat, lng, timestamp FROM gps_points ${where} ORDER BY timestamp ASC`
      ),
      loadModes(),
    ]);

    const points: Point[] = (rows as unknown as Array<{
      lat: string | number;
      lng: string | number;
      timestamp: string;
    }>).map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      timestamp: r.timestamp,
      ts: new Date(r.timestamp).getTime(),
    }));

    // One feature per consecutive-point pair. Each feature carries
    // speed_mps for auto-coloring and a manual mode (when set) that
    // overrides the gradient.
    const features: SegmentFeature[] = [];
    let maxSpeed = 0;
    let manualCount = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dtSec = (b.ts - a.ts) / 1000;
      if (dtSec <= 0 || dtSec > SESSION_GAP_SECONDS) continue;

      const distM = haversineMeters(a, b);
      if (distM <= 0) continue;

      const speedMps = distM / dtSec;
      if (speedMps > maxSpeed) maxSpeed = speedMps;

      // A segment's mode comes from its midpoint's resolved override.
      const midTs = (a.ts + b.ts) / 2;
      const mode = resolveMode(midTs, modes);
      if (mode) manualCount += 1;

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [a.lng, a.lat],
            [b.lng, b.lat],
          ],
        },
        properties: {
          mode,
          speed_mps: Number(speedMps.toFixed(2)),
          distance_m: Math.round(distM),
          duration_s: Math.round(dtSec),
          start_time: a.timestamp,
          end_time: b.timestamp,
        },
      });
    }

    const summary = {
      total_segments: features.length,
      total_points: points.length,
      max_speed_mps: Number(maxSpeed.toFixed(2)),
      manual_segments: manualCount,
      mode_overrides: modes.length,
    };
    console.log("[walks] summary", summary);

    return Response.json({
      type: "FeatureCollection",
      features,
      _summary: summary,
    });
  } catch (error) {
    console.error("Walks API error:", error);
    return Response.json(
      { type: "FeatureCollection", features: [] },
      { status: 500 }
    );
  }
}
