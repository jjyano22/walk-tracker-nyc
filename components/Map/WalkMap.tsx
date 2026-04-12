"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

interface WalkMapProps {
  onNeighborhoodClick?: (ntaCode: string, ntaName: string) => void;
}

export default function WalkMap({ onNeighborhoodClick }: WalkMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadWalkedPaths = useCallback(async (mapInstance: mapboxgl.Map) => {
    try {
      const res = await fetch("/api/walks");
      const geojson = await res.json();

      if (mapInstance.getSource("walked-paths")) {
        (mapInstance.getSource("walked-paths") as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
        mapInstance.addSource("walked-paths", {
          type: "geojson",
          data: geojson,
        });

        mapInstance.addLayer({
          id: "walked-paths-layer",
          type: "line",
          source: "walked-paths",
          paint: {
            "line-color": "#00ffd5",
            "line-width": 3,
            "line-opacity": 0.85,
          },
        });
      }
    } catch (err) {
      console.error("Failed to load walked paths:", err);
    }
  }, []);

  const loadNeighborhoods = useCallback(
    async (mapInstance: mapboxgl.Map) => {
      try {
        const res = await fetch("/data/nta-boundaries.geojson");
        const geojson = await res.json();

        // Fetch coverage stats
        const statsRes = await fetch("/api/neighborhoods");
        const { neighborhoods } = await statsRes.json();

        // Create a coverage map
        const coverageMap: Record<string, number> = {};
        for (const n of neighborhoods) {
          coverageMap[n.nta_code] = Number(n.coverage_pct) || 0;
        }

        // Add coverage_pct to each feature's properties
        for (const feature of geojson.features) {
          const code =
            feature.properties.NTA2020 || feature.properties.nta2020 || feature.properties.NTACode;
          feature.properties.coverage_pct = coverageMap[code] || 0;
        }

        mapInstance.addSource("neighborhoods", {
          type: "geojson",
          data: geojson,
        });

        // Filled polygons colored by coverage
        mapInstance.addLayer(
          {
            id: "neighborhoods-fill",
            type: "fill",
            source: "neighborhoods",
            paint: {
              "fill-color": [
                "interpolate",
                ["linear"],
                ["get", "coverage_pct"],
                0,
                "rgba(255, 59, 48, 0.15)",
                10,
                "rgba(255, 149, 0, 0.25)",
                30,
                "rgba(255, 204, 0, 0.3)",
                60,
                "rgba(52, 199, 89, 0.35)",
                90,
                "rgba(255, 215, 0, 0.45)",
              ],
              "fill-opacity": 0.6,
            },
          },
          "walked-paths-layer"
        );

        // Outline
        mapInstance.addLayer(
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

        // Click handler
        mapInstance.on("click", "neighborhoods-fill", (e) => {
          if (e.features && e.features[0]) {
            const props = e.features[0].properties!;
            const code = props.NTA2020 || props.nta2020 || props.NTACode;
            const name = props.NTAName || props.ntaname || code;
            onNeighborhoodClick?.(code, name);

            new mapboxgl.Popup({ className: "dark-popup" })
              .setLngLat(e.lngLat)
              .setHTML(
                `<div style="color: #fff; font-size: 14px;">
                  <strong>${name}</strong><br/>
                  Coverage: ${(props.coverage_pct || 0).toFixed(1)}%
                </div>`
              )
              .addTo(mapInstance);
          }
        });

        // Hover cursor
        mapInstance.on("mouseenter", "neighborhoods-fill", () => {
          mapInstance.getCanvas().style.cursor = "pointer";
        });
        mapInstance.on("mouseleave", "neighborhoods-fill", () => {
          mapInstance.getCanvas().style.cursor = "";
        });
      } catch (err) {
        console.error("Failed to load neighborhoods:", err);
      }
    },
    [onNeighborhoodClick]
  );

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Fetch token from server to avoid build-time env inlining issues
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (config) => {
        if (!mapContainer.current || map.current) return;

        mapboxgl.accessToken = config.mapboxToken;

        const mapInstance = new mapboxgl.Map({
          container: mapContainer.current,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-73.935242, 40.73061],
          zoom: 12,
        });

        mapInstance.addControl(new mapboxgl.NavigationControl(), "top-right");

        mapInstance.on("load", async () => {
          map.current = mapInstance;
          setLoaded(true);
          await loadWalkedPaths(mapInstance);
          await loadNeighborhoods(mapInstance);
        });
      })
      .catch((err) => console.error("Failed to load config:", err));

    return () => {
      if (map.current) {
        map.current.remove();
        map.current = null;
      }
    };
  }, [loadWalkedPaths, loadNeighborhoods]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="absolute inset-0" />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
          <div className="text-zinc-400 text-lg">Loading map...</div>
        </div>
      )}
    </div>
  );
}
