"use client";

import { useEffect, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { cachedJson } from "@/lib/clientCache";

interface WalkMapProps {
  onNeighborhoodClick?: (ntaCode: string, ntaName: string) => void;
  hoveredNeighborhood?: string | null;
  selectedNeighborhood?: string | null;
  selectedBoroughCodes?: string[] | null;
  suggestedRoute?: GeoJSON.Feature | null;
}

type GeoFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

function featureBBox(
  feature: GeoFeature
): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === "number" && typeof coords[1] === "number") {
      if (coords[0] < minX) minX = coords[0];
      if (coords[0] > maxX) maxX = coords[0];
      if (coords[1] < minY) minY = coords[1];
      if (coords[1] > maxY) maxY = coords[1];
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) visit(c);
  };
  const geom = feature.geometry as GeoJSON.Geometry & { coordinates?: unknown };
  if (geom && "coordinates" in geom) visit(geom.coordinates);
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

function responsivePadding() {
  const isDesktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
  return isDesktop
    ? { top: 60, bottom: 60, left: 60, right: 340 }
    : { top: 60, bottom: 220, left: 40, right: 40 };
}

// True only when geolocation permission is ALREADY granted. Calling
// getCurrentPosition/watchPosition in the "prompt" state pops the iOS
// permission dialog — we never want to trigger that on open, so all
// location use is gated behind this check. If the Permissions API is
// unavailable, err on the side of never prompting.
async function geolocationGranted(): Promise<boolean> {
  if (!navigator.geolocation) return false;
  try {
    if (navigator.permissions?.query) {
      const st = await navigator.permissions.query({
        name: "geolocation" as PermissionName,
      });
      return st.state === "granted";
    }
  } catch {
    // fall through
  }
  return false;
}

// Get user position silently — resolves null unless permission is
// already granted, so this can never show a dialog.
async function getUserPosition(): Promise<{ lng: number; lat: number } | null> {
  if (!(await geolocationGranted())) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 }
    );
  });
}

