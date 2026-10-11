/**
 * Ground height around a zone, so things drawn into Street View follow hills instead of floating
 * on a flat plane. Heights come from the open AWS Terrain Tiles (Terrarium PNGs, no key; built
 * from SRTM, USGS 3DEP and others), not Google's Elevation API, whose terms forbid this use.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { project, zoneBbox } from '@mamdani/shared';
import { config } from '../config';
import { loadTile } from './tiles';

const ZOOM = 15; // ~3–5 m per pixel at mid latitudes
export const GRID = 65; // samples per side
export const HALF_M = 320; // the grid covers ±320 m around the zone centre (the zone and its neighbours)

export interface Terrain {
  /** [lng, lat] the grid is centred on (the zone's model origin). */
  origin: [number, number];
  halfM: number;
  size: number;
  /**
   * Heights in metres relative to the origin, row by row from south to north, west to east
   * within a row (so x = east, n = north match the 3D model's local frame).
   */
  heights: number[];
}

type Fetch = typeof fetch;

const tileUrl = (x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`;
const tileFile = (x: number, y: number) => path.join(config.cacheDir, 'terrain', String(ZOOM), `${x}_${y}.png`);

async function loadTilePng(x: number, y: number, fetchFn: Fetch): Promise<PNG> {
  const file = tileFile(x, y);
  if (!existsSync(file)) {
    const res = await fetchFn(tileUrl(x, y), { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`terrain tile ${x}/${y}: ${res.status}`);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return PNG.sync.read(readFileSync(file));
}

/** Terrarium encoding: (R × 256 + G + B / 256) − 32768 metres. */
export const decode = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Web Mercator pixel coordinates (fractional) of a point at ZOOM. */
function toPixel([lng, lat]: [number, number]): [number, number] {
  const n = 2 ** ZOOM * 256;
  const x = ((lng + 180) / 360) * n;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return [x, y];
}

const cache = new Map<string, Promise<Terrain>>();

/** The height grid around a zone (cached per zone for the life of the server). */
export function zoneTerrain(zoneId: string, fetchFn: Fetch = fetch): Promise<Terrain> {
  let job = cache.get(zoneId);
  if (!job) {
    job = buildTerrain(zoneId, fetchFn).catch((err) => {
      cache.delete(zoneId);
      throw err;
    });
    cache.set(zoneId, job);
  }
  return job;
}

async function buildTerrain(zoneId: string, fetchFn: Fetch): Promise<Terrain> {
  // Same origin as the zone's 3D model: the centre of its box.
  const bbox = zoneBbox(zoneId) ?? loadTile(zoneId)?.bbox;
  if (!bbox) throw new Error(`unknown zone ${zoneId}`);
  const origin: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

  // Local metres → lng/lat, the inverse of the model's projection.
  const [mx, my] = project(origin, [origin[0] + 1, origin[1] + 1]);
  const toLngLat = (x: number, n: number): [number, number] => [origin[0] + x / mx, origin[1] + n / my];

  const tiles = new Map<string, Promise<PNG>>();
  const sample = async (p: [number, number]) => {
    const [px, py] = toPixel(p);
    // Bilinear between the four nearest pixel centres (which may sit in neighbouring tiles).
    const x0 = Math.floor(px - 0.5);
    const y0 = Math.floor(py - 0.5);
    const fx = px - 0.5 - x0;
    const fy = py - 0.5 - y0;
    const at = async (x: number, y: number) => {
      const tx = Math.floor(x / 256);
      const ty = Math.floor(y / 256);
      const key = `${tx}_${ty}`;
      if (!tiles.has(key)) tiles.set(key, loadTilePng(tx, ty, fetchFn));
      const png = await tiles.get(key)!;
      const i = ((y - ty * 256) * 256 + (x - tx * 256)) * 4;
      return decode(png.data[i], png.data[i + 1], png.data[i + 2]);
    };
    const [a, b, c, d] = await Promise.all([at(x0, y0), at(x0 + 1, y0), at(x0, y0 + 1), at(x0 + 1, y0 + 1)]);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };

  const step = (HALF_M * 2) / (GRID - 1);
  const raw: number[] = [];
  for (let row = 0; row < GRID; row++) {
    const n = -HALF_M + row * step;
    const vals = await Promise.all(Array.from({ length: GRID }, (_, col) => sample(toLngLat(-HALF_M + col * step, n))));
    raw.push(...vals);
  }
  const base = await sample(origin);
  return { origin, halfM: HALF_M, size: GRID, heights: raw.map((h) => Math.round((h - base) * 100) / 100) };
}
