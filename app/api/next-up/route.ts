import { query } from "@/lib/db";

interface NearCompletionRow {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  remaining_meters: number;
}

export async function GET() {
  try {
    const nearCompletion = (await query(
      `SELECT nta_code, nta_name, borough,
              coverage_pct,
              GREATEST(total_street_length_meters - walked_street_length_meters, 0) AS remaining_meters
       FROM neighborhood_stats
       WHERE coverage_pct > 0 AND coverage_pct < 100
       ORDER BY coverage_pct DESC
       LIMIT 3`
    )) as unknown as NearCompletionRow[];

    return Response.json({
      near_completion: nearCompletion.map((r) => ({
        nta_code: r.nta_code,
        nta_name: r.nta_name,
        borough: r.borough,
        coverage_pct: Number(r.coverage_pct),
        remaining_miles: Number(r.remaining_meters) / 1609.34,
      })),
    });
  } catch (error) {
    console.error("Next-up API error:", error);
    return Response.json({ near_completion: [] }, { status: 500 });
  }
}
