import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import {
  classifySegments,
  loadModes,
  type RawPoint,
} from "@/lib/walkClassify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface SegmentFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    mode: string | null;
    run_type: "walk" | "transit";
    run_total_m: number;
    speed_mps: number;
    distance_m: number;
    duration_s: number;
    start_time: string;
    end_time: string;
  };
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

    const segments = classifySegments(points, modes);

    const features: SegmentFeature[] = segments.map((s) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [s.a.lng, s.a.lat],
          [s.b.lng, s.b.lat],
        ],
      },
      properties: {
        mode: s.manualMode,
        run_type: s.runType,
        run_total_m: Math.round(s.runTotalM),
        speed_mps: Number(s.speedMps.toFixed(2)),
        distance_m: Math.round(s.distanceM),
        duration_s: Math.round(s.durationS),
        start_time: s.startTime,
        end_time: s.endTime,
      },
    }));

    const maxSpeed = segments.reduce(
      (m, s) => (s.speedMps > m ? s.speedMps : m),
      0
    );
    const manualCount = segments.filter((s) => s.manualMode !== null).length;
    const transitSegCount = segments.filter(
      (s) => s.runType === "transit"
    ).length;

    const summary = {
      total_segments: segments.length,
      total_points: points.length,
      max_speed_mps: Number(maxSpeed.toFixed(2)),
      manual_segments: manualCount,
      mode_overrides: modes.length,
      transit_segments: transitSegCount,
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
