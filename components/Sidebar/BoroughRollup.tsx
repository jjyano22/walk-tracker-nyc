"use client";

import { useState } from "react";

interface Neighborhood {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  walked_street_length_meters: number;
  total_street_length_meters: number;
}

interface BoroughGroup {
  borough: string;
  neighborhoods: Neighborhood[];
  walkedMeters: number;
  totalMeters: number;
  coveragePct: number;
  startedCount: number;
}

const BOROUGH_ORDER = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];

const BOROUGH_BAR: Record<string, string> = {
  Manhattan: "bg-blue-500",
  Brooklyn: "bg-green-500",
  Queens: "bg-purple-500",
  Bronx: "bg-orange-500",
  "Staten Island": "bg-pink-500",
};

const BOROUGH_TEXT: Record<string, string> = {
  Manhattan: "text-blue-400",
  Brooklyn: "text-green-400",
  Queens: "text-purple-400",
  Bronx: "text-orange-400",
  "Staten Island": "text-pink-400",
};

function groupByBorough(neighborhoods: Neighborhood[]): BoroughGroup[] {
  const map = new Map<string, Neighborhood[]>();
  for (const n of neighborhoods) {
    const list = map.get(n.borough) ?? [];
    list.push(n);
    map.set(n.borough, list);
  }

  const groups: BoroughGroup[] = [];
  for (const borough of BOROUGH_ORDER) {
    const list = map.get(borough);
    if (!list) continue;
    let walkedMeters = 0;
    let totalMeters = 0;
    let startedCount = 0;
    for (const n of list) {
      walkedMeters += Number(n.walked_street_length_meters) || 0;
      totalMeters += Number(n.total_street_length_meters) || 0;
      if (Number(n.coverage_pct) > 0) startedCount += 1;
    }
    groups.push({
      borough,
      neighborhoods: list,
      walkedMeters,
      totalMeters,
      coveragePct: totalMeters > 0 ? (walkedMeters / totalMeters) * 100 : 0,
      startedCount,
    });
  }
  return groups;
}

export default function BoroughRollup({
  neighborhoods,
  onBoroughClick,
  selectedBorough,
}: {
  neighborhoods: Neighborhood[];
  onBoroughClick?: (borough: string | null) => void;
  selectedBorough?: string | null;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (neighborhoods.length === 0) return null;

  const groups = groupByBorough(neighborhoods);

  return (
    <div className="space-y-2">
      {groups.map((g) => {
        const isOpen = expanded === g.borough;
        const isSelected = selectedBorough === g.borough;
        return (
          <button
            key={g.borough}
            type="button"
            onClick={() => {
              const next = isOpen ? null : g.borough;
              setExpanded(next);
              onBoroughClick?.(next);
            }}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              isOpen || isSelected
                ? "bg-zinc-800 border-zinc-600"
                : "bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700"
            }`}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold ${BOROUGH_TEXT[g.borough] ?? "text-white"}`}>
                  {g.borough}
                </div>
                <div className="text-xs text-zinc-500">
                  {g.startedCount}/{g.neighborhoods.length} neighborhoods started
                </div>
              </div>
              <div className="text-sm font-bold text-white ml-2">
                {g.coveragePct.toFixed(1)}%
              </div>
            </div>

            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${BOROUGH_BAR[g.borough] ?? "bg-zinc-500"}`}
                style={{ width: `${Math.min(g.coveragePct, 100)}%` }}
              />
            </div>

            <div className="text-xs text-zinc-600 mt-1">
              {(g.walkedMeters / 1609.34).toFixed(1)} /{" "}
              {(g.totalMeters / 1609.34).toFixed(1)} mi
            </div>
          </button>
        );
      })}
    </div>
  );
}
