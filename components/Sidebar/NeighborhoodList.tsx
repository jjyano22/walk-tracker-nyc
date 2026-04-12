"use client";

interface Neighborhood {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  walked_street_length_meters: number;
  total_street_length_meters: number;
}

function coverageColor(pct: number): string {
  if (pct >= 90) return "bg-yellow-400";
  if (pct >= 60) return "bg-green-500";
  if (pct >= 30) return "bg-yellow-500";
  if (pct >= 10) return "bg-orange-500";
  if (pct > 0) return "bg-red-500";
  return "bg-zinc-700";
}

function boroughColor(borough: string): string {
  const colors: Record<string, string> = {
    Manhattan: "text-blue-400",
    Brooklyn: "text-green-400",
    Queens: "text-purple-400",
    Bronx: "text-orange-400",
    "Staten Island": "text-pink-400",
  };
  return colors[borough] || "text-zinc-400";
}

export default function NeighborhoodList({
  neighborhoods,
  selectedCode,
  onHover,
}: {
  neighborhoods: Neighborhood[];
  selectedCode?: string | null;
  onHover?: (code: string | null) => void;
}) {
  if (neighborhoods.length === 0) {
    return (
      <p className="text-zinc-600 text-sm">
        No neighborhood data yet. Set up the street data first.
      </p>
    );
  }

  // Show neighborhoods with progress first, then alphabetical
  const sorted = [...neighborhoods].sort((a, b) => {
    if (a.coverage_pct > 0 && b.coverage_pct === 0) return -1;
    if (a.coverage_pct === 0 && b.coverage_pct > 0) return 1;
    if (a.coverage_pct !== b.coverage_pct) return b.coverage_pct - a.coverage_pct;
    return a.nta_name.localeCompare(b.nta_name);
  });

  return (
    <div className="space-y-2">
      {sorted.map((n) => (
        <div
          key={n.nta_code}
          onMouseEnter={() => onHover?.(n.nta_code)}
          onMouseLeave={() => onHover?.(null)}
          className={`p-3 rounded-lg border transition-colors cursor-pointer ${
            selectedCode === n.nta_code
              ? "bg-zinc-800 border-zinc-600"
              : "bg-zinc-900/50 border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700"
          }`}
        >
          <div className="flex justify-between items-start mb-2">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">
                {n.nta_name}
              </div>
              <div className={`text-xs ${boroughColor(n.borough)}`}>
                {n.borough}
              </div>
            </div>
            <div className="text-sm font-bold text-white ml-2">
              {n.coverage_pct.toFixed(1)}%
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${coverageColor(n.coverage_pct)}`}
              style={{ width: `${Math.min(n.coverage_pct, 100)}%` }}
            />
          </div>

          {n.coverage_pct > 0 && (
            <div className="text-xs text-zinc-600 mt-1">
              {(n.walked_street_length_meters / 1609.34).toFixed(1)} /{" "}
              {(n.total_street_length_meters / 1609.34).toFixed(1)} mi
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
