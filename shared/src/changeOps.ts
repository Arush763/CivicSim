import { z } from 'zod';

/** [longitude, latitude] in WGS84. */
export const LngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type LngLat = z.infer<typeof LngLat>;

/** Closed ring is not required; the first point is implicitly repeated. */
export const Polygon = z.array(LngLat).min(3).max(200);
export const Line = z.array(LngLat).min(2).max(200);

const StreetRef = z.string().min(1).describe('id of a street segment in the area scene');
const BuildingRef = z.string().min(1).describe('id of a building in the area scene');

export const AddBikeLane = z.object({
  type: z.literal('add_bike_lane'),
  streetSegmentId: StreetRef,
  side: z.enum(['left', 'right', 'both']),
  protected: z.boolean(),
});

export const AddBusLane = z.object({
  type: z.literal('add_bus_lane'),
  streetSegmentId: StreetRef,
  side: z.enum(['left', 'right', 'both']),
});

export const AddPark = z.object({
  type: z.literal('add_park'),
  polygon: Polygon,
  name: z.string().max(80).optional(),
});

export const PlantTrees = z.object({
  type: z.literal('plant_trees'),
  line: Line.optional(),
  polygon: Polygon.optional(),
  count: z.number().int().min(1).max(500),
}).refine((o) => !!o.line !== !!o.polygon, { message: 'plant_trees needs exactly one of line or polygon' });

export const BuildingUse = z.enum(['affordable_housing', 'mixed_use', 'community_center', 'school', 'clinic']);
export type BuildingUse = z.infer<typeof BuildingUse>;

export const ReplaceBuilding = z.object({
  type: z.literal('replace_building'),
  buildingId: BuildingRef,
  floors: z.number().int().min(1).max(80),
  use: BuildingUse,
  units: z.number().int().min(0).max(2000).default(0),
});

export const WidenSidewalk = z.object({
  type: z.literal('widen_sidewalk'),
  streetSegmentId: StreetRef,
  meters: z.number().min(0.5).max(6),
});

export const AddCrosswalk = z.object({
  type: z.literal('add_crosswalk'),
  at: LngLat,
  raised: z.boolean().default(false),
});

export const RemoveParking = z.object({
  type: z.literal('remove_parking'),
  streetSegmentId: StreetRef,
  side: z.enum(['left', 'right', 'both']),
});

export const ChangeOp = z.union([
  AddBikeLane,
  AddBusLane,
  AddPark,
  PlantTrees,
  ReplaceBuilding,
  WidenSidewalk,
  AddCrosswalk,
  RemoveParking,
]);
export type ChangeOp = z.infer<typeof ChangeOp>;
export type ChangeOpType = ChangeOp['type'];

export const CHANGE_OP_LABELS: Record<ChangeOpType, string> = {
  add_bike_lane: 'Bike lane',
  add_bus_lane: 'Bus lane',
  add_park: 'New park',
  plant_trees: 'Plant trees',
  replace_building: 'Rebuild lot',
  widen_sidewalk: 'Wider sidewalk',
  add_crosswalk: 'Crosswalk',
  remove_parking: 'Remove parking',
};

export const ProposalSource = z.enum(['human', 'ai_suggested']);
export type ProposalSource = z.infer<typeof ProposalSource>;

export const DraftInput = z.object({
  areaId: z.string().min(1),
  title: z.string().min(3).max(120),
  description: z.string().max(4000).default(''),
  ops: z.array(ChangeOp).max(50),
  source: ProposalSource.default('human'),
});
export type DraftInput = z.infer<typeof DraftInput>;

export const DraftPatch = DraftInput.partial().omit({ areaId: true });
export type DraftPatch = z.infer<typeof DraftPatch>;
