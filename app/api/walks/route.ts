import { query } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");
  const before = searchParams.get("before");

  try {
    // First try walked_segments (processed/snapped data)
    const walkedCount = await query("SELECT COUNT(*) as cnt FROM walked_segments");

    if (Number(walkedCount[0].cnt) > 0) {
      const conditions: string[] = [];
      if (after) conditions.push(`first_walked_at >= '${after}'`);
      if (before) conditions.push(`first_walked_at <= '${before}'`);

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = await query(`
        SELECT osm_way_id, ST_AsGeoJSON(geom) as geometry, nta_code,
               length_meters, walk_count, first_walked_at
        FROM walked_segments ${where}
      `);

      const features = rows.map((row) => ({
        type: "Feature" as const,
        geometry: JSON.parse(row.geometry as string),
        properties: {
          osm_way_id: row.osm_way_id,
          nta_code: row.nta_code,
          length_meters: row.length_meters,
          walk_count: row.walk_count,
          first_walked_at: row.first_walked_at,
        },
      }));

      return Response.json({ type: "FeatureCollection", features });
    }

    // Fallback: return raw GPS points as lines
    const conditions: string[] = [];
    if (after) conditions.push(`timestamp >= '${after}'`);
    if (before) conditions.push(`timestamp <= '${before}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await query(`
      SELECT lat, lng, timestamp FROM gps_points ${where} ORDER BY timestamp ASC
    `);

    // Group consecutive points into walk sessions (split on >5min gaps)
    const features: Array<{
      type: "Feature";
      geometry: { type: "LineString"; coordinates: number[][] };
      properties: { start_time: string; end_time: string; point_count: number };
    }> = [];

    let currentCoords: number[][] = [];
    let currentTimes: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const time = new Date(row.timestamp as string).getTime();

      if (currentCoords.length > 0) {
        const lastTime = new Date(currentTimes[currentTimes.length - 1]).getTime();
        if ((time - lastTime) / 1000 / 60 > 5) {
          if (currentCoords.length >= 2) {
            features.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: currentCoords },
              properties: {
                start_time: currentTimes[0],
                end_time: currentTimes[currentTimes.length - 1],
                point_count: currentCoords.length,
              },
            });
          }
          currentCoords = [];
          currentTimes = [];
        }
      }

      currentCoords.push([Number(row.lng), Number(row.lat)]);
      currentTimes.push(row.timestamp as string);
    }

    if (currentCoords.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: currentCoords },
        properties: {
          start_time: currentTimes[0],
          end_time: currentTimes[currentTimes.length - 1],
          point_count: currentCoords.length,
        },
      });
    }

    return Response.json({ type: "FeatureCollection", features });
  } catch (error) {
    console.error("Walks API error:", error);
    return Response.json({ type: "FeatureCollection", features: [] }, { status: 500 });
  }
}
