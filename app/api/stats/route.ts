import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import {
  classifySegments,
  loadModes,
  walkedDistanceMeters,
  walkablePointIndices,
  type RawPoint,
} from "@/lib/walkClassify";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const [neighborhoodStats] = await query(`
      SELECT
        COUNT(*) FILTER (WHERE walked_segments_count > 0) as neighborhoods_started,
        COUNT(*) as total_neighborhoods,
        COALESCE(MAX(coverage_pct), 0) as best_coverage
      FROM neighborhood_stats
    `);

    // Pull the same points /api/walks uses so we can classify identically
    // — auto-detected transit runs (run_type="transit") and manually-
    // tagged transit (subway/car/bike) are both excluded from distance.
    const rows = await query(
      `SELECT lat, lng, timestamp FROM gps_points
       WHERE ${homeExclusionSql()} ORDER BY timestamp ASC`
    );
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

    const modes = await loadModes();
    const segments = classifySegments(points, modes);

    const totalMeters = walkedDistanceMeters(segments);
    const totalPoints = walkablePointIndices(segments).size;

    return Response.json({
      total_km: (totalMeters / 1000).toFixed(1),
      total_miles: (totalMeters / 1609.34).toFixed(1),
      neighborhoods_started: Number(neighborhoodStats.neighborhoods_started),
      total_neighborhoods: Number(neighborhoodStats.total_neighborhoods),
      best_coverage_pct: Number(neighborhoodStats.best_coverage).toFixed(1),
      total_gps_points: totalPoints,
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return Response.json(
      {
        total_km: "0",
        total_miles: "0",
        neighborhoods_started: 0,
        total_neighborhoods: 0,
        best_coverage_pct: "0",
        total_gps_points: 0,
      },
      { status: 500 }
    );
  }
}
