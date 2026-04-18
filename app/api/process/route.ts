import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import { ensureModesTable, walkableSql } from "@/lib/modes";

export async function POST() {
  // No auth — personal app

  try {
    await ensureModesTable();

    // Step 1: Fetch unprocessed GPS points (excluding home area and
    // points manually tagged as transit). Transit-tagged points are
    // left with is_processed = FALSE so that if the user later
    // resets them to auto/walk, they flow through the pipeline.
    const points = await query(`
      SELECT id, lat, lng, timestamp
      FROM gps_points
      WHERE is_processed = FALSE
        AND ${homeExclusionSql()}
        AND ${walkableSql("timestamp")}
      ORDER BY timestamp ASC
      LIMIT 5000
    `);

    if (points.length === 0) {
      return Response.json({ result: "ok", processed: 0 });
    }

    let matchedCount = 0;
    const processedIds: number[] = [];

    // Step 2: For each point, find the nearest street segment
    for (const point of points) {
      const lat = Number(point.lat);
      const lng = Number(point.lng);

      const nearbyStreets = await query(
        `SELECT id, osm_way_id, nta_code, length_meters,
                ST_AsGeoJSON(geom) as geometry,
                ST_Distance(geom, ST_MakePoint($1, $2)::geography) as distance
         FROM street_segments
         WHERE ST_DWithin(geom, ST_MakePoint($1, $2)::geography, 15)
         ORDER BY distance ASC
         LIMIT 1`,
        [lng, lat]
      );

      if (nearbyStreets.length > 0) {
        const street = nearbyStreets[0];

        await query(
          `INSERT INTO walked_segments (osm_way_id, geom, nta_code, length_meters, first_walked_at)
           VALUES ($1, ST_GeomFromGeoJSON($2)::geography, $3, $4, $5::timestamptz)
           ON CONFLICT (osm_way_id) DO UPDATE SET walk_count = walked_segments.walk_count + 1`,
          [street.osm_way_id, street.geometry, street.nta_code, street.length_meters, point.timestamp]
        );

        matchedCount++;
      }

      processedIds.push(Number(point.id));
    }

    // Step 3: Mark points as processed
    if (processedIds.length > 0) {
      await query(
        `UPDATE gps_points SET is_processed = TRUE WHERE id = ANY($1::bigint[])`,
        [processedIds]
      );
    }

    // Step 4: Recompute neighborhood stats
    await query(`
      UPDATE neighborhood_stats ns
      SET
        walked_street_length_meters = sub.walked_length,
        walked_segments_count = sub.walked_count,
        coverage_pct = CASE
          WHEN ns.total_street_length_meters > 0
          THEN (sub.walked_length / ns.total_street_length_meters) * 100
          ELSE 0
        END,
        last_updated = NOW()
      FROM (
        SELECT nta_code,
               COALESCE(SUM(length_meters), 0) as walked_length,
               COUNT(*) as walked_count
        FROM walked_segments
        GROUP BY nta_code
      ) sub
      WHERE ns.nta_code = sub.nta_code
    `);

    return Response.json({
      result: "ok",
      processed: processedIds.length,
      matched: matchedCount,
    });
  } catch (error) {
    console.error("Process pipeline error:", error);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}
