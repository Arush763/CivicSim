import { bboxContains, type ChangeOp } from '@mamdani/shared';
import type { TileData } from '../data/tiles';

/** Check that every op refers to things that exist in, and geometry that lies within, this tile. */
export function validateOpsForTile(ops: ChangeOp[], tile: TileData): string[] {
  const streets = new Set(tile.streets.map((s) => s.id));
  const buildings = new Set(tile.buildings.map((b) => b.id));
  // Allow geometry to spill a little past the tile edge (≈50 m).
  const [w, s, e, n] = tile.bbox;
  const pad = 0.0005;
  const box: [number, number, number, number] = [w - pad, s - pad, e + pad, n + pad];
  const inside = (pts: [number, number][]) => pts.every((p) => bboxContains(box, p));
  const errors: string[] = [];

  ops.forEach((op, i) => {
    const where = `ops[${i}] (${op.type})`;
    if ('streetSegmentId' in op && !streets.has(op.streetSegmentId)) errors.push(`${where}: unknown street ${op.streetSegmentId}`);
    if (op.type === 'replace_building' && !buildings.has(op.buildingId)) errors.push(`${where}: unknown building ${op.buildingId}`);
    if (op.type === 'add_park' && !inside(op.polygon)) errors.push(`${where}: park polygon leaves the area`);
    if (op.type === 'plant_trees' && !inside(op.line ?? op.polygon ?? [])) errors.push(`${where}: trees placed outside the area`);
    if (op.type === 'add_crosswalk' && !inside([op.at])) errors.push(`${where}: crosswalk outside the area`);
  });

  const replacedTwice = ops
    .filter((o): o is Extract<ChangeOp, { type: 'replace_building' }> => o.type === 'replace_building')
    .map((o) => o.buildingId)
    .filter((id, i, all) => all.indexOf(id) !== i);
  for (const id of new Set(replacedTwice)) errors.push(`building ${id} is replaced more than once`);
  return errors;
}
