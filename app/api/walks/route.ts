import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

// Always evaluate at request time — no CDN caching of this endpoint.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Gap between consecutive GPS fixes at which we stop drawing a line.
const SESSION_GAP_SECONDS = 5 * 60;

// A segment qualifies as "fast" for run-detection purposes when it's
// above walking pace AND long enough to not be GPS jitter.
const RUN_FAST_MPS = 2;
const RUN_MIN_SEG_METERS = 30;
const RUN_CONTIGUOUS_GAP_SECONDS = 60;

// Minimum total distance for a run of fast segments to count as real
// transit (subway, car, bike). Short bursts stay cyan because a real
// subway or car ride covers several blocks at minimum.
const TRANSIT_RUN_MIN_METERS = 500;

interface Point {
  lat: number;
  lng: number;
  timestamp: string;
  ts: number;
}

interface ModeRange {
  start: number;
  end: number;
  mode: string;
}

type RunType = "walk" | "transit";

interface SegmentFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: number[][] };
  properties: {
    mode: string | null;
    run_type: RunType;
    run_total_m: number;
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
    return [];
  }
}

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

    // First pass: build one feature per consecutive-point pair.
    const features: SegmentFeature[] = [];
    let maxSpeed = 0;

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];

      const dtSec = (b.ts - a.ts) / 1000;
      if (dtSec <= 0 || dtSec > SESSION_GAP_SECONDS) continue;

      const distM = haversineMeters(a, b);
      if (distM <= 0) continue;

      const speedMps = distM / dtSec;
      if (speedMps > maxSpeed) maxSpeed = speedMps;

      const midTs = (a.ts + b.ts) / 2;
      const mode = resolveMode(midTs, modes);

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
          // Filled in during second pass:
          run_type: "walk",
          run_total_m: 0,
          speed_mps: Number(speedMps.toFixed(2)),
          distance_m: Math.round(distM),
          duration_s: Math.round(dtSec),
          start_time: a.timestamp,
          end_time: b.timestamp,
        },
      });
    }

    // Second pass: detect runs of contiguous fast segments, measure
    // each run's total distance, and label every feature in the run
    // with run_type and run_total_m. Short fast bursts end up labeled
    // "walk" so GPS noise / brief speed spikes don't render as purple.
    let transitRunCount = 0;
    let i = 0;
    while (i < features.length) {
      const f = features[i];
      const isFast =
        f.properties.speed_mps > RUN_FAST_MPS &&
        f.properties.distance_m >= RUN_MIN_SEG_METERS;
      if (!isFast) {
        f.properties.run_type = "walk";
        f.properties.run_total_m = f.properties.distance_m;
        i += 1;
        continue;
      }

      // Find the end of this fast run.
      let runEnd = i;
      let runTotal = f.properties.distance_m;
      while (runEnd + 1 < features.length) {
        const curr = features[runEnd];
        const next = features[runEnd + 1];
        const gap =
          (new Date(next.properties.start_time).getTime() -
            new Date(curr.properties.end_time).getTime()) /
          1000;
        const nextFast =
          next.properties.speed_mps > RUN_FAST_MPS &&
          next.properties.distance_m >= RUN_MIN_SEG_METERS;
        if (nextFast && gap <= RUN_CONTIGUOUS_GAP_SECONDS) {
          runEnd += 1;
          runTotal += next.properties.distance_m;
        } else {
          break;
        }
      }

      const runType: RunType =
        runTotal >= TRANSIT_RUN_MIN_METERS ? "transit" : "walk";
      if (runType === "transit") transitRunCount += 1;
      for (let j = i; j <= runEnd; j++) {
        features[j].properties.run_type = runType;
        features[j].properties.run_total_m = Math.round(runTotal);
      }
      i = runEnd + 1;
    }

    const manualCount = features.filter(
      (f) => f.properties.mode !== null
    ).length;

    const summary = {
      total_segments: features.length,
      total_points: points.length,
      max_speed_mps: Number(maxSpeed.toFixed(2)),
      manual_segments: manualCount,
      mode_overrides: modes.length,
      transit_runs: transitRunCount,
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
