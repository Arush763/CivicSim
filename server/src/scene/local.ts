import { project, type SceneIndex } from '@mamdani/shared';
import type { TileData } from '../data/tiles';
import { ringCentroid, signedArea, type V2 } from './geometry';

/** A tile projected into local meters around its center. */
export interface LocalTile {
  id: string;
  origin: [number, number];
  half: V2; // half-extent of the tile in meters (x, n)
  buildings: { id: string; ring: V2[]; heightM: number; centroid: V2; areaM2: number }[];
  streets: {
    id: string;
    name: string;
    line: V2[];
    lengthM: number;
    widthM: number;
    travelLanes: number;
    parkingLanes: number;
    hasBikeLane: boolean;
  }[];
  parks: { id: string; name: string; ring: V2[] }[];
  toLocal: (p: [number, number]) => V2;
}

const cache = new Map<string, LocalTile>();

export function localTile(tile: TileData): LocalTile {
  const hit = cache.get(tile.id);
  if (hit) return hit;
  const [w, s, e, n] = tile.bbox;
  const origin: [number, number] = [(w + e) / 2, (s + n) / 2];
  const toLocal = (p: [number, number]) => project(origin, p);
  const ne = toLocal([e, n]);
  const lengthOf = (line: V2[]) => line.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);

  const lt: LocalTile = {
    id: tile.id,
    origin,
    half: [ne[0], ne[1]],
    buildings: tile.buildings.map((b) => {
      const ring = b.ring.map(toLocal);
      return { id: b.id, ring, heightM: b.heightM, centroid: ringCentroid(ring), areaM2: Math.abs(signedArea(ring)) };
    }),
    streets: tile.streets.map((st) => {
      const line = st.line.map(toLocal);
      return { ...st, line, lengthM: lengthOf(line) };
    }),
    parks: tile.parks.map((p) => ({ ...p, ring: p.ring.map(toLocal) })),
    toLocal,
  };
  cache.set(tile.id, lt);
  return lt;
}

/** The pickable index the app uses to reference streets/buildings in ops. */
export function sceneIndex(tile: TileData): SceneIndex {
  const lt = localTile(tile);
  const r = (x: number) => Math.round(x * 10) / 10;
  const round6 = (p: [number, number]): [number, number] => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
  return {
    origin: lt.origin,
    streets: lt.streets.map((s, i) => ({
      id: s.id,
      name: s.name,
      lengthM: r(s.lengthM),
      widthM: r(s.widthM),
      line: tile.streets[i].line.map(round6),
    })),
    buildings: lt.buildings.map((b, i) => ({
      id: b.id,
      heightM: r(b.heightM),
      footprintM2: Math.round(b.areaM2),
      centroid: round6(centroidLngLat(tile.buildings[i].ring)),
      ring: tile.buildings[i].ring.map(round6),
    })),
  };
}

function centroidLngLat(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}
