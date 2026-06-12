"use client";

import { useEffect, useState } from "react";

interface WalksSummary {
  total_sessions: number;
  total_points: number;
  excluded_segments: number;
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
        <div>
          walks: <span className="text-zinc-400">{summary.total_sessions}</span>{" "}
          pts: <span className="text-zinc-400">{summary.total_points}</span>{" "}
          excluded: <span className="text-zinc-400">{summary.excluded_segments}</span>
        </div>
      )}
    </div>
  );
}
