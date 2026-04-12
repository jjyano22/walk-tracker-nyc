import { query } from "@/lib/db";

export async function GET() {
  try {
    const rows = await query(`
      SELECT nta_code, nta_name, borough, total_street_length_meters,
             walked_street_length_meters, coverage_pct, total_segments,
             walked_segments_count, last_updated
      FROM neighborhood_stats
      ORDER BY coverage_pct DESC, nta_name ASC
    `);

    return Response.json({ neighborhoods: rows });
  } catch (error) {
    console.error("Neighborhoods API error:", error);
    return Response.json({ neighborhoods: [] }, { status: 500 });
  }
}
