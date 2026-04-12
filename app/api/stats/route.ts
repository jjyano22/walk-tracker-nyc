import { query } from "@/lib/db";

export async function GET() {
  try {
    const [totals] = await query(`
      SELECT
        COALESCE(SUM(walked_street_length_meters), 0) as total_walked_meters,
        COUNT(*) FILTER (WHERE walked_segments_count > 0) as neighborhoods_started,
        COUNT(*) as total_neighborhoods,
        COALESCE(MAX(coverage_pct), 0) as best_coverage
      FROM neighborhood_stats
    `);

    const [pointCount] = await query("SELECT COUNT(*) as total_points FROM gps_points");
    const [walkCount] = await query("SELECT COUNT(*) as total_walked_segments FROM walked_segments");

    return Response.json({
      total_km: (Number(totals.total_walked_meters) / 1000).toFixed(1),
      total_miles: (Number(totals.total_walked_meters) / 1609.34).toFixed(1),
      neighborhoods_started: Number(totals.neighborhoods_started),
      total_neighborhoods: Number(totals.total_neighborhoods),
      best_coverage_pct: Number(totals.best_coverage).toFixed(1),
      total_gps_points: Number(pointCount.total_points),
      total_walked_segments: Number(walkCount.total_walked_segments),
    });
  } catch (error) {
    console.error("Stats API error:", error);
    return Response.json({
      total_km: "0",
      total_miles: "0",
      neighborhoods_started: 0,
      total_neighborhoods: 0,
      best_coverage_pct: "0",
      total_gps_points: 0,
      total_walked_segments: 0,
    }, { status: 500 });
  }
}
