import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { project } from '@mamdani/shared';
import { config } from '../config';
import { loadPilotAreas as loadAreas, loadTile } from '../data/tiles';
import { MeshBuilder, signedArea, simplifyRing, type V2 } from './geometry';
import { toGlbNodes, type GlbNode } from './exportGlb';

/** Bump when the city map's look changes so clients fetch the new file. */
export const CITY_VERSION = 2;

export interface CityInfo {
  /** URL of the whole-area 3D map: land, coast, zone lines, and one building mesh per zone ("zone_<id>"). */
  url: string;
  /** [lng, lat] the scene's local meters are measured from (x = east, z = -north). */
  origin: [number, number];
  zones: { id: string; name: string; rect: [number, number, number, number] }[]; // local [x0, n0, x1, n1]
  labels: { name: string; at: [number, number] }[]; // local [x, n]
}

const cityOrigin = (): [number, number] => {
  const [w, s, e, n] = config.pilotBbox;
  return [(w + e) / 2, (s + n) / 2];
};
const fileName = () => `city-v${CITY_VERSION}.glb`;
const cityPath = () => path.join(config.cacheDir, 'tiles', 'city', fileName());

/** Describe the city map, building its 3D file first if needed. */
export async function cityInfo(): Promise<CityInfo> {
  const origin = cityOrigin();
  const toLocal = (p: [number, number]) => project(origin, p);
  if (!existsSync(cityPath())) await buildCity();
  const labelsFile = path.join(config.dataDir, 'labels.json');
  const labels: { name: string; at: [number, number] }[] = existsSync(labelsFile) ? JSON.parse(readFileSync(labelsFile, 'utf8')) : [];
  return {
    url: `/tiles/city/${fileName()}`,
    origin,
    zones: loadAreas().map((a) => {
      const [x0, n0] = toLocal([a.bbox[0], a.bbox[1]]);
      const [x1, n1] = toLocal([a.bbox[2], a.bbox[3]]);
      return { id: a.id, name: a.name, rect: [x0, n0, x1, n1].map((v) => Math.round(v * 10) / 10) as CityInfo['zones'][0]['rect'] };
    }),
    labels: labels.map((l) => ({ name: l.name, at: toLocal(l.at).map((v) => Math.round(v)) as [number, number] })),
  };
}

/**
 * Build the low-detail city map: real shorelines, simplified building blocks grouped by zone,
 * and thin zone outlines. Deliberately plain: no streets, cars, trees or textures.
 */
export async function buildCity(): Promise<void> {
  const origin = cityOrigin();
  const toLocal = (p: [number, number]): V2 => project(origin, p);
  const nodes: GlbNode[] = [];
  const single = (name: string, material: GlbNode['material']) => {
    const node = { name, material, mesh: new MeshBuilder(false) };
    nodes.push(node);
    return node.mesh;
  };

  // Land and coastline.
  const landFile = path.join(config.dataDir, 'land.json');
  const land = existsSync(landFile)
    ? (JSON.parse(readFileSync(landFile, 'utf8')) as { manhattan: [number, number][][]; brooklyn: [number, number][][] })
    : { manhattan: [], brooklyn: [] };
  const far = single('land_far', 'land_far');
  for (const ring of land.brooklyn) far.flat(simplifyRing(ring.map(toLocal), 4), 0);
  const near = single('land', 'land');
  const coast = single('coast', 'coast');
  for (const ring of land.manhattan) {
    const r = simplifyRing(ring.map(toLocal), 3);
    if (Math.abs(signedArea(r)) < 400) continue; // tiny pier fragments
    near.flat(r, 0);
    coast.ribbon([...r, r[0]], 3, 0.25);
  }

  // Zone outlines and one building mesh per zone.
  const lines = single('grid_lines', 'zone_line');
  for (const a of loadAreas()) {
    const [x0, n0] = toLocal([a.bbox[0], a.bbox[1]]);
    const [x1, n1] = toLocal([a.bbox[2], a.bbox[3]]);
    const corners: V2[] = [[x0, n0], [x1, n0], [x1, n1], [x0, n1], [x0, n0]];
    lines.ribbon(corners, 1.6, 0.3);

    const tile = loadTile(a.id);
    if (!tile) continue;
    const blocks = single(`zone_${a.id}`, 'city_building');
    for (const b of tile.buildings) {
      const ring = simplifyRing(b.ring.map(toLocal), 2.5);
      if (Math.abs(signedArea(ring)) < 30) continue; // sheds and kiosks add noise, not information
      blocks.prism(ring, 0, Math.max(4, b.heightM));
    }
  }

  const glb = await toGlbNodes(nodes, { kind: 'city', origin, version: CITY_VERSION });
  mkdirSync(path.dirname(cityPath()), { recursive: true });
  // A pre-compressed copy (~70% smaller) is served to clients that accept gzip.
  writeFileSync(`${cityPath()}.gz`, gzipSync(glb, { level: 9 }));
  writeFileSync(`${cityPath()}.tmp`, glb);
  renameSync(`${cityPath()}.tmp`, cityPath());
}
