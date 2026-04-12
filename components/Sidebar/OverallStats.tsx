"use client";

interface Stats {
  total_km: string;
  total_miles: string;
  neighborhoods_started: number;
  total_neighborhoods: number;
  best_coverage_pct: string;
  total_gps_points: number;
  total_walked_segments: number;
}

function StatCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
      <div className="text-2xl font-bold text-white">
        {value}
        {unit && <span className="text-sm text-zinc-500 ml-1">{unit}</span>}
      </div>
      <div className="text-xs text-zinc-500 mt-1">{label}</div>
    </div>
  );
}

export default function OverallStats({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 h-16 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Distance Walked" value={stats.total_miles} unit="mi" />
      <StatCard
        label="Neighborhoods"
        value={`${stats.neighborhoods_started}/${stats.total_neighborhoods}`}
      />
      <StatCard label="Best Coverage" value={stats.best_coverage_pct} unit="%" />
      <StatCard label="GPS Points" value={stats.total_gps_points.toLocaleString()} />
    </div>
  );
}
