// Shared walk-classification logic. Builds segments between
// consecutive GPS fixes, groups them into contiguous "fast runs",
// labels each run as walk or transit by total distance, and resolves
// the user's manual mode overrides. Used by /api/walks (rendering)
// and /api/stats + /api/parks (walkable filtering).

import { query } from "@/lib/db";

// Gap between consecutive GPS fixes at which the drawn line / walked
// segment chain is broken. Matches SESSION_GAP_SECONDS elsewhere.
export const SESSION_GAP_SECONDS = 5 * 60;

// Classification thresholds. Tuned so:
//  * GPS jitter in urban canyons (tiny < 30m jumps) stays labeled walk
//    regardless of computed speed.
//  * Brief speed spikes under 500m total (sprint, scooter drive-by,
//    short car hop) stay walk.
//  * Real multi-block transit (subway, car, bike) gets run_type=transit.
const RUN_FAST_MPS = 2;
const RUN_MIN_SEG_METERS = 30;
const RUN_CONTIGUOUS_GAP_SECONDS = 60;
const TRANSIT_RUN_MIN_METERS = 500;

export interface RawPoint {
  id?: number;
  lat: number;
  lng: number;
  timestamp: string;
  ts: number;
}

export interface ModeRange {
  start: number;
  end: number;
  mode: string;
}

export type RunType = "walk" | "transit";

export interface Segment {
  aIdx: number;
  bIdx: number;
  a: RawPoint;
  b: RawPoint;
  startTime: string;
  endTime: string;
  distanceM: number;
  durationS: number;
  speedMps: number;
  runType: RunType;
  runTotalM: number;
  manualMode: string | null;
}

export function haversineMeters(a: RawPoint, b: RawPoint): number {
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

export async function loadModes(): Promise<ModeRange[]> {
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

/**
 * Build the full segment list from an ordered list of GPS points.
 * Segments skip across gaps > SESSION_GAP_SECONDS. Each segment
 * carries its computed run_type (walk | transit) and the resolved
 * manual mode override (null if none).
 */
export function classifySegments(
  points: RawPoint[],
  modes: ModeRange[]
): Segment[] {
  const segments: Segment[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    const dtSec = (b.ts - a.ts) / 1000;
    if (dtSec <= 0 || dtSec > SESSION_GAP_SECONDS) continue;

    const distM = haversineMeters(a, b);
    if (distM <= 0) continue;

    const speedMps = distM / dtSec;
    const midTs = (a.ts + b.ts) / 2;
    const manualMode = resolveMode(midTs, modes);

    segments.push({
      aIdx: i,
      bIdx: i + 1,
      a,
      b,
      startTime: a.timestamp,
      endTime: b.timestamp,
      distanceM: distM,
      durationS: dtSec,
      speedMps,
      runType: "walk", // filled in by run detection below
      runTotalM: 0,
      manualMode,
    });
  }

  // Run detection: group contiguous fast segments, size them by total
  // distance, and label the whole run walk or transit.
  let i = 0;
  while (i < segments.length) {
    const s = segments[i];
    const isFast =
      s.speedMps > RUN_FAST_MPS && s.distanceM >= RUN_MIN_SEG_METERS;
    if (!isFast) {
      s.runType = "walk";
      s.runTotalM = s.distanceM;
      i += 1;
      continue;
    }

    let runEnd = i;
    let runTotal = s.distanceM;
    while (runEnd + 1 < segments.length) {
      const curr = segments[runEnd];
      const next = segments[runEnd + 1];
      const gap =
        (new Date(next.startTime).getTime() -
          new Date(curr.endTime).getTime()) /
        1000;
      const nextFast =
        next.speedMps > RUN_FAST_MPS &&
        next.distanceM >= RUN_MIN_SEG_METERS;
      if (nextFast && gap <= RUN_CONTIGUOUS_GAP_SECONDS) {
        runEnd += 1;
        runTotal += next.distanceM;
      } else break;
    }

    const runType: RunType =
      runTotal >= TRANSIT_RUN_MIN_METERS ? "transit" : "walk";
    for (let j = i; j <= runEnd; j++) {
      segments[j].runType = runType;
      segments[j].runTotalM = runTotal;
    }
    i = runEnd + 1;
  }

  return segments;
}

/**
 * True when this segment should be counted as walking for metrics:
 * Distance Walked, Parks Visited, coverage processing.
 *
 * Priority:
 *   * Explicit "walk" tag  → count (overrides auto-detection)
 *   * Any transit tag (subway/car/bike) → exclude
 *   * Auto run_type="transit" → exclude
 *   * Otherwise → count
 */
export function isWalkable(s: Segment): boolean {
  if (s.manualMode === "walk") return true;
  if (s.manualMode && s.manualMode !== "auto") return false;
  return s.runType === "walk";
}

export function walkedDistanceMeters(segments: Segment[]): number {
  let total = 0;
  for (const s of segments) {
    if (isWalkable(s)) total += s.distanceM;
  }
  return total;
}

/**
 * Returns the indexes (into the original points array) of points that
 * are part of at least one walkable segment. Used by /api/parks.
 */
export function walkablePointIndices(segments: Segment[]): Set<number> {
  const ids = new Set<number>();
  for (const s of segments) {
    if (isWalkable(s)) {
      ids.add(s.aIdx);
      ids.add(s.bIdx);
    }
  }
  return ids;
}
