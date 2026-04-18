import { query } from "@/lib/db";
import { ensureModesTable } from "@/lib/modes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_MODES = ["walk", "subway", "bike", "auto"] as const;
type Mode = (typeof ALLOWED_MODES)[number];

function isMode(v: unknown): v is Mode {
  return typeof v === "string" && (ALLOWED_MODES as readonly string[]).includes(v);
}

export async function POST(request: Request) {
  try {
    await ensureModesTable();

    const body = (await request.json()) as {
      start_ts?: string;
      end_ts?: string;
      mode?: string;
    };

    if (!body.start_ts || !body.end_ts || !isMode(body.mode)) {
      return Response.json(
        {
          error:
            "missing or invalid fields — need {start_ts, end_ts, mode} with mode in " +
            ALLOWED_MODES.join(", "),
        },
        { status: 400 }
      );
    }

    const start = new Date(body.start_ts);
    const end = new Date(body.end_ts);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return Response.json({ error: "invalid time range" }, { status: 400 });
    }

    await query(
      `INSERT INTO gps_modes (start_ts, end_ts, mode) VALUES ($1::timestamptz, $2::timestamptz, $3)`,
      [start.toISOString(), end.toISOString(), body.mode]
    );

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Walks mode POST error:", error);
    return Response.json({ error: "mode update failed" }, { status: 500 });
  }
}
