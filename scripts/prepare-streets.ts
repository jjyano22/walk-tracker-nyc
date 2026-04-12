/**
 * Street Data Preparation Script
 *
 * Downloads walkable streets from OpenStreetMap for NYC,
 * assigns them to NTA neighborhoods, computes total walkable
 * length per neighborhood, and seeds the database.
 *
 * Usage:
 *   npx tsx scripts/prepare-streets.ts
 *
 * Prerequisites:
 *   - DATABASE_URL env var set
 *   - NTA boundaries file at public/data/nta-boundaries.geojson
 */

import { neon } from "@neondatabase/serverless";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[][] | number[][][] | number[][][][];
  };
  properties: Record<string, unknown>;
}

interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

interface OverpassElement {
  type: string;
  id: number;
  nodes?: number[];
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
}

async function downloadOSMStreets(): Promise<OverpassElement[]> {
  console.log("Downloading walkable streets from OpenStreetMap...");
  console.log("This may take a few minutes for all of NYC...");

  // NYC bounding box: sw_lat, sw_lng, ne_lat, ne_lng
  const bbox = "40.4774,-74.2591,40.9176,-73.7004";

  const query = `
    [out:json][timeout:300];
    (
      way["highway"~"^(residential|tertiary|secondary|primary|trunk|footway|path|pedestrian|cycleway|living_street|unclassified|service)$"](${bbox});
    );
    out body;
    >;
    out skel qt;
  `;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: `data=${encodeURIComponent(query)}`,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();
  console.log(`Downloaded ${data.elements.length} OSM elements`);
  return data.elements;
}

function osmToGeoJSON(elements: OverpassElement[]): GeoJSONFeature[] {
  // Build node lookup
  const nodes: Record<number, [number, number]> = {};
  for (const el of elements) {
    if (el.type === "node" && el.lat !== undefined && el.lon !== undefined) {
      nodes[el.id] = [el.lon, el.lat];
    }
  }

  // Convert ways to LineStrings
  const features: GeoJSONFeature[] = [];
  for (const el of elements) {
    if (el.type === "way" && el.nodes) {
      const coords = el.nodes
        .map((nid) => nodes[nid])
        .filter((c) => c !== undefined);

      if (coords.length >= 2) {
        features.push({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: coords,
          },
          properties: {
            osm_way_id: el.id,
            street_name: el.tags?.name || "",
            highway_type: el.tags?.highway || "",
          },
        });
      }
    }
  }

  console.log(`Converted to ${features.length} street segments`);
  return features;
}

function pointInPolygon(
  point: [number, number],
  polygon: number[][]
): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function assignNTA(
  streetMidpoint: [number, number],
  ntaFeatures: GeoJSONFeature[]
): { code: string; name: string; borough: string } | null {
  for (const feature of ntaFeatures) {
    const props = feature.properties;
    const geom = feature.geometry;

    let rings: number[][][] = [];
    if (geom.type === "Polygon") {
      rings = geom.coordinates as number[][][];
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates as number[][][][]) {
        rings.push(...poly);
      }
    }

    for (const ring of rings) {
      if (pointInPolygon(streetMidpoint, ring)) {
        return {
          code: (props.NTA2020 || props.nta2020 || "") as string,
          name: (props.NTAName || props.ntaname || "") as string,
          borough: (props.BoroName || props.boroname || "") as string,
        };
      }
    }
  }
  return null;
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function lineLength(coords: number[][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistance(
      coords[i - 1][1],
      coords[i - 1][0],
      coords[i][1],
      coords[i][0]
    );
  }
  return total;
}

