import { query } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// One-shot migration: remap rows in street_segments, walked_segments,
// and neighborhood_stats from aggregated NTA codes (e.g. BK0601) to
// the subdivided codes (BK0601A/B/C/D for Red Hook / Carroll Gardens /
// Cobble Hill / Gowanus). Derives the new code by checking which
// subdivided polygon now contains each row's geometry, using PostGIS
// ST_Contains.
//
// Safe to re-run: writes are idempotent. Rows already on a new code
// stay put (their polygon still contains their midpoint).

interface GeoFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    NTA2020?: string;
    nta2020?: string;
    NTAName?: string;
    ntaname?: string;
    BoroName?: string;
    boroname?: string;
  };
}

interface GeoCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

// Mirror of the script's subdivision specs so the migration knows
// which parent codes to remap.
const PARENT_CODES = [
  "BK0202",
  "BK0601",
  "BK0701",
  "BK0902",
  "BK1302",
  "BK1503",
  "BK1802",
];

export async function POST() {
  try {
    const geojsonPath = path.join(
      process.cwd(),
      "public/data/nta-boundaries.geojson"
    );
    const data: GeoCollection = JSON.parse(
      fs.readFileSync(geojsonPath, "utf-8")
    );

    // Collect the subdivided features that replaced each parent.
    const newSubs = data.features.filter((f) => {
      const code = (f.properties.NTA2020 || f.properties.nta2020 || "") as string;
      return PARENT_CODES.some((p) => code.startsWith(p) && code !== p);
    });

    if (newSubs.length === 0) {
      return Response.json(
        {
          error:
            "No subdivided features found in geojson. Run `npx tsx scripts/subdivide-neighborhoods.ts` and redeploy first.",
        },
        { status: 400 }
      );
    }

    let streetRowsUpdated = 0;
    let walkedRowsUpdated = 0;

    // For each subdivided polygon, remap any rows currently pointing at
    // its parent code to the new code if their geometry falls inside.
    for (const sub of newSubs) {
      const newCode = (sub.properties.NTA2020 || sub.properties.nta2020) as string;
      const parentCode = PARENT_CODES.find((p) => newCode.startsWith(p));
      if (!parentCode) continue;

      const geomJson = JSON.stringify(sub.geometry);

      // street_segments: midpoint-in-polygon test. ST_Intersects on the
      // line's geom is reasonable too, but midpoint is closer to what
      // the original prepare-streets.ts used.
      const streetResult = (await query(
        `UPDATE street_segments
         SET nta_code = $1
         WHERE nta_code = $2
           AND ST_Contains(
             ST_GeomFromGeoJSON($3),
             ST_LineInterpolatePoint(geom::geometry, 0.5)
           )
         RETURNING id`,
        [newCode, parentCode, geomJson]
      )) as unknown as Array<{ id: number }>;
      streetRowsUpdated += streetResult.length;

      const walkedResult = (await query(
        `UPDATE walked_segments
         SET nta_code = $1
         WHERE nta_code = $2
           AND ST_Contains(
             ST_GeomFromGeoJSON($3),
             ST_LineInterpolatePoint(geom::geometry, 0.5)
           )
         RETURNING id`,
        [newCode, parentCode, geomJson]
      )) as unknown as Array<{ id: number }>;
      walkedRowsUpdated += walkedResult.length;
    }

    // Rebuild neighborhood_stats from scratch using the new codes.
    // Delete rows for old parent codes (they no longer have any
    // matching street_segments) and (re-)upsert rows for every code
    // currently referenced by street_segments.
    await query(
      `DELETE FROM neighborhood_stats WHERE nta_code = ANY($1::text[])`,
      [PARENT_CODES]
    );

    // For each new sub, seed neighborhood_stats with totals computed
    // from the remapped street_segments.
    const seeds: Array<{
      code: string;
      name: string;
      borough: string;
    }> = [];
    for (const sub of newSubs) {
      seeds.push({
        code: (sub.properties.NTA2020 || sub.properties.nta2020) as string,
        name: (sub.properties.NTAName || sub.properties.ntaname || "") as string,
        borough: (sub.properties.BoroName || sub.properties.boroname || "Brooklyn") as string,
      });
    }

    for (const seed of seeds) {
      await query(
        `INSERT INTO neighborhood_stats (
           nta_code, nta_name, borough,
           total_street_length_meters, total_segments,
           walked_street_length_meters, walked_segments_count, coverage_pct
         )
         SELECT
           $1, $2, $3,
           COALESCE(SUM(ss.length_meters), 0),
           COUNT(ss.id),
           0, 0, 0
         FROM street_segments ss
         WHERE ss.nta_code = $1
         ON CONFLICT (nta_code) DO UPDATE SET
           nta_name = EXCLUDED.nta_name,
           borough = EXCLUDED.borough,
           total_street_length_meters = EXCLUDED.total_street_length_meters,
           total_segments = EXCLUDED.total_segments`,
        [seed.code, seed.name, seed.borough]
      );
    }

    // Recompute walked totals + coverage_pct for every neighborhood so
    // the new subdivisions show their real coverage immediately.
    await query(`
      UPDATE neighborhood_stats ns
      SET
        walked_street_length_meters = COALESCE(sub.walked_length, 0),
        walked_segments_count = COALESCE(sub.walked_count, 0),
        coverage_pct = CASE
          WHEN ns.total_street_length_meters > 0
          THEN (COALESCE(sub.walked_length, 0) / ns.total_street_length_meters) * 100
          ELSE 0
        END,
        last_updated = NOW()
      FROM (
        SELECT nta_code,
               SUM(length_meters) as walked_length,
               COUNT(*) as walked_count
        FROM walked_segments
        GROUP BY nta_code
      ) sub
      WHERE ns.nta_code = sub.nta_code
    `);

    return Response.json({
      ok: true,
      new_subdivisions: newSubs.length,
      street_rows_updated: streetRowsUpdated,
      walked_rows_updated: walkedRowsUpdated,
    });
  } catch (error) {
    console.error("Migrate neighborhoods error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}
