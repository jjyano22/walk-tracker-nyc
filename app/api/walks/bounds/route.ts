import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const rows = await query(`
      SELECT
        MIN(lng) AS min_lng,
        MIN(lat) AS min_lat,
        MAX(lng) AS max_lng,
        MAX(lat) AS max_lat
      FROM gps_points
      WHERE ${homeExclusionSql()}
    `);

    const r = rows[0] as Record<string, unknown>;
    if (!r || r.min_lng == null) {
      return Response.json({ bounds: null });
    }

    return Response.json({
      bounds: [
        [Number(r.min_lng), Number(r.min_lat)],
        [Number(r.max_lng), Number(r.max_lat)],
      ],
    });
  } catch (error) {
    console.error("Walks bounds error:", error);
    return Response.json({ bounds: null }, { status: 500 });
  }
}
