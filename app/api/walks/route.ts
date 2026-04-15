import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

// Always evaluate at request time — no CDN caching of this endpoint,
// so changes to the data or the client-side rendering take effect
// immediately on the next page load.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Gap between consecutive GPS fixes at which we stop drawing a line.
// Anything longer is almost certainly phone-off or signal-loss noise.
const SESSION_GAP_SECONDS = 5 * 60;

interface Point {
  lat: number;
  lng: number;
  timestamp: string;
}

interface SegmentFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
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

    // Emit one feature per consecutive-point pair, tagged with its speed.
    // The map paints each segment on a color gradient from cyan (slow) to
    // purple (fast), so subway and car rides visually separate from foot
    // travel without any binary classification or tunable threshold.
    const features: SegmentFeature[] = [];
    let maxSpeed = 0;
    let fastCount = 0; // >2 m/s — anything faster than brisk walking

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dtSec =
        (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) /
        1000;
      if (dtSec <= 0 || dtSec > SESSION_GAP_SECONDS) continue;

      const distM = haversineMeters(a, b);
      if (distM <= 0) continue;

      const speedMps = distM / dtSec;
      if (speedMps > maxSpeed) maxSpeed = speedMps;
      if (speedMps > 2) fastCount += 1;

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
      fast_segments: fastCount,
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
