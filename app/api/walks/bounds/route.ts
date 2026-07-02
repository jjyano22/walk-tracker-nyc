import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

export const dynamic = "force-dynamic";

// Returns the bounding box of RECENT walking (last 14 days relative to
// the newest GPS point), not all-time. With data in multiple cities
// (NYC, Tokyo, Miami…), the all-time box spans the globe — fitting it
// shows the whole world. Recent bounds keep the map on the city the
// user is actually in. Falls back to all-time if the recent window is
// somehow empty.
export async function GET() {
  try {
    const homeFilter = homeExclusionSql();

    const recent = await query(`
      SELECT
        MIN(lng) AS min_lng, MIN(lat) AS min_lat,
        MAX(lng) AS max_lng, MAX(lat) AS max_lat
      FROM gps_points
      WHERE ${homeFilter}
        AND timestamp >= (SELECT MAX(timestamp) FROM gps_points) - interval '14 days'
    `);

    let r = recent[0] as Record<string, unknown>;
    if (!r || r.min_lng == null) {
      const all = await query(`
        SELECT
          MIN(lng) AS min_lng, MIN(lat) AS min_lat,
          MAX(lng) AS max_lng, MAX(lat) AS max_lat
        FROM gps_points
        WHERE ${homeFilter}
      `);
      r = all[0] as Record<string, unknown>;
    }

    if (!r || r.min_lng == null) {
      return Response.json({ bounds: null });
    }

    return Response.json(
      {
        bounds: [
          [Number(r.min_lng), Number(r.min_lat)],
          [Number(r.max_lng), Number(r.max_lat)],
        ],
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
        },
      }
    );
  } catch (error) {
    console.error("Walks bounds error:", error);
    return Response.json({ bounds: null }, { status: 500 });
  }
}
