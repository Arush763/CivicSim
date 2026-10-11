import { CHANGE_OP_LABELS, type ChangeOp } from '@mamdani/shared';

// Describing a change and where to look at it are shared with the server (it prepares photo-real views).
export { changeFocus, describeOp, type ChangeFocus } from '@mamdani/shared';

/** What a change type needs the person to pick on the map. */
export type PickKind = 'street' | 'building' | 'point' | 'polygon' | 'line_or_polygon';

export const OP_PICK: Record<ChangeOp['type'], PickKind> = {
  add_bike_lane: 'street',
  add_bus_lane: 'street',
  widen_sidewalk: 'street',
  remove_parking: 'street',
  replace_building: 'building',
  add_park: 'polygon',
  plant_trees: 'line_or_polygon',
  add_crosswalk: 'point',
};

export const OP_TYPES = Object.keys(CHANGE_OP_LABELS) as ChangeOp['type'][];
export { CHANGE_OP_LABELS };
