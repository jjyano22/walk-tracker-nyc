import { query } from "@/lib/db";
import { isWithinHome } from "@/lib/home";

interface OverlandLocation {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    timestamp: string;
    speed?: number;
    altitude?: number;
    horizontal_accuracy?: number;
    motion?: string[];
    battery_level?: number;
    wifi?: string;
  };
}

interface OverlandPayload {
  locations: OverlandLocation[];
  current?: OverlandLocation;
}

export async function POST(request: Request) {
  // No auth required — personal single-user app

  try {
    const body: OverlandPayload = await request.json();
    const locations = body.locations || [];

    if (locations.length === 0) {
      return Response.json({ result: "ok" });
    }

    // Filter to walking activity, reasonable accuracy, and outside home area.
    // Subway rides are kept so they can be reclassified manually in the UI.
    const walkingLocations = locations.filter((loc) => {
      const motion = loc.properties?.motion || [];
      const accuracy = loc.properties?.horizontal_accuracy || 999;
      const isWalking =
        motion.includes("walking") ||
        motion.includes("on_foot") ||
        motion.includes("running") ||
        motion.length === 0;
      if (!isWalking || accuracy >= 50) return false;
      const [lng, lat] = loc.geometry.coordinates;
      if (isWithinHome(lat, lng)) return false;
      return true;
    });

    if (walkingLocations.length === 0) {
      return Response.json({ result: "ok" });
    }

    // Insert each point individually with parameterized queries
    for (const loc of walkingLocations) {
      const [lng, lat] = loc.geometry.coordinates;
      const props = loc.properties;
      const motionArr = props.motion ? `{${props.motion.join(",")}}` : "{}";
      const ts = props.timestamp || new Date().toISOString();

      await query(
        `INSERT INTO gps_points (lat, lng, geom, timestamp, speed, altitude, horizontal_accuracy, motion)
         VALUES ($1, $2, ST_MakePoint($3, $4)::geography, $5::timestamptz, $6, $7, $8, $9)`,
        [lat, lng, lng, lat, ts, props.speed ?? null, props.altitude ?? null, props.horizontal_accuracy ?? null, motionArr]
      );
    }

    return Response.json({ result: "ok" });
  } catch (error) {
    console.error("Overland ingestion error:", error);
    return Response.json({ result: "ok" });
  }
}
