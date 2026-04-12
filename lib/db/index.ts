import { neon } from "@neondatabase/serverless";

// For parameterized queries: query("SELECT * FROM t WHERE id = $1", [id])
// For plain queries: query("SELECT * FROM t")
export async function query(queryStr: string, params?: unknown[]) {
  const sql = neon(process.env.DATABASE_URL!);
  return sql.query(queryStr, params);
}
