import { query } from "@/lib/db";
import { ensureModesTable, walkableSql } from "@/lib/modes";
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
    await ensureModesTable();

    // Only count points that weren't manually tagged as transit — e.g.
    // a subway that rolls under a park shouldn't mark it as "visited".
    const points = await query(
      `SELECT DISTINCT lat, lng FROM gps_points WHERE ${walkableSql("timestamp")}`
    );

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
