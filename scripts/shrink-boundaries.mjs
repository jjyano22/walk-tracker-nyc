// Shrink public/data/nta-boundaries.geojson for client delivery:
//  - keep only the properties the app reads (NTA2020, NTAName, BoroName)
//  - round coordinates to 5 decimals (~1.1m)
//  - drop consecutive duplicate points created by rounding
// Run AFTER scripts/subdivide-neighborhoods.ts (which regenerates the
// file from the .orig backup). Usage: node scripts/shrink-boundaries.mjs
import * as fs from "fs";

const PATH = "public/data/nta-boundaries.geojson";
const data = JSON.parse(fs.readFileSync(PATH, "utf-8"));

const r5 = (n) => Math.round(n * 1e5) / 1e5;

function shrinkRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [r5(x), r5(y)];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function shrinkCoords(type, coords) {
  if (type === "Polygon") return coords.map(shrinkRing);
  if (type === "MultiPolygon") return coords.map((poly) => poly.map(shrinkRing));
  return coords;
}

let inProps = 0, outProps = 0;
for (const f of data.features) {
  const p = f.properties ?? {};
  inProps += Object.keys(p).length;
  f.properties = {
    NTA2020: p.NTA2020 ?? p.nta2020 ?? "",
    NTAName: p.NTAName ?? p.ntaname ?? "",
    BoroName: p.BoroName ?? p.boroname ?? "",
  };
  outProps += 3;
  f.geometry.coordinates = shrinkCoords(f.geometry.type, f.geometry.coordinates);
}

fs.writeFileSync(PATH, JSON.stringify(data));
const size = fs.statSync(PATH).size;
console.log(`features: ${data.features.length}, props ${inProps} -> ${outProps}, size: ${(size / 1024 / 1024).toFixed(2)} MB`);
