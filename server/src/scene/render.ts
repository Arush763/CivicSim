import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isZoneId, zoneBlock, type ChangeOp } from '@mamdani/shared';
import { config } from '../config';
import { cachedZone } from '../data/osm';
import { ensureTile, loadTile, type TileData } from '../data/tiles';
import { addNeighbourContext, buildScene, emptyProps, type Lod } from './build';
import { toGlb } from './exportGlb';
import { localTile } from './local';

/** Bump when scene generation changes so stale cached renders are not reused. */
export const SCENE_VERSION = 6;
/** Renders show only what a request changes, over a quiet base (see buildScene). */
const STYLE = 'changes' as const;
const LODS: Lod[] = [0, 1, 2];

export function renderHash(areaId: string, ops: ChangeOp[]): string {
  // Worldwide zones carry when their map data was fetched, so a re-fetched zone never reuses an old render.
  const data = isZoneId(areaId) ? (cachedZone(areaId)?.fetchedAt ?? '') : '';
  return createHash('sha1').update(`${SCENE_VERSION}|${STYLE}|${areaId}|${data}|${JSON.stringify(ops)}`).digest('hex').slice(0, 16);
}

export const lodUrl = (areaId: string, hash: string, lod: Lod) => `/tiles/${areaId}/${hash}/lod${lod}.glb`;
const lodPath = (areaId: string, hash: string, lod: Lod) => path.join(config.cacheDir, 'tiles', areaId, hash, `lod${lod}.glb`);

export function isRendered(areaId: string, hash: string): boolean {
  return LODS.every((l) => existsSync(lodPath(areaId, hash, l)));
}

export function renderedUrls(areaId: string, hash: string): string[] {
  return LODS.map((l) => lodUrl(areaId, hash, l));
}

/**
 * Build and write all LODs for (area, ops). Lowest detail first, so a viewer can show
 * something as soon as possible; `onLod` fires after each level is on disk.
 */
export async function renderTile(
  areaId: string,
  ops: ChangeOp[],
  onLod?: (lod: Lod) => void,
): Promise<{ hash: string; lods: string[] }> {
  const hash = renderHash(areaId, ops);
  if (isRendered(areaId, hash)) return { hash, lods: renderedUrls(areaId, hash) };

  const tile = await ensureTile(areaId);
  if (!tile) throw new Error(`unknown area ${areaId}`);
  const lt = localTile(tile);
  const neighbours = neighbourBuildings(tile, lt.toLocal);
  for (const lod of [...LODS].reverse()) {
    const out = lodPath(areaId, hash, lod);
    if (!existsSync(out)) {
      const props = emptyProps();
      const parts = buildScene(lt, ops, lod, STYLE, props);
      addNeighbourContext(parts, lt, neighbours, lod);
      // The highest detail also says where posts, trees and lane symbols stand (see SceneProps).
      const glb = await toGlb(parts, { areaId, hash, lod, origin: lt.origin, style: STYLE, ...(lod === 0 ? { props } : {}) });
      mkdirSync(path.dirname(out), { recursive: true });
      // Write-then-rename so a reader never sees a half-written file.
      writeFileSync(`${out}.tmp`, glb);
      renameSync(`${out}.tmp`, out);
    }
    onLod?.(lod);
  }
  return { hash, lods: renderedUrls(areaId, hash) };
}

/** Buildings of the up-to-8 zones around a tile, in that tile's local coordinates. */
function neighbourBuildings(tile: TileData, toLocal: (p: [number, number]) => [number, number]) {
  if (isZoneId(tile.id)) {
    // Fetched together with the zone itself, so they're already on disk.
    return zoneBlock(tile.id)
      .filter((id) => id !== tile.id)
      .flatMap((id) => (loadTile(id)?.buildings ?? []).map((b) => ({ ring: b.ring.map(toLocal), heightM: b.heightM })));
  }
  const m = /^r(\d+)c(\d+)$/.exec(tile.id);
  if (!m) return [];
  const [r, c] = [Number(m[1]), Number(m[2])];
  const out: { ring: [number, number][]; heightM: number }[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const id = `r${String(r + dr).padStart(2, '0')}c${String(c + dc).padStart(2, '0')}`;
      for (const b of loadTile(id)?.buildings ?? []) out.push({ ring: b.ring.map(toLocal), heightM: b.heightM });
    }
  }
  return out;
}
