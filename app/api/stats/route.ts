import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import { ensureModesTable, walkableSql } from "@/lib/modes";

export async function GET() {
  try {
    await ensureModesTable();

    const [neighborhoodStats] = await query(`
      SELECT
        COUNT(*) FILTER (WHERE walked_segments_count > 0) as neighborhoods_started,
        COUNT(*) as total_neighborhoods,
        COALESCE(MAX(coverage_pct), 0) as best_coverage
      FROM neighborhood_stats
    `);

    const homeFilter = homeExclusionSql();
    const walkable = walkableSql("timestamp");

    const [pointCount] = await query(
      `SELECT COUNT(*) as total_points FROM gps_points
       WHERE ${homeFilter} AND ${walkable}`
    );

    // Calculate actual walked distance from GPS points using PostGIS.
    // Home-area points and transit-tagged points (subway / bike) are
    // excluded before the window function so the LEAD jumps across
    // them and they don't count toward walked mileage.
    const [distance] = await query(`
      SELECT COALESCE(SUM(seg_distance), 0) as total_meters FROM (
        SELECT
          ST_Distance(
            geom,
            LEAD(geom) OVER (ORDER BY timestamp)
          ) as seg_distance
        FROM gps_points
        WHERE ${homeFilter} AND ${walkable}
      ) sub
      WHERE seg_distance < 100
    `);

    const totalMeters = Number(distance.total_meters);

    return Response.json({
      total_km: (totalMeters / 1000).toFixed(1),
      total_miles: (totalMeters / 1609.34).toFixed(1),
      neighborhoods_started: Number(neighborhoodStats.neighborhoods_started),
      total_neighborhoods: Number(neighborhoodStats.total_neighborhoods),
      best_coverage_pct: Number(neighborhoodStats.best_coverage).toFixed(1),
      total_gps_points: Number(pointCount.total_points),
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
    }, { status: 500 });
  }
}
