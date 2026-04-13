"use client";

import { useEffect, useMemo, useState } from "react";
import OverallStats from "./OverallStats";
import NeighborhoodList from "./NeighborhoodList";
import BoroughRollup from "./BoroughRollup";
import NextUp, { NextUpData } from "./NextUp";
import RefreshButton from "./RefreshButton";

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
  onNeighborhoodHover?: (code: string | null) => void;
  onNeighborhoodSelect?: (code: string) => void;
  onBoroughChange?: (borough: string | null, codes: string[]) => void;
}

function SidebarBody({
  stats,
  neighborhoods,
  parks,
  nextUp,
  selectedBorough,
  setSelectedBorough,
  selectedNeighborhood,
  onNeighborhoodHover,
  onNeighborhoodSelect,
}: {
  stats: Stats | null;
  neighborhoods: Neighborhood[];
  parks: { count: number; total: number } | null;
  nextUp: NextUpData | null;
  selectedBorough: string | null;
  setSelectedBorough: (b: string | null) => void;
  selectedNeighborhood?: string | null;
  onNeighborhoodHover?: (code: string | null) => void;
  onNeighborhoodSelect?: (code: string) => void;
}) {
  const filteredNeighborhoods = useMemo(() => {
    if (!selectedBorough) return neighborhoods;
    return neighborhoods.filter((n) => n.borough === selectedBorough);
  }, [neighborhoods, selectedBorough]);

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold text-white mb-1">Walk Tracker NYC</h1>
      <p className="text-sm text-zinc-500 mb-4">
        Every step, every street, every neighborhood
      </p>

      <RefreshButton />

      <OverallStats
        stats={stats}
        parksCount={parks?.count}
        parksTotal={parks?.total}
      />

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Next Up
        </h2>
        <NextUp
          data={nextUp}
          onNeighborhoodHover={onNeighborhoodHover}
          onNeighborhoodSelect={onNeighborhoodSelect}
        />
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          Boroughs
        </h2>
        <BoroughRollup
          neighborhoods={neighborhoods}
          selectedBorough={selectedBorough}
          onBoroughClick={setSelectedBorough}
        />
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Neighborhoods
            {selectedBorough && (
              <span className="ml-2 text-zinc-600 normal-case font-normal">
                · {selectedBorough}
              </span>
            )}
          </h2>
          {selectedBorough && (
            <button
              type="button"
              onClick={() => setSelectedBorough(null)}
              className="text-xs text-zinc-500 hover:text-white transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <NeighborhoodList
          neighborhoods={filteredNeighborhoods}
          selectedCode={selectedNeighborhood}
          onHover={onNeighborhoodHover}
        />
      </div>
    </div>
  );
}

export default function Sidebar({
  selectedNeighborhood,
  onNeighborhoodHover,
  onNeighborhoodSelect,
  onBoroughChange,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([]);
  const [parks, setParks] = useState<{
    count: number;
    total: number;
    visited: Array<{ name: string; category: string }>;
  } | null>(null);
  const [nextUp, setNextUp] = useState<NextUpData | null>(null);
  const [selectedBorough, setSelectedBoroughState] = useState<string | null>(null);

  const setSelectedBorough = (borough: string | null) => {
    setSelectedBoroughState(borough);
    const codes = borough
      ? neighborhoods.filter((n) => n.borough === borough).map((n) => n.nta_code)
      : [];
    onBoroughChange?.(borough, codes);
  };

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error);

    fetch("/api/neighborhoods")
      .then((r) => r.json())
      .then((data) => setNeighborhoods(data.neighborhoods || []))
      .catch(console.error);

    fetch("/api/parks")
      .then((r) => r.json())
      .then(setParks)
      .catch(console.error);

    fetch("/api/next-up")
      .then((r) => r.json())
      .then(setNextUp)
      .catch(console.error);
  }, []);

  const body = (
    <SidebarBody
      stats={stats}
      neighborhoods={neighborhoods}
      parks={parks}
      nextUp={nextUp}
      selectedBorough={selectedBorough}
      setSelectedBorough={setSelectedBorough}
      selectedNeighborhood={selectedNeighborhood}
      onNeighborhoodHover={onNeighborhoodHover}
      onNeighborhoodSelect={onNeighborhoodSelect}
    />
  );

  return (
    <>
      {/* Desktop: right side panel */}
      <div
        className={`hidden md:block fixed top-0 right-0 h-full z-10 transition-all duration-300 ${
          collapsed ? "w-12" : "w-80"
        }`}
      >
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-4 -left-10 w-8 h-8 bg-zinc-900 border border-zinc-700 rounded-l-lg flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? "<" : ">"}
        </button>

        {!collapsed && (
          <div className="h-full bg-zinc-950/90 backdrop-blur-md border-l border-zinc-800 overflow-y-auto">
            {body}
          </div>
        )}
      </div>

      {/* Mobile: bottom sheet */}
      <div
        className={`md:hidden fixed left-0 right-0 bottom-0 z-10 bg-zinc-950/95 backdrop-blur-md border-t border-zinc-800 rounded-t-xl shadow-2xl transition-[max-height] duration-300 ease-out flex flex-col ${
          mobileExpanded ? "max-h-[85vh]" : "max-h-[120px]"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          type="button"
          onClick={() => setMobileExpanded((v) => !v)}
          className="flex flex-col items-center justify-start pt-2 pb-1 shrink-0"
          aria-label={mobileExpanded ? "Collapse sheet" : "Expand sheet"}
          aria-expanded={mobileExpanded}
        >
          <div className="w-10 h-1 rounded-full bg-zinc-700" />
          <div className="mt-2 flex items-center gap-3 px-4 w-full justify-between">
            <div className="text-sm font-semibold text-white">
              Walk Tracker NYC
            </div>
            <div className="flex items-center gap-3 text-xs text-zinc-400">
              {stats && (
                <>
                  <span>
                    <span className="text-white font-semibold">
                      {stats.total_miles}
                    </span>{" "}
                    mi
                  </span>
                  <span>
                    <span className="text-white font-semibold">
                      {stats.neighborhoods_started}
                    </span>
                    /{stats.total_neighborhoods} nbhds
                  </span>
                </>
              )}
              <span className="text-zinc-500">{mobileExpanded ? "v" : "^"}</span>
            </div>
          </div>
        </button>

        {mobileExpanded && (
          <div className="overflow-y-auto overscroll-contain flex-1">
            {body}
          </div>
        )}
      </div>
    </>
  );
}
