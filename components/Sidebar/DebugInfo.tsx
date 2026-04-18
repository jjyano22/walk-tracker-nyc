"use client";

import { useEffect, useState } from "react";

interface WalksSummary {
  total_segments: number;
  total_points: number;
  excluded_segments: number;
  stationary_segments?: number;
  transit_segments?: number;
  raw_miles?: number;
  smoothed_miles?: number;
}

export default function DebugInfo() {
  const [summary, setSummary] = useState<WalksSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/walks")
      .then((r) => r.json())
      .then((d) => {
        if (d._summary) setSummary(d._summary as WalksSummary);
        else setError("no _summary (old deploy?)");
      })
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="mt-8 pt-4 border-t border-zinc-900 text-[10px] text-zinc-600 font-mono leading-relaxed">
      <div className="text-zinc-500 uppercase tracking-wider mb-1">Debug</div>
      {error && <div className="text-red-400">{error}</div>}
      {!summary && !error && <div>loading…</div>}
      {summary && (
        <>
          <div>
            walk segs: <span className="text-zinc-400">{summary.total_segments}</span>
          </div>
          <div>
            excluded: <span className="text-zinc-400">{summary.excluded_segments}</span>
            {summary.transit_segments != null && (
              <>
                {" "}(transit{" "}
                <span className="text-zinc-400">{summary.transit_segments}</span>,
                stationary{" "}
                <span className="text-zinc-400">
                  {summary.stationary_segments}
                </span>
                )
              </>
            )}
          </div>
          <div>
            pts: <span className="text-zinc-400">{summary.total_points}</span>
          </div>
          {summary.raw_miles != null && summary.smoothed_miles != null && (
            <div>
              miles raw:{" "}
              <span className="text-zinc-400">{summary.raw_miles}</span>{" "}
              → smoothed:{" "}
              <span className="text-zinc-400">{summary.smoothed_miles}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
