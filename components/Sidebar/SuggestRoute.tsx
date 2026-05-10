"use client";

import { useState } from "react";

interface RouteResult {
  distance_miles: number;
  duration_min: number;
  unwalked_nearby: number;
  error?: string;
}

export default function SuggestRoute({
  onRoute,
  onClear,
  hasRoute,
}: {
  onRoute: (routeGeoJSON: GeoJSON.Feature) => void;
  onClear: () => void;
  hasRoute: boolean;
}) {
  const [state, setState] = useState<
    "idle" | "locating" | "loading" | "error"
  >("idle");
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSuggest() {
    setState("locating");
    setError(null);

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      setState("loading");
      const { latitude, longitude } = pos.coords;
      const res = await fetch(
        `/api/suggest-route?lat=${latitude}&lng=${longitude}&duration=45`
      );
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        setState("error");
        return;
      }

      setResult({
        distance_miles: data.distance_miles,
        duration_min: data.duration_min,
        unwalked_nearby: data.unwalked_nearby,
      });
      onRoute(data.route);
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setState("error");
    }
  }

  const loading = state === "locating" || state === "loading";

  return (
    <div className="mb-4">
      {!hasRoute ? (
        <button
          type="button"
          onClick={handleSuggest}
          disabled={loading}
          className={`w-full text-sm rounded-md border px-3 py-2 transition-colors ${
            loading
              ? "bg-zinc-900 border-zinc-800 text-zinc-500 cursor-not-allowed"
              : "bg-violet-950/40 border-violet-800/50 text-violet-300 hover:bg-violet-900/40 hover:border-violet-700"
          }`}
        >
          {state === "locating"
            ? "Getting location…"
            : state === "loading"
              ? "Finding route…"
              : "Suggest a 45-min walk"}
        </button>
      ) : (
        <div className="space-y-2">
          {result && (
            <div className="text-xs text-zinc-400">
              <span className="text-white font-semibold">
                {result.distance_miles} mi
              </span>{" "}
              · ~{result.duration_min} min ·{" "}
              {result.unwalked_nearby} unwalked streets nearby
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onClear();
              setResult(null);
            }}
            className="w-full text-sm rounded-md border px-3 py-2 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 transition-colors"
          >
            Dismiss route
          </button>
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}
