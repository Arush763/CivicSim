/**
 * One-off import of the pilot area's buildings, streets and parks from NYC Open Data,
 * split into ~400 m tiles. Writes data/tiles/{id}.json and data/areas.json.
 *
 *   npm run import:nyc --workspace server
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { centroid, lineLengthM, polygonAreaM2, type Area } from '@mamdani/shared';
import { config } from '../config';
import { clipRingToBbox } from './clip';
import { DATASETS, soql, withinBox } from './socrata';
import { areasFile, makeGrid, tilesDir, type TileData } from './tiles';
import { importIssues } from './importIssues';

const FT = 0.3048;

type Multi<T> = { type: string; coordinates: T };

interface RawBuilding {
  the_geom: Multi<[number, number][][][]>;
  doitt_id: string;
  height_roof?: string;
}
interface RawStreet {
  the_geom: Multi<[number, number][][]>;
  physicalid: string;
  stname_label?: string;
  full_street_name?: string;
  streetwidth?: string;
  number_travel_lanes?: string;
  number_park_lanes?: string;
  bike_lane?: string;
}
interface RawPark {
  multipolygon: Multi<[number, number][][][]>;
  gispropnum: string;
  signname?: string;
}

/** Drop the closing vertex GeoJSON repeats, so rings are open like the rest of the app expects. */
const openRing = (r: [number, number][]) =>
  r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r;

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

