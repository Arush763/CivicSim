import type { ChangeOp, ChangeOpType } from './changeOps';
import { centroid, project } from './geo';

/**
 * Which changes make sense where. The phone app and admin panel grey out what doesn't (with the
 * reason), and the server turns down requests that ask for it anyway, so nobody is asked to vote
 * on a bike lane that already exists or a bus lane on a one-lane country road.
 *
 * Facts the older zone data doesn't have are treated as unknown, and unknown never blocks.
 */
export interface StreetFacts {
  id: string;
  lengthM: number;
  widthM: number;
  line?: [number, number][];
  travelLanes?: number;
  parkingLanes?: number;
  hasBikeLane?: boolean;
  setting?: 'urban' | 'suburban' | 'rural';
}

export interface BuildingFacts {
  id: string;
  heightM: number;
  footprintM2: number;
}

export interface ParkFacts {
  id: string;
  name?: string;
  ring: [number, number][];
}

export interface SceneFacts {
  origin: [number, number];
  streets: StreetFacts[];
  buildings: BuildingFacts[];
  parks?: ParkFacts[];
}

export type Verdict = { ok: true } | { ok: false; reason: string };
const OK: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** Widths the 3D model builds with (server/src/scene/build.ts). */
const LANE_W = 3.0;
const BIKE_W = 1.8;
const BUS_W = 3.3;
/** Shorter than this, a lane or a wider sidewalk is just the corner of an intersection. */
const MIN_STRETCH_M = 15;
/** Two crosswalks closer than this are the same crossing. */
const CROSSWALK_GAP_M = 20;

export type StreetChange = Extract<ChangeOpType, 'add_bike_lane' | 'add_bus_lane' | 'remove_parking' | 'widen_sidewalk'>;
export const STREET_CHANGES: StreetChange[] = ['add_bike_lane', 'add_bus_lane', 'remove_parking', 'widen_sidewalk'];

/** Road width left over once the traffic lanes have theirs (unknown lanes: all of it). */
const spare = (s: StreetFacts) => s.widthM - (s.travelLanes ?? 0) * LANE_W;

/** The most a sidewalk on this street can be widened by, in metres (0 = not at all). */
export function maxSidewalkWidening(s: StreetFacts): number {
  return Math.max(0, Math.min(6, Math.floor(spare(s) * 2) / 2));
}

/** Whether a street change can go on this street. */
export function streetVerdict(type: StreetChange, s: StreetFacts): Verdict {
  if (s.lengthM < MIN_STRETCH_M) return no('This stretch is too short: it’s only the corner of an intersection.');
  switch (type) {
    case 'add_bike_lane':
      if (s.hasBikeLane) return no('This street already has a bike lane.');
      // Country roads get a separate path beside the road, so their width doesn't matter.
      if (s.setting !== 'rural' && s.travelLanes !== undefined && spare(s) < BIKE_W) return no('Too narrow: there’s no room for a bike lane beside its traffic lanes.');
      return OK;
    case 'add_bus_lane':
      if (s.setting === 'rural') return no('Country roads don’t get bus lanes.');
      if (s.widthM < 9) return no('Too narrow for a bus lane.');
      if (s.travelLanes !== undefined && s.travelLanes < 2 && spare(s) < BUS_W) return no('Too narrow: it has one traffic lane and no room for a bus lane.');
      return OK;
    case 'remove_parking':
      if (s.parkingLanes === 0) return no('This street has no parking to remove.');
      return OK;
    case 'widen_sidewalk':
      if (s.travelLanes !== undefined && maxSidewalkWidening(s) < 0.5) return no('No room: the road is only as wide as its traffic lanes.');
      return OK;
  }
}

/** Whether this building can be rebuilt. */
export function buildingVerdict(b: BuildingFacts): Verdict {
  if (b.footprintM2 < 80) return no('Too small a lot to rebuild.');
  if (b.heightM >= 60) return no('This is already a high-rise.');
  return OK;
}

/** Whether a change type has anywhere to go in this zone (for greying out its button). */
export function typeVerdict(type: ChangeOpType, scene: SceneFacts): Verdict {
  if ((STREET_CHANGES as ChangeOpType[]).includes(type)) {
    if (!scene.streets.length) return no('There are no streets in this zone.');
    const verdicts = scene.streets.map((s) => streetVerdict(type as StreetChange, s));
    if (verdicts.some((v) => v.ok)) return OK;
    const reasons = [...new Set(verdicts.map((v) => (v.ok ? '' : v.reason)))];
    return no(reasons.length === 1 ? `No street in this zone can take it. ${reasons[0]}` : 'No street in this zone can take it.');
  }
  if (type === 'replace_building') {
    if (!scene.buildings.length) return no('There are no buildings in this zone.');
    return scene.buildings.some((b) => buildingVerdict(b).ok) ? OK : no('No building here can be rebuilt (all too small or already high-rises).');
  }
  if (type === 'add_crosswalk' || type === 'plant_trees') return scene.streets.length ? OK : no('There are no streets in this zone.');
  return OK;
}

function pointInRing(p: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a point (lng, lat) is in a roadway. */
function inRoad(scene: SceneFacts, p: [number, number]): boolean {
  const q = project(scene.origin, p);
  return scene.streets.some((s) => {
    const line = (s.line ?? []).map((x) => project(scene.origin, x));
    for (let i = 0; i < line.length - 1; i++) {
      const [a, b] = [line[i], line[i + 1]];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(q[0] - (a[0] + t * dx), q[1] - (a[1] + t * dy)) <= s.widthM / 2) return true;
    }
    return false;
  });
}

/**
 * Whether one change makes sense, given the zone and the other changes in the same request
 * (`others`: the changes before it). Returns why not, if it doesn't.
 */
export function opVerdict(op: ChangeOp, scene: SceneFacts, others: ChangeOp[] = []): Verdict {
  if ('streetSegmentId' in op) {
    const s = scene.streets.find((x) => x.id === op.streetSegmentId);
    if (!s) return OK; // unknown streets are reported by the server's own checks
    const v = streetVerdict(op.type, s);
    if (!v.ok) return v;
    if (others.some((o) => o.type === op.type && 'streetSegmentId' in o && o.streetSegmentId === op.streetSegmentId)) return no('This street already has that change in this request.');
    if (op.type === 'widen_sidewalk' && s.travelLanes !== undefined && op.meters > maxSidewalkWidening(s)) return no(`This street’s sidewalk can only be widened by up to ${maxSidewalkWidening(s)} m.`);
    return OK;
  }
  switch (op.type) {
    case 'replace_building': {
      const b = scene.buildings.find((x) => x.id === op.buildingId);
      return b ? buildingVerdict(b) : OK;
    }
    case 'add_park': {
      const c = centroid(op.polygon);
      const park = scene.parks?.find((p) => pointInRing(c, p.ring));
      if (park) return no(`That’s already a park${park.name ? ` (${park.name})` : ''}.`);
      if (inRoad(scene, c)) return no('A park can’t go in the middle of a street. Draw it on a lot or a plaza.');
      return OK;
    }
    case 'add_crosswalk': {
      const at = project(scene.origin, op.at);
      const near = others.some((o) => o.type === 'add_crosswalk' && Math.hypot(...(project(scene.origin, o.at).map((v, i) => v - at[i]) as [number, number])) < CROSSWALK_GAP_M);
      return near ? no('There’s already a crosswalk here in this request.') : OK;
    }
    case 'plant_trees':
      return OK;
  }
}
