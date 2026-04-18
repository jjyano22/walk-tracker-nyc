/**
 * Subdivide aggregated NTA neighborhoods into their traditional
 * component neighborhoods using Voronoi tessellation from known
 * centroids, clipped to the parent NTA polygon.
 *
 * Reads  public/data/nta-boundaries.geojson
 * Writes public/data/nta-boundaries.geojson (backs up original to .orig)
 *
 * After running: trigger /api/migrate-neighborhoods to remap the
 * street_segments and neighborhood_stats tables in Neon to use the
 * new subdivided codes.
 *
 * Usage:
 *   npx tsx scripts/subdivide-neighborhoods.ts
 */

import * as fs from "fs";
import * as path from "path";
import { voronoi } from "@turf/voronoi";
import { intersect } from "@turf/intersect";
import { bbox } from "@turf/bbox";
import { featureCollection, point, polygon } from "@turf/helpers";
import type { Feature, FeatureCollection, Polygon } from "geojson";

interface SubSpec {
  code: string;
  name: string;
  centroid: [number, number]; // [lng, lat]
}

interface ParentSpec {
  parentCode: string;
  subs: SubSpec[];
}

// Brooklyn-focused subdivisions of traditionally-distinct neighborhoods
// that NYC's NTA 2020 groups together. Centroids are approximate —
// nearest-centroid tessellation means they only need to be roughly
// correct; the actual boundaries follow the parent polygon.
const SPECS: ParentSpec[] = [
  {
    parentCode: "BK0601", // "Carroll Gardens-Cobble Hill-Gowanus-Red Hook"
    subs: [
      { code: "BK0601A", name: "Red Hook",        centroid: [-74.0090, 40.6765] },
      { code: "BK0601B", name: "Carroll Gardens", centroid: [-73.9992, 40.6805] },
      { code: "BK0601C", name: "Cobble Hill",     centroid: [-73.9960, 40.6870] },
      { code: "BK0601D", name: "Gowanus",         centroid: [-73.9900, 40.6750] },
    ],
  },
  {
    parentCode: "BK0202", // "Downtown Brooklyn-DUMBO-Boerum Hill"
    subs: [
      { code: "BK0202A", name: "DUMBO",            centroid: [-73.9895, 40.7028] },
      { code: "BK0202B", name: "Downtown Brooklyn", centroid: [-73.9830, 40.6935] },
      { code: "BK0202C", name: "Boerum Hill",      centroid: [-73.9845, 40.6850] },
    ],
  },
  {
    parentCode: "BK0701", // "Windsor Terrace-South Slope"
    subs: [
      { code: "BK0701A", name: "South Slope",      centroid: [-73.9870, 40.6665] },
      { code: "BK0701B", name: "Windsor Terrace",  centroid: [-73.9793, 40.6590] },
    ],
  },
  {
    parentCode: "BK0902", // "Prospect Lefferts Gardens-Wingate"
    subs: [
      { code: "BK0902A", name: "Prospect Lefferts Gardens", centroid: [-73.9580, 40.6605] },
      { code: "BK0902B", name: "Wingate",                  centroid: [-73.9480, 40.6610] },
    ],
  },
  {
    parentCode: "BK1302", // "Coney Island-Sea Gate"
    subs: [
      { code: "BK1302A", name: "Sea Gate",     centroid: [-74.0030, 40.5760] },
      { code: "BK1302B", name: "Coney Island", centroid: [-73.9800, 40.5760] },
    ],
  },
  {
    parentCode: "BK1802", // "Marine Park-Mill Basin-Bergen Beach"
    subs: [
      { code: "BK1802A", name: "Marine Park",  centroid: [-73.9305, 40.6075] },
      { code: "BK1802B", name: "Mill Basin",   centroid: [-73.9080, 40.6080] },
      { code: "BK1802C", name: "Bergen Beach", centroid: [-73.9040, 40.6180] },
    ],
  },
  {
    parentCode: "BK1503", // "Sheepshead Bay-Manhattan Beach-Gerritsen Beach"
    subs: [
      { code: "BK1503A", name: "Sheepshead Bay",    centroid: [-73.9450, 40.5890] },
      { code: "BK1503B", name: "Manhattan Beach",   centroid: [-73.9410, 40.5775] },
      { code: "BK1503C", name: "Gerritsen Beach",   centroid: [-73.9230, 40.5855] },
    ],
  },
];

function main() {
  const geojsonPath = path.join(
    process.cwd(),
    "public/data/nta-boundaries.geojson"
  );
  const backupPath = geojsonPath + ".orig";

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(geojsonPath, backupPath);
    console.log(`Backed up original to ${backupPath}`);
  }

  // Always start from the backed-up original so the script is idempotent.
  const data: FeatureCollection = JSON.parse(
    fs.readFileSync(backupPath, "utf-8")
  );
  console.log(`Loaded ${data.features.length} NTA features from backup`);

  let splitCount = 0;
  const newFeatures: Feature[] = [];

  for (const feature of data.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const code = (props.NTA2020 as string) || (props.nta2020 as string) || "";
    const spec = SPECS.find((s) => s.parentCode === code);

    if (!spec) {
      newFeatures.push(feature);
      continue;
    }

    // Turf voronoi/intersect need Polygon features. If the parent is
    // a MultiPolygon, intersect each voronoi cell against each ring
    // and union the results. For this dataset all affected parents
    // happen to be single Polygons, so handling only that case.
    if (feature.geometry.type !== "Polygon") {
      console.warn(
        `Parent ${code} is ${feature.geometry.type}, not Polygon — keeping as-is`
      );
      newFeatures.push(feature);
      continue;
    }
    const parentPoly = polygon(
      (feature.geometry as Polygon).coordinates,
      feature.properties
    );

    const parentBbox = bbox(parentPoly);
    const centroidFC = featureCollection(
      spec.subs.map((s) => point(s.centroid))
    );

    const voronoiFC = voronoi(centroidFC, { bbox: parentBbox });
    if (!voronoiFC || !voronoiFC.features) {
      console.warn(`voronoi failed for ${code}, keeping as-is`);
      newFeatures.push(feature);
      continue;
    }

    let emitted = 0;
    for (let i = 0; i < spec.subs.length; i++) {
      const sub = spec.subs[i];
      const cell = voronoiFC.features[i];
      if (!cell) {
        console.warn(`  no voronoi cell for ${sub.name}`);
        continue;
      }
      const clipped = intersect(featureCollection([cell, parentPoly]));
      if (!clipped) {
        console.warn(`  empty intersection for ${sub.name}`);
        continue;
      }
      newFeatures.push({
        type: "Feature",
        geometry: clipped.geometry,
        properties: {
          ...props,
          NTA2020: sub.code,
          nta2020: sub.code,
          NTAName: sub.name,
          ntaname: sub.name,
        },
      });
      emitted += 1;
    }

    console.log(`Split ${code} (${String(props.NTAName)}) → ${emitted} subs`);
    splitCount += 1;
  }

  const out: FeatureCollection = {
    type: "FeatureCollection",
    features: newFeatures,
  };
  fs.writeFileSync(geojsonPath, JSON.stringify(out));
  console.log(
    `\nWrote ${newFeatures.length} features (split ${splitCount} parents).`
  );
}

main();
