import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

// Always evaluate at request time — no caching, so tuning thresholds
// takes effect on the next page load.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Speed threshold separating walking from transit.
// Normal walking ~1.4 m/s, brisk walk ~1.8 m/s, jogging ~3 m/s.
// Anything averaging faster than 2 m/s across a segment is almost
// certainly not on foot for a casual walker.
const TRANSIT_SPEED_MPS = 2;

// Long single-segment jumps are also treated as transit regardless of
// computed speed — e.g. the phone loses GPS in a tunnel and the next
// fix is miles away. 150m between consecutive fixes is well outside
// normal Overland sampling at walking pace.
const TRANSIT_JUMP_METERS = 150;

// Gap between consecutive GPS fixes at which we end the current feature
// and start a new one (so we don't draw a line across hours of inactivity).
const SESSION_GAP_SECONDS = 5 * 60;

interface Point {
  lat: number;
  lng: number;
  timestamp: string;
}

type Mode = "walk" | "transit";

interface WalkFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    mode: Mode;
    start_time: string;
    end_time: string;
    point_count: number;
    distance_m: number;
    duration_s: number;
    avg_speed_mps: number;
    max_speed_mps: number;
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");
  const before = searchParams.get("before");

  try {
    const conditions: string[] = [homeExclusionSql()];
    if (after) conditions.push(`timestamp >= '${after}'`);
    if (before) conditions.push(`timestamp <= '${before}'`);
    const where = `WHERE ${conditions.join(" AND ")}`;

    const rows = await query(`
      SELECT lat, lng, timestamp FROM gps_points ${where} ORDER BY timestamp ASC
    `);

    const points: Point[] = rows.map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      timestamp: r.timestamp as string,
    }));

    const features: WalkFeature[] = [];
    let currentCoords: number[][] = [];
    let currentTimes: string[] = [];
    let currentMode: Mode | null = null;
    let currentDistance = 0;
    let currentDuration = 0;
    let currentMaxSpeed = 0;

    const flush = () => {
      if (currentCoords.length >= 2 && currentMode !== null) {
        features.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: currentCoords },
          properties: {
            mode: currentMode,
            start_time: currentTimes[0],
            end_time: currentTimes[currentTimes.length - 1],
            point_count: currentCoords.length,
            distance_m: Math.round(currentDistance),
            duration_s: Math.round(currentDuration),
            avg_speed_mps:
              currentDuration > 0
                ? Number((currentDistance / currentDuration).toFixed(2))
                : 0,
            max_speed_mps: Number(currentMaxSpeed.toFixed(2)),
          },
        });
      }
      currentCoords = [];
      currentTimes = [];
      currentMode = null;
      currentDistance = 0;
      currentDuration = 0;
      currentMaxSpeed = 0;
    };

    // Walk through consecutive points, classifying each segment and
    // emitting a feature whenever the mode changes or a gap appears.
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dtSec =
        (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) /
        1000;

      if (dtSec > SESSION_GAP_SECONDS) {
        // Long pause: close the current feature without bridging the gap.
        flush();
        continue;
      }

      const distM = haversineMeters(a, b);
      const speedMps = dtSec > 0 ? distM / dtSec : 0;
      // Classify as transit if the segment is either too fast OR covers
      // more ground than normal walking sampling can explain.
      const segMode: Mode =
        speedMps > TRANSIT_SPEED_MPS || distM > TRANSIT_JUMP_METERS
          ? "transit"
          : "walk";

      if (currentMode === null) {
        // Starting a fresh feature — seed with point `a`.
        currentMode = segMode;
        currentCoords.push([a.lng, a.lat]);
        currentTimes.push(a.timestamp);
      } else if (currentMode !== segMode) {
        // Mode change at point `a`. Close the previous feature (which
        // already ends with `a`) and start a new one that begins at `a`,
        // so the two LineStrings touch at the junction.
        flush();
        currentMode = segMode;
        currentCoords.push([a.lng, a.lat]);
        currentTimes.push(a.timestamp);
      }

      currentCoords.push([b.lng, b.lat]);
      currentTimes.push(b.timestamp);
      currentDistance += distM;
      currentDuration += dtSec;
      if (speedMps > currentMaxSpeed) currentMaxSpeed = speedMps;
    }
    flush();

    const summary = {
      total_features: features.length,
      walk_features: features.filter((f) => f.properties.mode === "walk").length,
      transit_features: features.filter((f) => f.properties.mode === "transit")
        .length,
      total_points: points.length,
      thresholds: {
        transit_speed_mps: TRANSIT_SPEED_MPS,
        transit_jump_meters: TRANSIT_JUMP_METERS,
        session_gap_seconds: SESSION_GAP_SECONDS,
      },
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
