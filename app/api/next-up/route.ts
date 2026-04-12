import { query } from "@/lib/db";

interface NearCompletionRow {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  remaining_meters: number;
}

interface NearbyStreetRow {
  street_name: string;
  nta_code: string | null;
  nta_name: string | null;
  borough: string | null;
  distance_m: number;
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

    let nearbyStreets: NearbyStreetRow[] = [];
    try {
      nearbyStreets = (await query(
        `WITH center AS (
           SELECT ST_Centroid(ST_Collect(geom::geometry))::geography AS pt
           FROM walked_segments
         ),
         candidates AS (
           SELECT
             ss.street_name,
             ss.nta_code,
             ST_Distance(ss.geom, c.pt) AS distance_m,
             ROW_NUMBER() OVER (
               PARTITION BY ss.street_name, ss.nta_code
               ORDER BY ST_Distance(ss.geom, c.pt) ASC
             ) AS rn
           FROM street_segments ss
           LEFT JOIN walked_segments ws ON ws.osm_way_id = ss.osm_way_id
           CROSS JOIN center c
           WHERE c.pt IS NOT NULL
             AND ws.osm_way_id IS NULL
             AND ss.street_name IS NOT NULL
             AND ST_DWithin(ss.geom, c.pt, 3000)
         )
         SELECT c.street_name, c.nta_code, c.distance_m,
                ns.nta_name, ns.borough
         FROM candidates c
         LEFT JOIN neighborhood_stats ns ON ns.nta_code = c.nta_code
         WHERE c.rn = 1
         ORDER BY c.distance_m ASC
         LIMIT 5`
      )) as unknown as NearbyStreetRow[];
    } catch (e) {
      // If walked_segments is empty or PostGIS errors, just return an empty list.
      console.error("Next-up nearby streets error:", e);
      nearbyStreets = [];
    }

    return Response.json({
      near_completion: nearCompletion.map((r) => ({
        nta_code: r.nta_code,
        nta_name: r.nta_name,
        borough: r.borough,
        coverage_pct: Number(r.coverage_pct),
        remaining_miles: Number(r.remaining_meters) / 1609.34,
      })),
      nearby_unwalked: nearbyStreets.map((r) => ({
        street_name: r.street_name,
        nta_code: r.nta_code,
        nta_name: r.nta_name,
        borough: r.borough,
        distance_miles: Number(r.distance_m) / 1609.34,
      })),
    });
  } catch (error) {
    console.error("Next-up API error:", error);
    return Response.json(
      { near_completion: [], nearby_unwalked: [] },
      { status: 500 }
    );
  }
}