async function main() {
  console.log("=== Walk Tracker NYC - Street Data Preparation ===\n");

  // Load NTA boundaries
  const ntaPath = path.join(
    process.cwd(),
    "public/data/nta-boundaries.geojson"
  );
  if (!fs.existsSync(ntaPath)) {
    console.error("NTA boundaries file not found at", ntaPath);
    process.exit(1);
  }

  const ntaData: GeoJSONCollection = JSON.parse(
    fs.readFileSync(ntaPath, "utf-8")
  );
  console.log(`Loaded ${ntaData.features.length} NTA boundaries\n`);

  // Download and convert OSM streets
  const osmElements = await downloadOSMStreets();
  const streets = osmToGeoJSON(osmElements);

  // Assign streets to neighborhoods and compute lengths
  console.log("\nAssigning streets to neighborhoods...");
  const ntaStats: Record<
    string,
    { name: string; borough: string; totalLength: number; segmentCount: number }
  > = {};
  let assigned = 0;
  let unassigned = 0;

  const BATCH_SIZE = 500;

  // Insert street segments in batches
  console.log("Inserting street segments into database...");

  for (let i = 0; i < streets.length; i++) {
    const street = streets[i];
    const coords = street.geometry.coordinates as number[][];
    const midIdx = Math.floor(coords.length / 2);
    const midpoint: [number, number] = [coords[midIdx][0], coords[midIdx][1]];

    const nta = assignNTA(midpoint, ntaData.features);
    const length = lineLength(coords);

    if (nta && nta.code) {
      assigned++;

      if (!ntaStats[nta.code]) {
        ntaStats[nta.code] = {
          name: nta.name,
          borough: nta.borough,
          totalLength: 0,
          segmentCount: 0,
        };
      }
      ntaStats[nta.code].totalLength += length;
      ntaStats[nta.code].segmentCount++;

      street.properties.nta_code = nta.code;
      street.properties.length_meters = length;
    } else {
      unassigned++;
    }

    if ((i + 1) % 10000 === 0) {
      console.log(`  Processed ${i + 1}/${streets.length} streets...`);
    }
  }

  console.log(`\nAssigned: ${assigned}, Unassigned: ${unassigned}`);

  // Insert into database in batches
  console.log("\nInserting street segments into database...");
  const assignedStreets = streets.filter((s) => s.properties.nta_code);

  for (let i = 0; i < assignedStreets.length; i += BATCH_SIZE) {
    const batch = assignedStreets.slice(i, i + BATCH_SIZE);
    const values = batch
      .map((s) => {
        const geojson = JSON.stringify(s.geometry);
        return `(${s.properties.osm_way_id}, ST_GeomFromGeoJSON('${geojson}')::geography, '${(s.properties.street_name as string).replace(/'/g, "''")}', '${s.properties.highway_type}', '${s.properties.nta_code}', ${s.properties.length_meters})`;
      })
      .join(",\n");

    await sql(
      `INSERT INTO street_segments (osm_way_id, geom, street_name, highway_type, nta_code, length_meters)
      VALUES ${values}
      ON CONFLICT DO NOTHING` as unknown as TemplateStringsArray
    );

    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= assignedStreets.length) {
      console.log(
        `  Inserted ${Math.min(i + BATCH_SIZE, assignedStreets.length)}/${assignedStreets.length}`
      );
    }
  }

  // Seed neighborhood_stats
  console.log("\nSeeding neighborhood_stats table...");
  for (const [code, stats] of Object.entries(ntaStats)) {
    await sql(
      `INSERT INTO neighborhood_stats (nta_code, nta_name, borough, total_street_length_meters, total_segments)
      VALUES ('${code}', '${stats.name.replace(/'/g, "''")}', '${stats.borough.replace(/'/g, "''")}', ${stats.totalLength}, ${stats.segmentCount})
      ON CONFLICT (nta_code) DO UPDATE SET
        nta_name = EXCLUDED.nta_name,
        borough = EXCLUDED.borough,
        total_street_length_meters = EXCLUDED.total_street_length_meters,
        total_segments = EXCLUDED.total_segments` as unknown as TemplateStringsArray
    );
  }

  console.log(`\nSeeded ${Object.keys(ntaStats).length} neighborhoods`);
  console.log("\n=== Done! ===");
  console.log(
    `Total walkable street length: ${(
      Object.values(ntaStats).reduce((a, b) => a + b.totalLength, 0) / 1000
    ).toFixed(0)} km`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
