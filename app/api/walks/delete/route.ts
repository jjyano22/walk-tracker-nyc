import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Destructive: permanently deletes gps_points within the given time
// range. Used by the map popup's "Remove" action for getting rid of
// bad data (errant GPS jumps, rides the user doesn't want tracked).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      start_ts?: string;
      end_ts?: string;
    };

    if (!body.start_ts || !body.end_ts) {
      return Response.json(
        { error: "missing fields — need {start_ts, end_ts}" },
        { status: 400 }
      );
    }

    const start = new Date(body.start_ts);
    const end = new Date(body.end_ts);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return Response.json({ error: "invalid time range" }, { status: 400 });
    }

    const deleted = (await query(
      `DELETE FROM gps_points
       WHERE timestamp >= $1::timestamptz
         AND timestamp <= $2::timestamptz
       RETURNING id`,
      [start.toISOString(), end.toISOString()]
    )) as unknown as Array<{ id: number }>;

    return Response.json({ deleted: deleted.length });
  } catch (error) {
    console.error("Walks delete error:", error);
    return Response.json({ error: "delete failed" }, { status: 500 });
  }
}
