"use client";

interface NearCompletion {
  nta_code: string;
  nta_name: string;
  borough: string;
  coverage_pct: number;
  remaining_miles: number;
}

interface NearbyStreet {
  street_name: string;
  nta_code: string | null;
  nta_name: string | null;
  borough: string | null;
  distance_miles: number;
}

export interface NextUpData {
  near_completion: NearCompletion[];
  nearby_unwalked: NearbyStreet[];
}

export default function NextUp({
  data,
  onNeighborhoodHover,
  onNeighborhoodSelect,
}: {
  data: NextUpData | null;
  onNeighborhoodHover?: (code: string | null) => void;
  onNeighborhoodSelect?: (code: string) => void;
}) {
  if (!data) {
    return (
      <div className="bg-zinc-900/50 rounded-lg p-3 border border-zinc-800/50 h-20 animate-pulse" />
    );
  }

  const hasNearComplete = data.near_completion.length > 0;
  const hasNearby = data.nearby_unwalked.length > 0;
  if (!hasNearComplete && !hasNearby) return null;

  return (
    <div className="space-y-3">
      {hasNearComplete && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-1.5">Almost done</h3>
          <div className="space-y-1.5">
            {data.near_completion.map((n) => (
              <button
                key={n.nta_code}
                type="button"
                onMouseEnter={() => onNeighborhoodHover?.(n.nta_code)}
                onMouseLeave={() => onNeighborhoodHover?.(null)}
                onClick={() => onNeighborhoodSelect?.(n.nta_code)}
                className="w-full text-left p-2 rounded-md bg-zinc-900/50 border border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700 transition-colors"
              >
                <div className="flex justify-between items-center gap-2">
                  <div className="text-xs text-white truncate flex-1">
                    {n.nta_name}
                  </div>
                  <div className="text-xs font-bold text-yellow-400 shrink-0">
                    {n.coverage_pct.toFixed(0)}%
                  </div>
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5">
                  {n.remaining_miles.toFixed(1)} mi to go
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {hasNearby && (
        <div>
          <h3 className="text-xs font-medium text-zinc-500 mb-1.5">
            Closest unwalked streets
          </h3>
          <div className="space-y-1.5">
            {data.nearby_unwalked.map((s, i) => (
              <button
                key={`${s.street_name}-${s.nta_code ?? "x"}-${i}`}
                type="button"
                onMouseEnter={() =>
                  s.nta_code && onNeighborhoodHover?.(s.nta_code)
                }
                onMouseLeave={() => onNeighborhoodHover?.(null)}
                onClick={() =>
                  s.nta_code && onNeighborhoodSelect?.(s.nta_code)
                }
                className="w-full text-left p-2 rounded-md bg-zinc-900/50 border border-zinc-800/50 hover:bg-zinc-900 hover:border-zinc-700 transition-colors"
              >
                <div className="text-xs text-white truncate">
                  {s.street_name}
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5 truncate">
                  {s.nta_name ?? "Unknown area"}
                  {" · "}
                  {s.distance_miles.toFixed(2)} mi away
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
