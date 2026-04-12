"use client";

import { useEffect, useState } from "react";
import OverallStats from "./OverallStats";
import NeighborhoodList from "./NeighborhoodList";

interface Stats {
  total_km: string;
  total_miles: string;
  neighborhoods_started: number;
  total_neighborhoods: number;
  best_coverage_pct: string;
  total_gps_points: number;
  total_walked_segments: number;
}

interface Neighborhood {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  walked_street_length_meters: number;
  total_street_length_meters: number;
}

interface SidebarProps {
  selectedNeighborhood?: string | null;
}

export default function Sidebar({ selectedNeighborhood }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);

    fetch("/api/neighborhoods")
      .then((r) => r.json())
      .then((data) => setNeighborhoods(data.neighborhoods || []))
      .catch(console.error);
  }, []);

  return (
    <div
      className={`fixed top-0 right-0 h-full z-10 transition-all duration-300 ${
        collapsed ? "w-12" : "w-80"
      }`}
    >
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute top-4 -left-10 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-l-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
      >
        {collapsed ? "<" : ">"}
      </button>

      {!collapsed && (
        <div className="h-full bg-zinc-950/90 backdrop-blur-md border-l border-zinc-800 overflow-y-auto">
          <div className="p-4">
            <h1 className="text-xl font-bold text-white mb-1">
              Walk Tracker NYC
            </h1>
            <p className="text-sm text-zinc-500 mb-6">
              Every step, every street, every neighborhood
            </p>

            <OverallStats stats={stats} />

            <div className="mt-6">
              <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Neighborhoods
              </h2>
              <NeighborhoodList
                neighborhoods={neighborhoods}
                selectedCode={selectedNeighborhood}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