async function main() {
  const bbox = config.pilotBbox;
  const grid = makeGrid(bbox, config.tileSizeM);
  console.log(`grid ${grid.rows}x${grid.cols} over`, bbox);

  const tiles = new Map<string, TileData>();
  const tile = (id: string) => {
    let t = tiles.get(id);
    if (!t) {
      const [, r, c] = id.match(/^r(\d+)c(\d+)$/)!.map(Number);
      t = { id, bbox: grid.tileBbox(r, c), buildings: [], streets: [], parks: [] };
      tiles.set(id, t);
    }
    return t;
  };

  console.log('fetching buildings…');
  const buildings = await soql<RawBuilding>(DATASETS.buildings, {
    $select: 'the_geom, doitt_id, height_roof',
    $where: `${withinBox('the_geom', bbox)} AND starts_with(base_bbl, '1')`, // Manhattan
  });
  for (const b of buildings) {
    // Largest polygon's outer ring; holes are ignored at this level of detail.
    const rings = b.the_geom.coordinates.map((poly) => openRing(poly[0]));
    const ring = rings.reduce((a, r) => (r.length > a.length ? r : a), rings[0]);
    if (!ring || ring.length < 3) continue;
    const id = grid.tileFor(centroid(ring));
    if (!id) continue;
    const h = Number(b.height_roof);
    tile(id).buildings.push({ id: `b${b.doitt_id}`, ring, heightM: h > 0 ? h * FT : 10 });
  }
  console.log(`  ${buildings.length} buildings`);

  console.log('fetching streets…');
  const streets = await soql<RawStreet>(DATASETS.centerline, {
    $select: 'the_geom, physicalid, stname_label, full_street_name, streetwidth, number_travel_lanes, number_park_lanes, bike_lane',
    $where: `${withinBox('the_geom', bbox)} AND rw_type='1' AND boroughcode='1'`,
  });
  const seen = new Set<string>();
  for (const s of streets) {
    const line = s.the_geom.coordinates.flat();
    if (line.length < 2) continue;
    const id = grid.tileFor(line[Math.floor(line.length / 2)]);
    if (!id) continue;
    let sid = `s${s.physicalid}`;
    for (let k = 2; seen.has(sid); k++) sid = `s${s.physicalid}_${k}`;
    seen.add(sid);
    tile(id).streets.push({
      id: sid,
      name: titleCase(s.stname_label ?? s.full_street_name ?? 'Unnamed street'),
      line,
      widthM: Math.max(6, (Number(s.streetwidth) || 30) * FT),
      travelLanes: Number(s.number_travel_lanes) || 1,
      parkingLanes: Number(s.number_park_lanes) || 0,
      hasBikeLane: !!s.bike_lane,
    });
  }
  console.log(`  ${streets.length} street segments`);

  console.log('fetching parks…');
  const parks = await soql<RawPark>(DATASETS.parks, {
    $select: 'multipolygon, gispropnum, signname',
    $where: `${withinBox('multipolygon', bbox)} AND borough='M'`,
  });
  for (const p of parks) {
    for (const poly of p.multipolygon.coordinates) {
      const ring = openRing(poly[0]);
      // A park can span several tiles: clip it into each tile it touches.
      const ids = new Set(ring.map((pt) => grid.tileFor(pt)).filter((x): x is string => !!x));
      ids.add(grid.tileFor(centroid(ring)) ?? '');
      for (const id of ids) {
        if (!id) continue;
        const clipped = clipRingToBbox(ring, tile(id).bbox);
        if (clipped.length >= 3) {
          tile(id).parks.push({ id: `p${p.gispropnum}`, name: p.signname ?? 'Park', ring: clipped });
        }
      }
    }
  }
  console.log(`  ${parks.length} parks`);

  mkdirSync(tilesDir(), { recursive: true });
  const areas: Area[] = [];
  for (const t of [...tiles.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    // Skip mostly-water tiles.
    if (t.buildings.length < 3 && t.streets.length < 3) continue;
    writeFileSync(path.join(tilesDir(), `${t.id}.json`), JSON.stringify(t));
    areas.push({ id: t.id, name: nameTile(t), bbox: t.bbox, issueTotal: 0 });
  }
  writeFileSync(areasFile(), JSON.stringify(areas, null, 2));
  console.log(`wrote ${areas.length} tiles to ${tilesDir()}`);

  await importLandAndLabels(bbox);

  await importIssues();
}

/**
 * The city map's base: real shorelines for Manhattan and the facing Brooklyn waterfront, and
 * neighbourhood names to label the map. Written to data/land.json and data/labels.json.
 */
async function importLandAndLabels(bbox: [number, number, number, number]) {
  const pad = 0.012; // show a little of the surroundings past the pilot area
  const view: [number, number, number, number] = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad];

  console.log('fetching shorelines…');
  const boroughs = await soql<{ boroname: string; the_geom: Multi<[number, number][][][]> }>(DATASETS.boroughs, {
    $select: 'boroname, the_geom',
    $where: "boroname in ('Manhattan', 'Brooklyn')",
  });
  const land: Record<string, [number, number][][]> = { manhattan: [], brooklyn: [] };
  for (const b of boroughs) {
    for (const poly of b.the_geom.coordinates) {
      const clipped = clipRingToBbox(openRing(poly[0]), view);
      if (clipped.length >= 3) land[b.boroname.toLowerCase()].push(clipped);
    }
  }
  writeFileSync(path.join(config.dataDir, 'land.json'), JSON.stringify({ view, ...land }));
  console.log(`  manhattan ${land.manhattan.length} ring(s), brooklyn ${land.brooklyn.length} ring(s)`);

  console.log('fetching neighbourhood names…');
  const ntas = await soql<{ ntaname: string; the_geom: Multi<[number, number][][][]> }>(DATASETS.neighborhoods, {
    $select: 'ntaname, the_geom',
    // intersects (not within_box) so neighbourhoods crossing the pilot edge, like the East Village, count too.
    $where: `boroname = 'Manhattan' AND intersects(the_geom, '${bboxWkt(bbox)}')`,
  });
  const labels = ntas
    .map((n) => {
      // Label at the middle of the part of the neighbourhood inside the pilot area.
      const ring = n.the_geom.coordinates.map((p) => openRing(p[0])).sort((a, b) => b.length - a.length)[0];
      const inside = clipRingToBbox(ring, bbox);
      // Skip neighbourhoods that only graze the pilot area's edge.
      if (inside.length < 3 || polygonAreaM2(inside) < 300_000) return null;
      // "SoHo-Little Italy-Hudson Square" → "SoHo"; "Financial District-Battery Park City" → "Financial District"
      return { name: n.ntaname.split('-')[0].trim(), at: centroid(inside) };
    })
    .filter((x): x is { name: string; at: [number, number] } => !!x && !/park|cemetery|airport/i.test(x.name));
  writeFileSync(path.join(config.dataDir, 'labels.json'), JSON.stringify(labels, null, 2));
  console.log(`  ${labels.length} neighbourhoods: ${labels.map((l) => l.name).join(', ')}`);
}

function bboxWkt([w, s, e, n]: [number, number, number, number]): string {
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

/** "Canal St & Broadway" — the two streets with the most length in the tile. */
function nameTile(t: TileData): string {
  const byName = new Map<string, number>();
  for (const s of t.streets) byName.set(s.name, (byName.get(s.name) ?? 0) + lineLengthM(s.line));
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
  return top.length ? top.join(' & ') : t.parks[0]?.name ?? t.id;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