export default function WalkMap({
  onNeighborhoodClick,
  hoveredNeighborhood,
  selectedNeighborhood,
  selectedBoroughCodes,
  suggestedRoute,
}: WalkMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<mapboxgl.Map | null>(null);
  const activePopup = useRef<mapboxgl.Popup | null>(null);
  const featuresByCode = useRef<Record<string, GeoFeature>>({});
  const onClickRef = useRef(onNeighborhoodClick);
  const initialized = useRef(false);
  const [status, setStatus] = useState("Loading map...");
  const [layersReady, setLayersReady] = useState(false);

  useEffect(() => { onClickRef.current = onNeighborhoodClick; }, [onNeighborhoodClick]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Start data fetches + geolocation immediately, in parallel with
    // mapbox CDN script load. walks/bounds/neighborhoods hydrate from
    // the last visit's localStorage snapshot for instant paint; the
    // boundaries file is cached by the service worker instead (too big
    // for localStorage).
    const walksC = cachedJson<GeoJSON.FeatureCollection>("wt:walks", "/api/walks");
    const boundsC = cachedJson<{ bounds: [[number, number], [number, number]] | null }>(
      "wt:bounds",
      "/api/walks/bounds"
    );
    const ntaP = fetch("/data/nta-boundaries.geojson").then((r) => r.json());
    const nbStatsC = cachedJson<{ neighborhoods: Array<{ nta_code: string; coverage_pct: number }> }>(
      "wt:neighborhoods",
      "/api/neighborhoods"
    );
    const userPosP = getUserPosition();

    const win = window as unknown as { mapboxgl?: typeof mapboxgl };

    const interval = setInterval(async () => {
      if (!win.mapboxgl || !mapRef.current) return;
      clearInterval(interval);

      try {
        // NEXT_PUBLIC_* is inlined at build time — no round-trip. Keep
        // /api/config as a fallback for older deployments.
        let mapboxToken = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();
        if (!mapboxToken) {
          const res = await fetch("/api/config");
          mapboxToken = (await res.json()).mapboxToken;
        }
        const mb = win.mapboxgl!;
        mb.accessToken = mapboxToken;

        // Resolve the initial view BEFORE creating the map so there is
        // never a zoom animation on open:
        //   1. user position (zoom 14)
        //   2. bounds of recent walks (last 14 days — the current city)
        //   3. NYC default
        const [userPos, boundsData] = await Promise.all([
          userPosP,
          boundsC.cached ? Promise.resolve(boundsC.cached) : boundsC.fresh.catch(() => ({ bounds: null })),
        ]);
        const mapOptions: mapboxgl.MapOptions = {
          container: mapRef.current!,
          style: "mapbox://styles/mapbox/dark-v11",
          center: [-73.935, 40.730],
          zoom: 13,
        };
        if (userPos) {
          mapOptions.center = [userPos.lng, userPos.lat];
          mapOptions.zoom = 14;
        } else if (boundsData.bounds) {
          mapOptions.bounds = boundsData.bounds as [[number, number], [number, number]];
          mapOptions.fitBoundsOptions = { padding: responsivePadding(), maxZoom: 14 };
          delete mapOptions.center;
          delete mapOptions.zoom;
        }

        const map = new mb.Map(mapOptions);
        mapInstance.current = map;

        // Silent location tracking via browser API — no mapbox control,
        // no permission prompt (already granted). Custom dot layer.
        map.on("load", () => {
          map.addSource("user-location", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "user-location-dot",
            type: "circle",
            source: "user-location",
            paint: {
              "circle-radius": 5,
              "circle-color": "#4285f4",
              "circle-stroke-width": 2,
              "circle-stroke-color": "#fff",
            },
          });
          // Live position dot — only when permission is already
          // granted, so this can never pop the iOS location dialog.
          geolocationGranted().then((granted) => {
            if (!granted) return;
            navigator.geolocation.watchPosition(
              (pos) => {
                const src = map.getSource("user-location") as mapboxgl.GeoJSONSource | undefined;
                if (src) {
                  src.setData({
                    type: "FeatureCollection",
                    features: [{
                      type: "Feature",
                      geometry: { type: "Point", coordinates: [pos.coords.longitude, pos.coords.latitude] },
                      properties: {},
                    }],
                  });
                }
              },
              () => {},
              { enableHighAccuracy: true, maximumAge: 10000 }
            );
          });
        });

        // Mapbox fires "error" for plenty of recoverable things (a
        // single tile 404, a slow terrain fetch). Only surface a
        // friendly overlay if the map never finished loading — after
        // load, log and move on so a stray tile error can't black out
        // a working map. Never render raw error text (it can contain
        // the tile URL and access token).
        let mapLoaded = false;
        map.on("error", (e: mapboxgl.ErrorEvent) => {
          console.error("Map error:", e);
          if (!mapLoaded) {
            setStatus("Map failed to load — check your connection and reload.");
          }
        });

        map.on("load", async () => {
          mapLoaded = true;
          setStatus("");

          // ── Walked paths ──
          try {
            const buildHeat = (geo: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection => {
              const heatPts: GeoJSON.Feature[] = [];
              for (const f of geo.features ?? []) {
                const coords: number[][] =
                  (f.geometry as GeoJSON.LineString | undefined)?.coordinates ?? [];
                for (const c of coords) {
                  heatPts.push({ type: "Feature", geometry: { type: "Point", coordinates: c }, properties: {} });
                }
              }
              return { type: "FeatureCollection", features: heatPts };
            };

            const walkGeo = walksC.cached ?? (await walksC.fresh);
            map.addSource("walked-paths", { type: "geojson", data: walkGeo });
            map.addSource("walk-heat", { type: "geojson", data: buildHeat(walkGeo) });

            // Swap in fresh data when it lands (no-op on first visit).
            if (walksC.cached) {
              walksC.fresh
                .then((freshGeo) => {
                  const src = map.getSource("walked-paths") as mapboxgl.GeoJSONSource | undefined;
                  const heat = map.getSource("walk-heat") as mapboxgl.GeoJSONSource | undefined;
                  if (src) src.setData(freshGeo);
                  if (heat) heat.setData(buildHeat(freshGeo));
                })
                .catch(() => {});
            }
            map.addLayer({
              id: "walk-heatmap", type: "heatmap", source: "walk-heat", maxzoom: 14,
              paint: {
                "heatmap-weight": 1,
                "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 14, 0],
                "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(0,0,0,0)", 0.1, "rgba(0,255,213,0.15)", 0.3, "rgba(0,255,213,0.3)", 0.5, "rgba(0,255,213,0.5)", 0.7, "rgba(0,255,213,0.65)", 1, "rgba(0,255,213,0.8)"],
                "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 2, 8, 5, 15, 8, 25, 12, 40],
                "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 14, 0],
              },
            });

            map.addLayer({
              id: "walked-paths-layer", type: "line", source: "walked-paths",
              paint: {
                "line-color": "#00ffd5",
                "line-width": 3,
                "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 13, 0.85],
              },
            });

            map.addLayer({
              id: "walked-paths-hit", type: "line", source: "walked-paths",
              paint: { "line-color": "#000", "line-opacity": 0, "line-width": 22 },
            });

            const refreshSource = async () => {
              // Cache-buster: after a delete we need truth, not the
              // CDN's 5-minute-stale copy.
              const r = await fetch(`/api/walks?t=${Date.now()}`);
              const geo = await r.json();
              const src = map.getSource("walked-paths") as mapboxgl.GeoJSONSource | undefined;
              if (src) src.setData(geo);
              try { localStorage.setItem("wt:walks", JSON.stringify(geo)); } catch {}
            };

            map.on("click", "walked-paths-hit", (e: mapboxgl.MapLayerMouseEvent) => {
              const feature = e.features?.[0];
              if (!feature) return;
              const p = (feature.properties ?? {}) as Record<string, unknown>;
              const dist = Number(p.distance_m) || 0;
              const dur = Number(p.duration_s) || 0;
              const startTs = String(p.start_time ?? "");
              const endTs = String(p.end_time ?? "");
              const miles = (dist / 1609.34).toFixed(2);
              const mins = Math.round(dur / 60);

              const popupNode = document.createElement("div");
              popupNode.innerHTML = `
                <div style="color:#fff;font-size:13px;min-width:160px">
                  <div style="color:#a1a1aa;font-size:11px;margin-bottom:8px">${miles} mi · ${mins} min</div>
                  <button data-action="delete" data-confirm="0" style="width:100%;padding:6px 8px;background:transparent;border:1px solid #3f3f46;color:#ef4444;border-radius:6px;cursor:pointer;font-size:12px">Remove this walk</button>
                </div>
              `;
              activePopup.current?.remove();
              const popup = new mb.Popup({ className: "dark-popup" }).setLngLat(e.lngLat).setDOMContent(popupNode).addTo(map);
              activePopup.current = popup;

              popupNode.addEventListener("click", async (ev) => {
                const btn = (ev.target as HTMLElement).closest("button[data-action]") as HTMLButtonElement | null;
                if (!btn || !startTs || !endTs) return;
                if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.style.background = "#ef444420"; btn.style.borderColor = "#ef4444"; btn.textContent = "Tap again to confirm"; return; }
                btn.disabled = true; btn.style.opacity = "0.5";
                try {
                  const r2 = await fetch("/api/walks/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start_ts: startTs, end_ts: endTs }) });
                  if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
                  popup.remove();
                  await refreshSource();
                } catch (err) { console.error("delete failed:", err); btn.textContent = "Failed"; }
              });
            });

            map.on("mouseenter", "walked-paths-hit", () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", "walked-paths-hit", () => { map.getCanvas().style.cursor = ""; });
          } catch (e) { console.error("walks error:", e); }

          // ── Neighborhoods ──
          try {
            const [ntaGeo, nbStats] = await Promise.all([
              ntaP,
              nbStatsC.cached ? Promise.resolve(nbStatsC.cached) : nbStatsC.fresh,
            ]);
            const { neighborhoods } = nbStats;
            const coverage: Record<string, number> = {};
            for (const n of neighborhoods) coverage[n.nta_code] = Number(n.coverage_pct) || 0;
            for (const f of ntaGeo.features) {
              const code = (f.properties.NTA2020 as string | undefined) ?? (f.properties.nta2020 as string | undefined);
              if (code) { f.properties.coverage_pct = coverage[code] ?? 0; featuresByCode.current[code] = f as GeoFeature; }
            }

            map.addSource("neighborhoods", { type: "geojson", data: ntaGeo });
            map.addLayer({ id: "neighborhoods-fill", type: "fill", source: "neighborhoods", paint: { "fill-color": ["interpolate", ["linear"], ["get", "coverage_pct"], 0, "rgba(0,0,0,0)", 1, "rgba(255,149,0,0.15)", 10, "rgba(255,204,0,0.2)", 30, "rgba(255,204,0,0.3)", 60, "rgba(52,199,89,0.35)", 90, "rgba(255,215,0,0.45)"], "fill-opacity": 1 } }, "walked-paths-layer");
            map.addLayer({ id: "neighborhoods-outline", type: "line", source: "neighborhoods", paint: { "line-color": "rgba(255,255,255,0.2)", "line-width": 1 } }, "walked-paths-layer");
            map.addLayer({ id: "neighborhoods-highlight", type: "fill", source: "neighborhoods", paint: { "fill-color": "rgba(255,255,255,0.12)", "fill-opacity": 1 }, filter: ["==", "NTA2020", ""] }, "walked-paths-layer");

            map.on("click", "neighborhoods-fill", (e: mapboxgl.MapLayerMouseEvent) => {
              const feature = e.features?.[0];
              if (!feature) return;
              const p = (feature.properties ?? {}) as Record<string, unknown>;
              const code = (p.NTA2020 as string) || (p.nta2020 as string);
              const name = (p.NTAName as string) || (p.ntaname as string) || code;
              onClickRef.current?.(code, name);
              activePopup.current?.remove();
              const popup = new mb.Popup({ className: "dark-popup" }).setLngLat(e.lngLat).setHTML(`<div style="color:#fff;font-size:14px"><strong>${name}</strong><br/>Coverage: ${(Number(p.coverage_pct) || 0).toFixed(1)}%</div>`).addTo(map);
              activePopup.current = popup;
            });
            map.on("mouseenter", "neighborhoods-fill", () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", "neighborhoods-fill", () => { map.getCanvas().style.cursor = ""; });
            setLayersReady(true);
          } catch (e) { console.error("neighborhoods error:", e); }
        });
      } catch (e) { console.error("Map init error:", e); setStatus("Failed to initialize map"); }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;
    map.setFilter("neighborhoods-highlight", ["==", "NTA2020", hoveredNeighborhood ?? ""]);
  }, [hoveredNeighborhood, layersReady]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady || !selectedNeighborhood) return;
    const feature = featuresByCode.current[selectedNeighborhood];
    if (!feature) return;
    const bbox = featureBBox(feature);
    if (!bbox) return;
    map.fitBounds(bbox, { padding: responsivePadding(), duration: 800, maxZoom: 15 });
  }, [selectedNeighborhood, layersReady]);

  const boroughCodesKey = (selectedBoroughCodes ?? []).join(",");
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;
    if (!selectedBoroughCodes || selectedBoroughCodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const code of selectedBoroughCodes) {
      const f = featuresByCode.current[code];
      if (!f) continue;
      const bb = featureBBox(f);
      if (!bb) continue;
      if (bb[0][0] < minX) minX = bb[0][0];
      if (bb[0][1] < minY) minY = bb[0][1];
      if (bb[1][0] > maxX) maxX = bb[1][0];
      if (bb[1][1] > maxY) maxY = bb[1][1];
    }
    if (!isFinite(minX)) return;
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: responsivePadding(), duration: 800, maxZoom: 13 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boroughCodesKey, layersReady]);

  // Render/clear suggested route as a dashed purple line.
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !layersReady) return;

    if (map.getLayer("suggested-route-layer")) map.removeLayer("suggested-route-layer");
    if (map.getSource("suggested-route")) map.removeSource("suggested-route");

    if (!suggestedRoute) return;

    map.addSource("suggested-route", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [suggestedRoute] },
    });
    map.addLayer({
      id: "suggested-route-layer",
      type: "line",
      source: "suggested-route",
      paint: {
        "line-color": "#a78bfa",
        "line-width": 4,
        "line-opacity": 0.8,
        "line-dasharray": [2, 1.5],
      },
    });
  }, [suggestedRoute, layersReady]);

  return (
    <>
      <div ref={mapRef} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} />
      {status && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#09090b", color: "#a1a1aa", fontSize: "18px" }}>
          {status}
        </div>
      )}
    </>
  );
}
