"use client";

import { useEffect, useRef, useState } from "react";

// Use mapboxgl from CDN (loaded via script tag in layout.tsx)
// This avoids Turbopack/webpack worker bundling issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const mapboxgl: any;

interface WalkMapProps {
  onNeighborhoodClick?: (ntaCode: string, ntaName: string) => void;
}

export default function WalkMap({ onNeighborhoodClick }: WalkMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClickRef = useRef(onNeighborhoodClick);
  onClickRef.current = onNeighborhoodClick;

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Wait for mapboxgl to be available from CDN
    if (typeof mapboxgl === "undefined") {
      setError("Mapbox GL not loaded");
      return;
    }

    let cancelled = false;

    fetch("/api/config")
      .then((r) => r.json())
      .then((config) => {
        if (cancelled || !mapContainer.current) return;

        mapboxgl.accessToken = config.mapboxToken;

        const m = new mapboxgl.Map({
          container: mapContainer.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-73.935242, 40.73061],
          zoom: 12,
        });

        m.addControl(new mapboxgl.NavigationControl(), "top-right");

        m.on("error", (e: { error?: { message?: string } }) => {
          console.error("Mapbox error:", e.error);
          setError(e.error?.message || "Map error");
        });

        m.on("load", async () => {
          if (cancelled) return;
          map.current = m;
          setLoaded(true);

          // Load walked paths
          try {
            const res = await fetch("/api/walks");
            const geojson = await res.json();
            m.addSource("walked-paths", { type: "geojson", data: geojson });
            m.addLayer({
              id: "walked-paths-layer",
              type: "line",
              source: "walked-paths",
              paint: {
                "line-color": "#00ffd5",
                "line-width": 3,
                "line-opacity": 0.85,
              },
            });
          } catch (err) {
            console.error("Failed to load walks:", err);
          }

          // Load neighborhoods
          try {
            const [ntaRes, statsRes] = await Promise.all([
              fetch("/data/nta-boundaries.geojson"),
              fetch("/api/neighborhoods"),
            ]);
            const geojson = await ntaRes.json();
            const { neighborhoods } = await statsRes.json();

            const coverageMap: Record<string, number> = {};
            for (const n of neighborhoods) {
              coverageMap[n.nta_code] = Number(n.coverage_pct) || 0;
            }

            for (const feature of geojson.features) {
              const code = feature.properties.NTA2020 || feature.properties.nta2020;
              feature.properties.coverage_pct = coverageMap[code] || 0;
            }

            m.addSource("neighborhoods", { type: "geojson", data: geojson });

            m.addLayer(
              {
                id: "neighborhoods-fill",
                type: "fill",
                source: "neighborhoods",
                paint: {
                  "fill-color": [
                    "interpolate",
                    ["linear"],
                    ["get", "coverage_pct"],
                    0, "rgba(255, 59, 48, 0.15)",
                    10, "rgba(255, 149, 0, 0.25)",
                    30, "rgba(255, 204, 0, 0.3)",
                    60, "rgba(52, 199, 89, 0.35)",
                    90, "rgba(255, 215, 0, 0.45)",
                  ],
                  "fill-opacity": 0.6,
                },
              },
              "walked-paths-layer"
            );

            m.addLayer(
              {
                id: "neighborhoods-outline",
                type: "line",
                source: "neighborhoods",
                paint: {
                  "line-color": "rgba(255, 255, 255, 0.2)",
                  "line-width": 1,
                },
              },
              "walked-paths-layer"
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            m.on("click", "neighborhoods-fill", (e: any) => {
              if (e.features?.[0]) {
                const props = e.features[0].properties!;
                const code = props.NTA2020 || props.nta2020;
                const name = props.NTAName || props.ntaname || code;
                onClickRef.current?.(code, name);

                new mapboxgl.Popup({ className: "dark-popup" })
                  .setLngLat(e.lngLat)
                  .setHTML(
                    `<div style="color:#fff;font-size:14px"><strong>${name}</strong><br/>Coverage: ${(props.coverage_pct || 0).toFixed(1)}%</div>`
                  )
                  .addTo(m);
              }
            });

            m.on("mouseenter", "neighborhoods-fill", () => {
              m.getCanvas().style.cursor = "pointer";
            });
            m.on("mouseleave", "neighborhoods-fill", () => {
              m.getCanvas().style.cursor = "";
            });
          } catch (err) {
            console.error("Failed to load neighborhoods:", err);
          }
        });
      })
      .catch((err) => {
        console.error("Failed to init map:", err);
        setError("Failed to initialize map");
      });

    return () => {
      cancelled = true;
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="absolute inset-0" />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-zinc-400 text-lg">
            {error ? `Error: ${error}` : "Loading map..."}
          </div>
        </div>
      )}
    </div>
  );
}
