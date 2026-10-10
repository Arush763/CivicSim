import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Area } from '@mamdani/shared';
import { isZoneId } from '@mamdani/shared';
import { config } from '../config';
import { cachedZone, cachedZoneAreas, ensureZone } from './osm';

export interface TileBuilding {
  id: string; // BIN, or doitt_id when BIN is a placeholder
  ring: [number, number][];
  heightM: number;
}

export interface TileStreet {
  id: string; // physicalid
  name: string;
  line: [number, number][];
  widthM: number;
  travelLanes: number;
  parkingLanes: number;
  hasBikeLane: boolean;
}

export interface TilePark {
  id: string;
  name: string;
  ring: [number, number][];
}

export interface TileData {
  id: string;
  bbox: [number, number, number, number];
  buildings: TileBuilding[];
  streets: TileStreet[];
  parks: TilePark[];
}

/** Grid of ~tileSizeM squares over a bbox. Row 0 is the south edge. */
export function makeGrid(bbox: [number, number, number, number], tileSizeM: number) {
  const [w, s, e, n] = bbox;
  const latMid = (s + n) / 2;
  const dLat = tileSizeM / 111_195;
  const dLng = tileSizeM / (111_195 * Math.cos((latMid * Math.PI) / 180));
  const cols = Math.ceil((e - w) / dLng);
  const rows = Math.ceil((n - s) / dLat);
  const tileId = (r: number, c: number) => `r${String(r).padStart(2, '0')}c${String(c).padStart(2, '0')}`;
  const tileBbox = (r: number, c: number): [number, number, number, number] => [
    w + c * dLng,
    s + r * dLat,
    w + (c + 1) * dLng,
    s + (r + 1) * dLat,
  ];
  const tileFor = (p: [number, number]): string | null => {
    const c = Math.floor((p[0] - w) / dLng);
    const r = Math.floor((p[1] - s) / dLat);
    return r >= 0 && r < rows && c >= 0 && c < cols ? tileId(r, c) : null;
  };
  return { rows, cols, tileId, tileBbox, tileFor };
}

export const tilesDir = () => path.join(config.dataDir, 'tiles');
export const areasFile = () => path.join(config.dataDir, 'areas.json');

/** The New York pilot grid (r00c00 ids) imported before zones went worldwide. */
export function loadPilotAreas(): Area[] {
  if (!existsSync(areasFile())) return [];
  return JSON.parse(readFileSync(areasFile(), 'utf8'));
}

/** Every zone the server knows: the New York pilot grid plus every worldwide zone opened so far. */
export function loadAreas(): Area[] {
  return [...loadPilotAreas(), ...cachedZoneAreas()];
}

export function findArea(id: string): Area | null {
  if (isZoneId(id)) {
    const z = cachedZone(id);
    return z ? { id: z.id, name: z.name, bbox: z.bbox, issueTotal: 0 } : null;
  }
  return loadPilotAreas().find((a) => a.id === id) ?? null;
}

/** Load a zone, fetching it from OpenStreetMap first if it's a worldwide zone not seen before. */
export async function ensureTile(id: string): Promise<TileData | null> {
  if (isZoneId(id)) await ensureZone(id);
  return loadTile(id);
}

const tileCache = new Map<string, TileData>();
/** A zone that's already on disk (call ensureTile first for worldwide zones). */
export function loadTile(id: string): TileData | null {
  if (isZoneId(id)) return cachedZone(id);
  if (!/^r\d{2}c\d{2}$/.test(id)) return null;
  const hit = tileCache.get(id);
  if (hit) return hit;
  const f = path.join(tilesDir(), `${id}.json`);
  if (!existsSync(f)) return null;
  const t = JSON.parse(readFileSync(f, 'utf8')) as TileData;
  tileCache.set(id, t);
  return t;
}
