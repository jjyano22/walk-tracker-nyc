import { query } from "@/lib/db";

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
  // Accept token from Authorization header, query param, or skip if not set
  const authHeader = request.headers.get("Authorization");
  const headerToken = authHeader?.replace("Bearer ", "").trim();
  const { searchParams } = new URL(request.url);
  const queryToken = searchParams.get("token")?.trim();
  const token = headerToken || queryToken;
  const expected = (process.env.OVERLAND_TOKEN || "").trim();

  if (expected && token !== expected) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body: OverlandPayload = await request.json();
    const locations = body.locations || [];

    if (locations.length === 0) {
      return Response.json({ result: "ok" });
    }

    // Filter to walking activity and reasonable accuracy
    const walkingLocations = locations.filter((loc) => {
      const motion = loc.properties?.motion || [];
      const accuracy = loc.properties?.horizontal_accuracy || 999;
      const isWalking =
        motion.includes("walking") ||
        motion.includes("on_foot") ||
        motion.includes("running") ||
        motion.length === 0;
      return isWalking && accuracy < 50;
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
