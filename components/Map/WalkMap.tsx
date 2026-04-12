"use client";

import { useEffect, useRef, useState } from "react";

interface WalkMapProps {
  onNeighborhoodClick?: (ntaCode: string, ntaName: string) => void;
}

export default function WalkMap({ onNeighborhoodClick }: WalkMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading map...");
  const initialized = useRef(false);
  const onClickRef = useRef(onNeighborhoodClick);
  onClickRef.current = onNeighborhoodClick;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    // Poll for mapboxgl from CDN
    const interval = setInterval(async () => {
      if (!win.mapboxgl || !mapRef.current) return;
      clearInterval(interval);

      try {
        // Get token
        const res = await fetch("/api/config");
        const { mapboxToken } = await res.json();

        const mb = win.mapboxgl;
        mb.accessToken = mapboxToken;

        const map = new mb.Map({
          container: mapRef.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-73.935242, 40.73061],
          zoom: 12,
        });

        map.addControl(new mb.NavigationControl(), "top-right");

        map.on("error", (e: any) => {
          console.error("Map error:", e);
          setStatus("Map error: " + (e.error?.message || "unknown"));
        });

        map.on("load", async () => {
          setStatus("");

          // Load walked paths
          try {
            const walkRes = await fetch("/api/walks");
            const walkGeo = await walkRes.json();
            map.addSource("walked-paths", { type: "geojson", data: walkGeo });
            map.addLayer({
              id: "walked-paths-layer",
              type: "line",
              source: "walked-paths",
              paint: { "line-color": "#00ffd5", "line-width": 3, "line-opacity": 0.85 },
            });
          } catch (e) { console.error("walks error:", e); }

          // Load neighborhoods
          try {
            const [ntaRes, statsRes] = await Promise.all([
              fetch("/data/nta-boundaries.geojson"),
              fetch("/api/neighborhoods"),
            ]);
            const ntaGeo = await ntaRes.json();
            const { neighborhoods } = await statsRes.json();

            const coverage: Record<string, number> = {};
            for (const n of neighborhoods) coverage[n.nta_code] = Number(n.coverage_pct) || 0;
            for (const f of ntaGeo.features) {
              const code = f.properties.NTA2020 || f.properties.nta2020;
              f.properties.coverage_pct = coverage[code] || 0;
            }

            map.addSource("neighborhoods", { type: "geojson", data: ntaGeo });
            map.addLayer({
              id: "neighborhoods-fill", type: "fill", source: "neighborhoods",
              paint: {
                "fill-color": ["interpolate", ["linear"], ["get", "coverage_pct"],
                  0, "rgba(0,0,0,0)", 1, "rgba(255,149,0,0.15)",
                  10, "rgba(255,204,0,0.2)", 30, "rgba(255,204,0,0.3)",
                  60, "rgba(52,199,89,0.35)", 90, "rgba(255,215,0,0.45)"],
                "fill-opacity": 1,
              },
            }, "walked-paths-layer");
            map.addLayer({
              id: "neighborhoods-outline", type: "line", source: "neighborhoods",
              paint: { "line-color": "rgba(255,255,255,0.2)", "line-width": 1 },
            }, "walked-paths-layer");

            map.on("click", "neighborhoods-fill", (e: any) => {
              if (e.features?.[0]) {
                const p = e.features[0].properties;
                const code = p.NTA2020 || p.nta2020;
                const name = p.NTAName || p.ntaname || code;
                onClickRef.current?.(code, name);
                new mb.Popup({ className: "dark-popup" })
                  .setLngLat(e.lngLat)
                  .setHTML(`<div style="color:#fff;font-size:14px"><strong>${name}</strong><br/>Coverage: ${(p.coverage_pct||0).toFixed(1)}%</div>`)
                  .addTo(map);
              }
            });
            map.on("mouseenter", "neighborhoods-fill", () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", "neighborhoods-fill", () => { map.getCanvas().style.cursor = ""; });
          } catch (e) { console.error("neighborhoods error:", e); }
        });
      } catch (e) {
        console.error("Map init error:", e);
        setStatus("Failed to initialize map");
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div ref={mapRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      {status && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "#09090b", color: "#a1a1aa", fontSize: "18px",
        }}>
          {status}
        </div>
      )}
    </>
  );
}
