import { neon } from "@neondatabase/serverless";

// For parameterized queries: query("SELECT * FROM t WHERE id = $1", [id])
// For plain queries: query("SELECT * FROM t")
export async function query(queryStr: string, params?: unknown[]) {
  const sql = neon(process.env.DATABASE_URL!);
  return sql.query(queryStr, params);
}

// Overland logs a fix every second, so a full gps_points scan now
// exceeds Neon's 64MB single-response cap (HTTP 507) and every read
// endpoint 500s. Keep one point per 10-second bucket instead: at
// walking pace that's ~14m spacing, far finer than any classifier
// threshold, so routes and distance math are unaffected.
export function sampledGpsPointsSql(where: string): string {
  return `
    SELECT lat, lng, timestamp FROM (
      SELECT DISTINCT ON (floor(extract(epoch from timestamp) / 10))
             lat, lng, timestamp
      FROM gps_points
      ${where}
      ORDER BY floor(extract(epoch from timestamp) / 10), timestamp
    ) sampled
    ORDER BY timestamp ASC`;
}
