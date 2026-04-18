"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";

interface WalkMapProps {
  onNeighborhoodClick?: (ntaCode: string, ntaName: string) => void;
  hoveredNeighborhood?: string | null;
  selectedNeighborhood?: string | null;
  selectedBoroughCodes?: string[] | null;
}

type GeoFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

interface WalkSegmentProperties {
  mode: string | null;
  speed_mps: number;
  distance_m: number;
  duration_s: number;
  start_time: string;
  end_time: string;
}

type WalkSegmentFeature = GeoJSON.Feature<
  GeoJSON.LineString,
  WalkSegmentProperties
>;

interface WalkCollection {
  type: "FeatureCollection";
  features: WalkSegmentFeature[];
}

// Expansion thresholds for one-tap reclassification.
// If the clicked segment is "fast" (> 1.5 m/s), we grow the range to
// include contiguous fast segments so a single tap tags the whole
// subway ride from entry to exit. A slow click (walking) only tags
// the one segment.
const FAST_MPS = 1.5;
const MAX_EXPAND_GAP_SECONDS = 60;

function featureBBox(
  feature: GeoFeature
): [[number, number], [number, number]] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visit = (coords: unknown): void => {
    if (
      Array.isArray(coords) &&
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      const x = coords[0];
      const y = coords[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      return;
    }
    if (Array.isArray(coords)) {
      for (const c of coords) visit(c);
    }
  };

  const geom = feature.geometry as GeoJSON.Geometry & { coordinates?: unknown };
  if (geom && "coordinates" in geom) visit(geom.coordinates);
  if (!isFinite(minX)) return null;
  return [
    [minX, minY],
    [maxX, maxY],
  ];
}

function responsivePadding(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const isDesktop =
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 768px)").matches;
  return isDesktop
    ? { top: 60, bottom: 60, left: 60, right: 340 }
    : { top: 60, bottom: 220, left: 40, right: 40 };
}

// Given the features list (sorted by time) and an index, walk outward
// while neighboring segments remain "fast" and adjacent in time.
// Returns the inclusive index range of the expanded run.
function expandFastRun(
  features: WalkSegmentFeature[],
  clickedIdx: number
): { startIdx: number; endIdx: number } {
  const clicked = features[clickedIdx];
  if (!clicked || clicked.properties.speed_mps <= FAST_MPS) {
    return { startIdx: clickedIdx, endIdx: clickedIdx };
  }

  const contiguous = (a: WalkSegmentFeature, b: WalkSegmentFeature): boolean => {
    const gap =
      (new Date(b.properties.start_time).getTime() -
        new Date(a.properties.end_time).getTime()) /
      1000;
    return Math.abs(gap) <= MAX_EXPAND_GAP_SECONDS;
  };

  let startIdx = clickedIdx;
  while (startIdx > 0) {
    const prev = features[startIdx - 1];
    const curr = features[startIdx];
    if (prev.properties.speed_mps > FAST_MPS && contiguous(prev, curr)) {
      startIdx -= 1;
    } else {
      break;
    }
  }

  let endIdx = clickedIdx;
  while (endIdx < features.length - 1) {
    const curr = features[endIdx];
    const next = features[endIdx + 1];
    if (next.properties.speed_mps > FAST_MPS && contiguous(curr, next)) {
      endIdx += 1;
    } else {
      break;
    }
  }

  return { startIdx, endIdx };
}

