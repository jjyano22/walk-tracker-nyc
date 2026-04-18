import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import {
  classifySegments,
  isWalkable,
  loadModes,
  type RawPoint,
} from "@/lib/walkClassify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

    const points: RawPoint[] = (
      rows as unknown as Array<{
        lat: string | number;
        lng: string | number;
        timestamp: string;
      }>
    ).map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      timestamp: r.timestamp,
      ts: new Date(r.timestamp).getTime(),
    }));

    const allSegments = classifySegments(points, modes);
    const walkSegments = allSegments.filter(isWalkable);

    const features = walkSegments.map((s) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [s.a.lng, s.a.lat],
          [s.b.lng, s.b.lat],
        ],
      },
      properties: {
        speed_mps: Number(s.speedMps.toFixed(2)),
        distance_m: Math.round(s.distanceM),
        duration_s: Math.round(s.durationS),
        start_time: s.startTime,
        end_time: s.endTime,
        mode: s.manualMode,
      },
    }));

    const summary = {
      total_segments: features.length,
      total_points: points.length,
      excluded_segments: allSegments.length - walkSegments.length,
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
