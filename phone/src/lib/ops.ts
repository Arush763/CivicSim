import { describeOp, type AreaDetail, type ChangeOp } from '@mamdani/shared';

export type OpType = ChangeOp['type'];
export type PickKind = 'street' | 'building' | 'point' | 'polygon' | 'line_or_polygon';

/** The change types in the order of the design's "Add a change" grid. */
export const TYPES: { type: OpType; label: string; hint: string; pick: PickKind; icon: string }[] = [
  { type: 'add_bike_lane', label: 'Bike lane', hint: 'Tap a street for the bike lane', pick: 'street', icon: 'bike' },
  { type: 'add_bus_lane', label: 'Bus lane', hint: 'Tap a street for the bus lane', pick: 'street', icon: 'bus' },
  { type: 'widen_sidewalk', label: 'Sidewalk', hint: 'Tap a street to widen its sidewalk', pick: 'street', icon: 'walk' },
  { type: 'remove_parking', label: 'No parking', hint: 'Tap a street to remove parking', pick: 'street', icon: 'noParking' },
  { type: 'replace_building', label: 'Rebuild lot', hint: 'Tap a building to rebuild it', pick: 'building', icon: 'building' },
  { type: 'add_park', label: 'Park', hint: 'Tap the corners of the park', pick: 'polygon', icon: 'park' },
  { type: 'plant_trees', label: 'Trees', hint: 'Tap along a street, or around an area', pick: 'line_or_polygon', icon: 'tree' },
  { type: 'add_crosswalk', label: 'Crosswalk', hint: 'Tap a spot for the crosswalk', pick: 'point', icon: 'crosswalk' },
];
export const TYPE = Object.fromEntries(TYPES.map((t) => [t.type, t])) as Record<OpType, (typeof TYPES)[number]>;

/** A new change with sensible defaults, once its place on the map is picked. */
export function newOp(type: OpType, place: { streetId?: string; buildingId?: string; points?: [number, number][]; treeShape?: 'line' | 'area' }): ChangeOp | null {
  const pts = place.points ?? [];
  switch (type) {
    case 'add_bike_lane': return place.streetId ? { type, streetSegmentId: place.streetId, side: 'both', protected: true } : null;
    case 'add_bus_lane': return place.streetId ? { type, streetSegmentId: place.streetId, side: 'both' } : null;
    case 'remove_parking': return place.streetId ? { type, streetSegmentId: place.streetId, side: 'both' } : null;
    case 'widen_sidewalk': return place.streetId ? { type, streetSegmentId: place.streetId, meters: 1.5 } : null;
    case 'replace_building': return place.buildingId ? { type, buildingId: place.buildingId, floors: 8, use: 'affordable_housing', units: 0 } : null;
    case 'add_park': return pts.length >= 3 ? { type, polygon: pts } : null;
    case 'plant_trees':
      if (place.treeShape === 'area') return pts.length >= 3 ? { type, polygon: pts, count: 10 } : null;
      return pts.length >= 2 ? { type, line: pts, count: 10 } : null;
    case 'add_crosswalk': return pts.length ? { type, at: pts[0], raised: false } : null;
  }
}

/** The second line of a change in the list: where it is and how big. */
export function opWhere(op: ChangeOp, area: AreaDetail): string {
  if ('streetSegmentId' in op) {
    const s = area.scene.streets.find((x) => x.id === op.streetSegmentId);
    return s ? `${s.name || 'Street'} · ${Math.round(s.lengthM)} m` : 'Street';
  }
  if (op.type === 'replace_building') {
    const b = area.scene.buildings.find((x) => x.id === op.buildingId);
    return b ? `Building · ${Math.round(b.heightM)} m tall · ${Math.round(b.footprintM2).toLocaleString()} m²` : 'Building';
  }
  if (op.type === 'add_park') return `${op.polygon.length} corners`;
  if (op.type === 'plant_trees') return op.line ? `Along a line · ${op.count} trees` : `In an area · ${op.count} trees`;
  return op.raised ? 'Raised' : 'At street level';
}

/** "Protected bike lane on Bleecker St (both sides) + 1 more" */
export const autoTitle = (ops: ChangeOp[], area: AreaDetail | null) =>
  ops.length ? (describeOp(ops[0], area?.scene) + (ops.length > 1 ? ` + ${ops.length - 1} more` : '')).slice(0, 120) : 'New request';

/** The icon for a request in lists (its first change). */
export const kindIcon = (ops: ChangeOp[]) => (ops[0] ? TYPE[ops[0].type].icon : 'map');
