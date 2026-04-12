import { query } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const after = searchParams.get("after");
  const before = searchParams.get("before");

  try {
    // Always return raw GPS points as lines (accurate paths)
    // Walked segments are used only for coverage stats, not display
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