export default function WalkMap({
  onNeighborhoodClick,
  hoveredNeighborhood,
  selectedNeighborhood,
  selectedBoroughCodes,
}: WalkMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const featuresByCode = useRef<Record<string, GeoFeature>>({});
  const walkFeaturesRef = useRef<WalkSegmentFeature[]>([]);
  const onClickRef = useRef(onNeighborhoodClick);
  const initialized = useRef(false);
  const [status, setStatus] = useState("Loading map...");
  const [layersReady, setLayersReady] = useState(false);

  useEffect(() => {
    onClickRef.current = onNeighborhoodClick;
  }, [onNeighborhoodClick]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const win = window as unknown as { mapboxgl?: typeof mapboxgl };

    const interval = setInterval(async () => {
      if (!win.mapboxgl || !mapRef.current) return;
      clearInterval(interval);

      try {
        const res = await fetch("/api/config");
        const { mapboxToken } = await res.json();

        const mb = win.mapboxgl!;
        mb.accessToken = mapboxToken;

        const map = new mb.Map({
          container: mapRef.current!,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-73.935242, 40.73061],
          zoom: 12,
        });

        map.addControl(new mb.NavigationControl(), "top-right");

        mapInstance.current = map;

        map.on("error", (e: mapboxgl.ErrorEvent) => {
          console.error("Map error:", e);
          setStatus("Map error: " + (e.error?.message || "unknown"));
        });

        map.on("load", async () => {
          setStatus("");

          // Load walked paths
          try {
            const walkRes = await fetch("/api/walks");
            const walkGeo = (await walkRes.json()) as WalkCollection;
            walkFeaturesRef.current = walkGeo.features ?? [];
            map.addSource("walked-paths", { type: "geojson", data: walkGeo });

            // Per-segment paint: manual mode overrides win; otherwise
            // fall back to a speed-based gradient.
            const modeColor: mapboxgl.ExpressionSpecification = [
              "match",
              ["coalesce", ["get", "mode"], ""],
              "walk",
              "#00ffd5",
              "subway",
              "#a78bfa",
              "bike",
              "#f472b6",
              [
                "interpolate",
                ["linear"],
                ["get", "speed_mps"],
                0,
                "#00ffd5",
                1.5,
                "#00ffd5",
                2.5,
                "#7dd3fc",
                4,
                "#a78bfa",
                10,
                "#a78bfa",
              ],
            ];

            map.addLayer({
              id: "walked-paths-layer",
              type: "line",
              source: "walked-paths",
              paint: {
                "line-color": modeColor,
                "line-width": [
                  "interpolate",
                  ["linear"],
                  ["get", "speed_mps"],
                  0,
                  3,
                  2.5,
                  2.5,
                  4,
                  2,
                ],
                "line-opacity": 0.85,
              },
            });

            // Invisible wider hit layer for forgiving mobile taps.
            map.addLayer({
              id: "walked-paths-hit",
              type: "line",
              source: "walked-paths",
              paint: {
                "line-color": "#000",
                "line-opacity": 0,
                "line-width": 22,
              },
            });

            const openSegmentPopup = (
              e: mapboxgl.MapLayerMouseEvent,
              feature: WalkSegmentFeature
            ) => {
              const features = walkFeaturesRef.current;
              const clickedIdx = features.findIndex(
                (f) =>
                  f.properties.start_time === feature.properties.start_time &&
                  f.properties.end_time === feature.properties.end_time
              );
              const run =
                clickedIdx >= 0
                  ? expandFastRun(features, clickedIdx)
                  : { startIdx: -1, endIdx: -1 };

              const runCount =
                run.startIdx >= 0 ? run.endIdx - run.startIdx + 1 : 1;
              const rangeStart =
                run.startIdx >= 0
                  ? features[run.startIdx].properties.start_time
                  : feature.properties.start_time;
              const rangeEnd =
                run.endIdx >= 0
                  ? features[run.endIdx].properties.end_time
                  : feature.properties.end_time;

              let totalDist = 0;
              let totalDur = 0;
              if (run.startIdx >= 0) {
                for (let i = run.startIdx; i <= run.endIdx; i++) {
                  totalDist += features[i].properties.distance_m;
                  totalDur += features[i].properties.duration_s;
                }
              } else {
                totalDist = feature.properties.distance_m;
                totalDur = feature.properties.duration_s;
              }
              const avgMps = totalDur > 0 ? totalDist / totalDur : 0;

              const currentMode =
                typeof feature.properties.mode === "string" &&
                feature.properties.mode
                  ? feature.properties.mode
                  : null;

              const headerText =
                runCount > 1
                  ? `${runCount} segments · ${(totalDist / 1000).toFixed(2)} km · ${avgMps.toFixed(1)} m/s avg`
                  : `${avgMps.toFixed(1)} m/s · ${totalDist}m · ${totalDur}s`;

              const popupNode = document.createElement("div");
              popupNode.className = "walk-mode-popup";
              popupNode.innerHTML = `
                <div style="color:#fff;font-size:13px;min-width:200px">
                  <div style="color:#a1a1aa;font-size:11px;margin-bottom:8px">
                    ${headerText}
                    ${currentMode ? `<br/><span style="color:#e5e7eb">Tagged: <strong>${currentMode}</strong></span>` : ""}
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                    <button data-mode="walk"   style="padding:6px 8px;background:#00ffd520;border:1px solid #00ffd5;color:#00ffd5;border-radius:6px;cursor:pointer">Walk</button>
                    <button data-mode="subway" style="padding:6px 8px;background:#a78bfa20;border:1px solid #a78bfa;color:#a78bfa;border-radius:6px;cursor:pointer">Subway</button>
                    <button data-mode="bike"   style="padding:6px 8px;background:#f472b620;border:1px solid #f472b6;color:#f472b6;border-radius:6px;cursor:pointer">Bike</button>
                  </div>
                  <button data-mode="auto" style="margin-top:6px;width:100%;padding:6px 8px;background:transparent;border:1px solid #3f3f46;color:#a1a1aa;border-radius:6px;cursor:pointer;font-size:11px">Reset to auto</button>
                  <button data-action="delete" data-confirm="0" style="margin-top:6px;width:100%;padding:6px 8px;background:transparent;border:1px solid #3f3f46;color:#ef4444;border-radius:6px;cursor:pointer;font-size:11px">Remove segment</button>
                </div>
              `;

              const popup = new mb.Popup({ className: "dark-popup" })
                .setLngLat(e.lngLat)
                .setDOMContent(popupNode)
                .addTo(map);

              const refreshSource = async () => {
                const refreshed = await fetch("/api/walks");
                const refreshedGeo = (await refreshed.json()) as WalkCollection;
                walkFeaturesRef.current = refreshedGeo.features ?? [];
                const src = map.getSource(
                  "walked-paths"
                ) as mapboxgl.GeoJSONSource | undefined;
                if (src) src.setData(refreshedGeo);
              };

              popupNode.addEventListener("click", async (ev) => {
                const target = ev.target as HTMLElement;
                const btn = target.closest(
                  "button[data-mode], button[data-action]"
                ) as HTMLButtonElement | null;
                if (!btn) return;

                const action = btn.dataset.action;
                const mode = btn.dataset.mode;

                if (action === "delete") {
                  // Two-step confirm: first tap arms it, second tap fires.
                  if (btn.dataset.confirm !== "1") {
                    btn.dataset.confirm = "1";
                    btn.style.background = "#ef444420";
                    btn.style.borderColor = "#ef4444";
                    btn.textContent = "Tap again to confirm";
                    return;
                  }
                  btn.disabled = true;
                  btn.style.opacity = "0.5";
                  try {
                    const res = await fetch("/api/walks/delete", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        start_ts: rangeStart,
                        end_ts: rangeEnd,
                      }),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    popup.remove();
                    await refreshSource();
                  } catch (err) {
                    console.error("delete failed:", err);
                    btn.style.border = "1px solid #ef4444";
                    btn.textContent = "Failed";
                  }
                  return;
                }

                if (mode) {
                  btn.disabled = true;
                  btn.style.opacity = "0.5";
                  try {
                    const res = await fetch("/api/walks/mode", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        start_ts: rangeStart,
                        end_ts: rangeEnd,
                        mode,
                      }),
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    popup.remove();
                    await refreshSource();
                  } catch (err) {
                    console.error("mode update failed:", err);
                    btn.style.border = "1px solid #ef4444";
                    btn.textContent = "Failed";
                  }
                }
              });
            };

            map.on(
              "click",
              "walked-paths-hit",
              (e: mapboxgl.MapLayerMouseEvent) => {
                const feature = e.features?.[0];
                if (!feature) return;
                openSegmentPopup(e, feature as unknown as WalkSegmentFeature);
              }
            );

            map.on("mouseenter", "walked-paths-hit", () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "walked-paths-hit", () => {
              map.getCanvas().style.cursor = "";
            });
          } catch (e) {
            console.error("walks error:", e);
          }

          // Load neighborhoods
          try {
            const [ntaRes, statsRes] = await Promise.all([
              fetch("/data/nta-boundaries.geojson"),
              fetch("/api/neighborhoods"),
            ]);
            const ntaGeo = (await ntaRes.json()) as GeoJSON.FeatureCollection<
              GeoJSON.Geometry,
              Record<string, unknown>
            >;
            const { neighborhoods } = await statsRes.json();

            const coverage: Record<string, number> = {};
            for (const n of neighborhoods) {
              coverage[n.nta_code] = Number(n.coverage_pct) || 0;
            }
            for (const f of ntaGeo.features) {
              const code =
                (f.properties.NTA2020 as string | undefined) ??
                (f.properties.nta2020 as string | undefined);
              if (code) {
                f.properties.coverage_pct = coverage[code] ?? 0;
                featuresByCode.current[code] = f as GeoFeature;
              }
            }

            map.addSource("neighborhoods", { type: "geojson", data: ntaGeo });
            map.addLayer(
              {
                id: "neighborhoods-fill",
                type: "fill",
                source: "neighborhoods",
                paint: {
                  "fill-color": [
                    "interpolate",
                    ["linear"],
                    ["get", "coverage_pct"],
                    0, "rgba(0,0,0,0)",
                    1, "rgba(255,149,0,0.15)",
                    10, "rgba(255,204,0,0.2)",
                    30, "rgba(255,204,0,0.3)",
                    60, "rgba(52,199,89,0.35)",
                    90, "rgba(255,215,0,0.45)",
                  ],
                  "fill-opacity": 1,
                },
              },
              "walked-paths-layer"
            );
            map.addLayer(
              {
                id: "neighborhoods-outline",
                type: "line",
                source: "neighborhoods",
                paint: {
                  "line-color": "rgba(255,255,255,0.2)",
                  "line-width": 1,
                },
              },
              "walked-paths-layer"
            );

            // Hover highlight (from sidebar list hover) — subtle.
            map.addLayer(
              {
                id: "neighborhoods-highlight",
                type: "fill",
                source: "neighborhoods",
                paint: {
                  "fill-color": "rgba(255,255,255,0.12)",
                  "fill-opacity": 1,
                },
                filter: ["==", "NTA2020", ""],
              },
              "walked-paths-layer"
            );

            // Selected highlight — brighter light-white fill over the
            // whole neighborhood (replaces the previous cyan border).
            map.addLayer(
              {
                id: "neighborhoods-selected-fill",
                type: "fill",
                source: "neighborhoods",
                paint: {
                  "fill-color": "rgba(255,255,255,0.25)",
                  "fill-opacity": 1,
                },
                filter: ["==", "NTA2020", ""],
              },
              "walked-paths-layer"
            );

            map.on(
              "click",
              "neighborhoods-fill",
              (e: mapboxgl.MapLayerMouseEvent) => {
                const feature = e.features?.[0];
                if (!feature) return;
                const p = (feature.properties ?? {}) as Record<string, unknown>;
                const code = (p.NTA2020 as string) || (p.nta2020 as string);
                const name =
                  (p.NTAName as string) || (p.ntaname as string) || code;
                onClickRef.current?.(code, name);
                new mb.Popup({ className: "dark-popup" })
                  .setLngLat(e.lngLat)
                  .setHTML(
                    `<div style="color:#fff;font-size:14px"><strong>${name}</strong><br/>Coverage: ${(
                      Number(p.coverage_pct) || 0
                    ).toFixed(1)}%</div>`
                  )
                  .addTo(map);
              }
            );
            map.on("mouseenter", "neighborhoods-fill", () => {
              map.getCanvas().style.cursor = "pointer";
            });
            map.on("mouseleave", "neighborhoods-fill", () => {
              map.getCanvas().style.cursor = "";
            });

            setLayersReady(true);
          } catch (e) {
            console.error("neighborhoods error:", e);
          }
        });
      } catch (e) {
        console.error("Map init error:", e);
        setStatus("Failed to initialize map");
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Highlight hovered neighborhood from sidebar
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;
    map.setFilter("neighborhoods-highlight", [
      "==",
      "NTA2020",
      hoveredNeighborhood ?? "",
    ]);
  }, [hoveredNeighborhood, layersReady]);

  // Highlight + fly to selected neighborhood
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;

    map.setFilter("neighborhoods-selected-fill", [
      "==",
      "NTA2020",
      selectedNeighborhood ?? "",
    ]);

    if (!selectedNeighborhood) return;
    const feature = featuresByCode.current[selectedNeighborhood];
    if (!feature) return;
    const bbox = featureBBox(feature);
    if (!bbox) return;

    map.fitBounds(bbox, {
      padding: responsivePadding(),
      duration: 800,
      maxZoom: 15,
    });
  }, [selectedNeighborhood, layersReady]);

  // Fly to selected borough (union bbox of its NTAs)
  const boroughCodesKey = (selectedBoroughCodes ?? []).join(",");
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;
    if (!selectedBoroughCodes || selectedBoroughCodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const code of selectedBoroughCodes) {
      const feature = featuresByCode.current[code];
      if (!feature) continue;
      const bbox = featureBBox(feature);
      if (!bbox) continue;
      if (bbox[0][0] < minX) minX = bbox[0][0];
      if (bbox[0][1] < minY) minY = bbox[0][1];
      if (bbox[1][0] > maxX) maxX = bbox[1][0];
      if (bbox[1][1] > maxY) maxY = bbox[1][1];
    }
    if (!isFinite(minX)) return;

    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      {
        padding: responsivePadding(),
        duration: 800,
        maxZoom: 13,
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boroughCodesKey, layersReady]);

  return (
    <>
      <div
        ref={mapRef}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {status && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#09090b",
            color: "#a1a1aa",
            fontSize: "18px",
          }}
        >
          {status}
        </div>
      )}
    </>
  );
}
