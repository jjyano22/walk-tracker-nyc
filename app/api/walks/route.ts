import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import {
  classifySegments,
  isWalkable,
  loadModes,
  type RawPoint,
  type Segment,
} from "@/lib/walkClassify";

export const dynamic = "force-dynamic";

// Round coordinates to ~1m precision to shrink the JSON payload.
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

interface SessionFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    start_time: string;
    end_time: string;
    distance_m: number;
    duration_s: number;
    point_count: number;
  };
}

// Merge contiguous walkable segments (prev.bIdx === next.aIdx) into
// one LineString per walking session. Cuts feature count from one-
// per-GPS-pair (thousands) to one-per-walk (dozens), which is the
// main driver of payload size and map render time.
function mergeSessions(segments: Segment[]): SessionFeature[] {
  const sessions: SessionFeature[] = [];
  let coords: number[][] = [];
  let startTime = "";
  let endTime = "";
  let distance = 0;
  let duration = 0;
  let lastBIdx = -1;

  const flush = () => {
    if (coords.length >= 2) {
      sessions.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: {
          start_time: startTime,
          end_time: endTime,
          distance_m: Math.round(distance),
          duration_s: Math.round(duration),
          point_count: coords.length,
        },
      });
    }
    coords = [];
    distance = 0;
    duration = 0;
    lastBIdx = -1;
  };

  for (const s of segments) {
    if (!isWalkable(s)) {
      flush();
      continue;
    }
    if (coords.length === 0 || s.aIdx !== lastBIdx) {
      flush();
      coords.push([round5(s.a.lng), round5(s.a.lat)]);
      startTime = s.startTime;
    }
    coords.push([round5(s.b.lng), round5(s.b.lat)]);
    endTime = s.endTime;
    distance += s.distanceM;
    duration += s.durationS;
    lastBIdx = s.bIdx;
  }
  flush();

  return sessions;
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

    const allSegments = classifySegments(points, modes);
    const features = mergeSessions(allSegments);

    const summary = {
      total_sessions: features.length,
      total_points: points.length,
      excluded_segments: allSegments.filter((s) => !isWalkable(s)).length,
    };
    console.log("[walks] summary", summary);

    return Response.json(
      {
        type: "FeatureCollection",
        features,
        _summary: summary,
      },
      {
        headers: {
          // Serve from Vercel's CDN for a minute; refresh in the
          // background. Repeat opens are instant; new walks appear
          // within ~60s without any client change.
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        },
      }
    );
  } catch (error) {
    console.error("Walks API error:", error);
    return Response.json(
      { type: "FeatureCollection", features: [] },
      { status: 500 }
    );
  }
}
