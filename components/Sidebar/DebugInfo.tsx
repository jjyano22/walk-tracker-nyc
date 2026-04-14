"use client";

import { useEffect, useState } from "react";

interface WalksSummary {
  total_features: number;
  walk_features: number;
  transit_features: number;
  total_points: number;
  thresholds: {
    transit_speed_mps: number;
    transit_jump_meters: number;
    session_gap_seconds: number;
  };
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
            features: <span className="text-zinc-400">{summary.total_features}</span>{" "}
            (walk{" "}
            <span className="text-emerald-400">{summary.walk_features}</span> /
            transit{" "}
            <span className="text-purple-400">{summary.transit_features}</span>)
          </div>
          <div>
            points: <span className="text-zinc-400">{summary.total_points}</span>
          </div>
          <div>
            thresholds: speed&gt;
            <span className="text-zinc-400">
              {summary.thresholds.transit_speed_mps}
            </span>
            m/s, dist&gt;
            <span className="text-zinc-400">
              {summary.thresholds.transit_jump_meters}
            </span>
            m
          </div>
        </>
      )}
    </div>
  );
}
