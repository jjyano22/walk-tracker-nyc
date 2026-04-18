// Mode-exclusion helpers. The gps_modes table lets the user tag a
// time range as walk / subway / bike / auto via the map popup. Newest
// row wins for overlapping ranges. For data metrics (distance, stats,
// parks, coverage), transit modes should be excluded.

import { query } from "@/lib/db";

// Run once per serverless cold start is enough, but calling is
// idempotent and fast even when the table already exists.
export async function ensureModesTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS gps_modes (
      id BIGSERIAL PRIMARY KEY,
      start_ts TIMESTAMPTZ NOT NULL,
      end_ts TIMESTAMPTZ NOT NULL,
      mode TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_gps_modes_range ON gps_modes (start_ts, end_ts)`
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_gps_modes_created_at ON gps_modes (created_at DESC)`
  );
}

/**
 * SQL boolean: TRUE when the given timestamp column has a most-recent
 * override flagged as a non-walking mode (subway, bike) — i.e. the
 * point should be excluded from walked distance / parks / coverage.
 *
 * The inner NOT EXISTS picks the newest row whose range covers the
 * point; if that newest row's mode is transit, the outer EXISTS is
 * true.
 */
export function transitOverrideSql(tsCol: string = "timestamp"): string {
  return `EXISTS (
    SELECT 1 FROM gps_modes m
    WHERE ${tsCol} >= m.start_ts AND ${tsCol} <= m.end_ts
      AND m.mode IN ('subway', 'car', 'bike')
      AND NOT EXISTS (
        SELECT 1 FROM gps_modes m2
        WHERE ${tsCol} >= m2.start_ts AND ${tsCol} <= m2.end_ts
          AND m2.created_at > m.created_at
      )
  )`;
}

/** Complement of transitOverrideSql: TRUE when the point should be counted. */
export function walkableSql(tsCol: string = "timestamp"): string {
  return `NOT (${transitOverrideSql(tsCol)})`;
}
