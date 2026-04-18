// Shared walk-classification logic. Builds segments between
// consecutive GPS fixes, groups them into contiguous "fast runs",
// labels each run as walk or transit by total distance, and resolves
// the user's manual mode overrides. Used by /api/walks (rendering)
// and /api/stats + /api/parks (walkable filtering).

import { query } from "@/lib/db";

// Gap between consecutive GPS fixes at which the drawn line / walked
// segment chain is broken. Matches SESSION_GAP_SECONDS elsewhere.
export const SESSION_GAP_SECONDS = 5 * 60;

// Classification thresholds.
//   * Short segments (< 100m) are kept as walk no matter the speed —
//     catches GPS jitter in urban canyons that would otherwise look
//     fast due to tiny time deltas.
//   * Long segments (>= 500m) are transit regardless of speed —
//     catches the classic subway pattern where the phone loses GPS
//     in the tunnel and reacquires it several blocks away, emitting
//     a single long straight line segment.
//   * Medium segments (100-500m) are transit only if they're
//     clearly above walking pace (> 2.5 m/s ≈ 5.6 mph, above a
//     brisk walk / light jog).
const SEG_WALK_MAX_METERS = 100;
const SEG_TRANSIT_MIN_METERS = 500;
const SEG_FAST_MPS = 2.5;

// Run-based upgrade: if a segment is adjacent to a transit segment
// (same session, small gap) and itself is above walking pace, promote
// it to transit too. Catches GPS samples that fall during a subway
// ride's station-slowdown where the individual segment is short but
// neighbors are clearly transit.
const RUN_CONTIGUOUS_GAP_SECONDS = 60;

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

  // Pass 1: per-segment classification.
  for (const s of segments) {
    s.runType = classifySingleSegment(s);
    s.runTotalM = s.distanceM;
  }

  // Pass 2: promote fast-ish segments that neighbor transit segments.
  // Subway rides through a station slow-down produce short segments
  // bracketed by long tunnel jumps; we want those to be transit too.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (s.runType === "transit") continue;
      if (s.speedMps <= 1.5) continue; // clearly walking, don't promote
      const prev = i > 0 ? segments[i - 1] : null;
      const next = i < segments.length - 1 ? segments[i + 1] : null;
      const prevTransit =
        prev &&
        prev.runType === "transit" &&
        gapSeconds(prev, s) <= RUN_CONTIGUOUS_GAP_SECONDS;
      const nextTransit =
        next &&
        next.runType === "transit" &&
        gapSeconds(s, next) <= RUN_CONTIGUOUS_GAP_SECONDS;
      if (prevTransit || nextTransit) {
        s.runType = "transit";
        changed = true;
      }
    }
  }

  return segments;
}

function classifySingleSegment(s: Segment): RunType {
  if (s.distanceM < SEG_WALK_MAX_METERS) return "walk";
  if (s.distanceM >= SEG_TRANSIT_MIN_METERS) return "transit";
  return s.speedMps > SEG_FAST_MPS ? "transit" : "walk";
}

function gapSeconds(a: Segment, b: Segment): number {
  return (
    (new Date(b.startTime).getTime() - new Date(a.endTime).getTime()) / 1000
  );
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
