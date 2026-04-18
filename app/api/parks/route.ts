import { query } from "@/lib/db";
import { homeExclusionSql } from "@/lib/home";
import {
  classifySegments,
  loadModes,
  walkablePointIndices,
  type RawPoint,
} from "@/lib/walkClassify";
import * as fs from "fs";
import * as path from "path";

interface ParkFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    GISPROPNUM: string;
    SIGNNAME: string;
    BOROUGH: string;
    ACRES: number;
    TYPECATEGORY: string;
  };
}

// Simple point-in-polygon check
function pointInRing(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(
  point: [number, number],
  geometry: { type: string; coordinates: number[][][] | number[][][][] }
): boolean {
  if (geometry.type === "Polygon") {
    return pointInRing(point, (geometry.coordinates as number[][][])[0]);
  }
  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates as number[][][][]) {
      if (pointInRing(point, poly[0])) return true;
    }
  }
  return false;
}

let parksCache: ParkFeature[] | null = null;

function loadParks(): ParkFeature[] {
  if (parksCache) return parksCache;
  const filePath = path.join(process.cwd(), "public/data/nyc-parks.geojson");
  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  parksCache = data.features.filter(
    (f: ParkFeature) => f.geometry && f.properties.TYPECATEGORY !== "Retired N/A"
  );
  return parksCache!;
}

export async function GET() {
  try {
    // Classify all points and keep only those part of a walkable
    // segment. Auto-detected transit runs (subway, car, bike rides)
    // and manually-tagged transit are both filtered out — a subway
    // under Prospect Park shouldn't mark it as "visited".
    const rows = await query(
      `SELECT lat, lng, timestamp FROM gps_points
       WHERE ${homeExclusionSql()} ORDER BY timestamp ASC`
    );
    const allPoints: RawPoint[] = (
      rows as unknown as Array<{
        lat: string | number;
        lng: string | number;
        timestamp: string;
      }>
    ).map((r) => ({
      lat: Number(r.lat),
      lng: Number(r.lng),
      timestamp: r.timestamp,
      ts: new Date(r.timestamp).getTime(),
    }));

    const modes = await loadModes();
    const segments = classifySegments(allPoints, modes);
    const walkableIdx = walkablePointIndices(segments);

    // Dedupe by lat,lng to avoid redundant point-in-polygon tests.
    const seen = new Set<string>();
    const points: Array<{ lat: number; lng: number }> = [];
    for (const idx of walkableIdx) {
      const p = allPoints[idx];
      const key = `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ lat: p.lat, lng: p.lng });
    }

    if (points.length === 0) {
      return Response.json({ visited: [], count: 0, total: 0 });
    }

    const parks = loadParks();
    const visitedSet = new Set<string>();
    const visitedParks: Array<{ name: string; category: string; borough: string; acres: number }> = [];

    for (const park of parks) {
      if (visitedSet.has(park.properties.GISPROPNUM)) continue;

      for (const pt of points) {
        const coord: [number, number] = [Number(pt.lng), Number(pt.lat)];
        if (pointInGeometry(coord, park.geometry)) {
          visitedSet.add(park.properties.GISPROPNUM);
          visitedParks.push({
            name: park.properties.SIGNNAME,
            category: park.properties.TYPECATEGORY,
            borough: park.properties.BOROUGH,
            acres: park.properties.ACRES,
          });
          break;
        }
      }
    }

    return Response.json({
      visited: visitedParks.sort((a, b) => a.name.localeCompare(b.name)),
      count: visitedParks.length,
      total: parks.length,
    });
  } catch (error) {
    console.error("Parks API error:", error);
    return Response.json({ visited: [], count: 0, total: 0 }, { status: 500 });
  }
}
