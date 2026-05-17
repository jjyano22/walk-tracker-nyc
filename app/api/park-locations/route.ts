import * as fs from "fs";
import * as path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

interface ParkFeature {
  type: "Feature";
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    SIGNNAME: string;
    TYPECATEGORY: string;
  };
}

function centroid(geometry: ParkFeature["geometry"]): [number, number] | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const visit = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === "number"
    ) {
      sumX += coords[0] as number;
      sumY += coords[1] as number;
      count += 1;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) visit(c);
  };
  visit(geometry.coordinates);
  if (count === 0) return null;
  return [sumX / count, sumY / count];
}

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "public/data/nyc-parks.geojson");
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const features = (data.features as ParkFeature[]).filter(
      (f) => f.geometry && f.properties.TYPECATEGORY !== "Retired N/A"
    );

    const locations: Array<{
      name: string;
      lng: number;
      lat: number;
    }> = [];

    for (const f of features) {
      const c = centroid(f.geometry);
      if (!c) continue;
      locations.push({
        name: f.properties.SIGNNAME,
        lng: c[0],
        lat: c[1],
      });
    }

    return Response.json({ locations });
  } catch (error) {
    console.error("Park locations error:", error);
    return Response.json({ locations: [] }, { status: 500 });
  }
}
