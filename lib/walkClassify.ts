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

// Stationary detection: if the user hasn't moved more than this
// distance within a time window, they're sitting still and the GPS
// segments are pure drift. Excluded from both rendering and distance.
const STATIONARY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const STATIONARY_RADIUS_M = 35;

// Douglas-Peucker tolerance for simplifying walking polylines before
// measuring distance. Removes zigzag noise that inflates cumulative
// distance by 20-40% on otherwise-straight walks. 20m is well below
// a NYC block width (~80m), so real turns are preserved while GPS
// jitter is dropped.
const SIMPLIFY_TOLERANCE_DEG = 20 / 111000; // ≈20 meters in latitude degrees

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

export type RunType = "walk" | "transit" | "stationary";

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

  // Pass 0: stationary detection. For each point, check whether the
  // user has moved more than STATIONARY_RADIUS_M from where they were
  // STATIONARY_WINDOW_MS ago. If not, the phone is drifting while
  // stationary (office, restaurant, gym). Mark both-endpoints-stationary
  // segments so they're excluded from distance and rendering.
  const pointStationary = new Uint8Array(points.length); // 0=moving, 1=stationary
  if (points.length > 0) {
    let windowStart = 0;
    for (let i = 0; i < points.length; i++) {
      const threshold = points[i].ts - STATIONARY_WINDOW_MS;
      while (windowStart < i && points[windowStart].ts < threshold) {
        windowStart += 1;
      }
      // Check if ALL points in [windowStart, i] are within radius.
      // For efficiency, only check first and last (covers most cases).
      // Also check the max-distance point in the window for robustness.
      let maxDist = 0;
      const ref = points[i];
      for (
        let j = windowStart;
        j < i;
        // sample: check every 5th point in the window to save cycles
        j += Math.max(1, Math.floor((i - windowStart) / 10))
      ) {
        const d = haversineMeters(points[j], ref);
        if (d > maxDist) maxDist = d;
      }
      // Also always check the first point of the window
      if (windowStart < i) {
        const d = haversineMeters(points[windowStart], ref);
        if (d > maxDist) maxDist = d;
      }
      if (maxDist < STATIONARY_RADIUS_M && i - windowStart >= 2) {
        pointStationary[i] = 1;
      }
    }
  }

  for (const s of segments) {
    if (pointStationary[s.aIdx] && pointStationary[s.bIdx]) {
      s.runType = "stationary";
      s.runTotalM = 0;
      continue;
    }
  }

  // Pass 1: per-segment classification (skipping already-stationary).
  for (const s of segments) {
    if (s.runType === "stationary") continue;
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
  if (s.runType === "stationary") return false;
  if (s.manualMode === "walk") return true;
  if (s.manualMode && s.manualMode !== "auto") return false;
  return s.runType === "walk";
}

/**
 * Sum of walking distance across all segments, with GPS-zigzag
 * smoothing. Groups contiguous walkable segments into "sessions",
 * applies Douglas-Peucker to each session's polyline (dropping points
 * that are within ~10m of the simplified line), and sums distance on
 * the simplified path. This reduces 20-40% of phantom inflation from
 * GPS bouncing along otherwise-straight walks.
 */
export function walkedDistanceMeters(segments: Segment[]): number {
  const sessions = groupWalkableSessions(segments);
  let total = 0;
  for (const coords of sessions) {
    if (coords.length < 2) continue;
    const simplified = douglasPeucker(coords, SIMPLIFY_TOLERANCE_DEG);
    for (let i = 0; i < simplified.length - 1; i++) {
      total += haversineLngLat(simplified[i], simplified[i + 1]);
    }
  }
  return total;
}

// Collect contiguous runs of walkable segments as arrays of [lng, lat]
// point sequences. A run ends when a non-walkable segment appears OR
// two consecutive segments aren't actually adjacent in time (shouldn't
// happen given the classifier, but belt-and-suspenders).
function groupWalkableSessions(segments: Segment[]): [number, number][][] {
  const sessions: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const s of segments) {
    if (!isWalkable(s)) {
      if (current.length > 0) {
        sessions.push(current);
        current = [];
      }
      continue;
    }
    if (current.length === 0) {
      current.push([s.a.lng, s.a.lat]);
    } else {
      const last = current[current.length - 1];
      // If the last point isn't this segment's `a`, start a new session.
      if (last[0] !== s.a.lng || last[1] !== s.a.lat) {
        sessions.push(current);
        current = [[s.a.lng, s.a.lat]];
      }
    }
    current.push([s.b.lng, s.b.lat]);
  }
  if (current.length > 0) sessions.push(current);
  return sessions;
}

function haversineLngLat(a: [number, number], b: [number, number]): number {
  return haversineMeters(
    { lat: a[1], lng: a[0], ts: 0, timestamp: "" },
    { lat: b[1], lng: b[0], ts: 0, timestamp: "" }
  );
}

// Douglas-Peucker polyline simplification. Tolerance in degrees.
function douglasPeucker(
  pts: [number, number][],
  tolerance: number
): [number, number][] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;

  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxDist = 0;
    let maxIdx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpendicularDistance(pts[i], pts[lo], pts[hi]);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }

  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) out.push(pts[i]);
  }
  return out;
}

function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return Math.sqrt(ex * ex + ey * ey);
  }
  const num = Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy);
  const den = Math.sqrt(dx * dx + dy * dy);
  return num / den;
}

/**
 * Returns the indexes (into the original points array) of points that
 * are part of at least one walkable segment. Used by /api/parks.
 */
/**
 * Raw (unsimplified) walked distance — sum of haversine distance of
 * every walkable segment. Useful for diagnostics: compare against
 * walkedDistanceMeters() to see how much Douglas-Peucker smoothing
 * cut away GPS-jitter inflation.
 */
export function walkedDistanceRawMeters(segments: Segment[]): number {
  let total = 0;
  for (const s of segments) {
    if (isWalkable(s)) total += s.distanceM;
  }
  return total;
}

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
