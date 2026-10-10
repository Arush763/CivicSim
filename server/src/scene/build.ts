import type { ChangeOp } from '@mamdani/shared';
import {
  MeshBuilder,
  hashString,
  mulberry32,
  offsetLine,
  pointInRing,
  pointsAlong,
  ringCentroid,
  signedArea,
  simplifyRing,
  type RGB,
  type V2,
} from './geometry';
import type { LocalTile } from './local';
import { CAR_COLORS, MATERIALS, USE_COLORS, buildingColor, type MaterialName } from './palette';

export type Lod = 0 | 1 | 2;
/**
 * 'full' draws the whole street scene. 'changes' draws only what the ops change, over a quiet
 * base of flat street ribbons and building footprints for orientation.
 */
export type SceneStyle = 'full' | 'changes';
export type SceneParts = Map<MaterialName, MeshBuilder>;

/**
 * Where detailed props stand, in local meters (x east, n north), so a viewer can place
 * real-looking models (Street View) instead of the render's simple shapes.
 * Headings are radians from east, counter-clockwise, in the direction of travel.
 */
export interface SceneProps {
  trees: [x: number, n: number, scale: number][];
  posts: [x: number, n: number][];
  stencils: [x: number, n: number, heading: number, kind: 'bike' | 'bus'][];
}
export const emptyProps = (): SceneProps => ({ trees: [], posts: [], stencils: [] });

type Side = 'left' | 'right';
const SIDE_SIGN: Record<Side, number> = { left: 1, right: -1 };
const expand = (s: 'left' | 'right' | 'both'): Side[] => (s === 'both' ? ['left', 'right'] : [s]);

// Street cross-section, meters.
const SIDEWALK_W = 4.5;
const BIKE_W = 1.8;
const BUFFER_W = 0.9;
const BUS_W = 3.3;
const PARKING_W = 2.4;
const STOREY_M = 3.2;
const GROUND_FLOOR_M = 4.5;

// Vertical stacking to avoid z-fighting between flat layers.
const Y = { ground: 0, park: 0.07, sidewalk: 0.08, road: 0.1, lane: 0.12, marking: 0.13, parkNew: 0.15 };

interface StreetMod {
  bike: Set<Side>;
  protectedBike: boolean;
  bus: Set<Side>;
  widenM: number;
  noParking: Set<Side>;
}

export function newBuildingHeight(floors: number) {
  return GROUND_FLOOR_M + (floors - 1) * STOREY_M;
}

/**
 * Build the scene for one tile with `ops` applied, at the given level of detail.
 * Deterministic: the same (tile, ops, lod, style) always yields identical geometry.
 */
export function buildScene(lt: LocalTile, ops: ChangeOp[], lod: Lod, style: SceneStyle = 'full', props: SceneProps = emptyProps()): SceneParts {
  const changesOnly = style === 'changes';
  const parts: SceneParts = new Map();
  const mesh = (m: MaterialName): MeshBuilder | null => {
    if (MATERIALS[m].maxLod < lod) return null;
    let b = parts.get(m);
    if (!b) parts.set(m, (b = new MeshBuilder(!!MATERIALS[m].vertexColors)));
    return b;
  };
  const toLocal = lt.toLocal;

  // ---- resolve ops into per-feature modifications
  const streetMods = new Map<string, StreetMod>();
  const mod = (id: string) => {
    let m = streetMods.get(id);
    if (!m) streetMods.set(id, (m = { bike: new Set(), protectedBike: false, bus: new Set(), widenM: 0, noParking: new Set() }));
    return m;
  };
  const removed = new Set<string>();
  const replaced = new Map<string, Extract<ChangeOp, { type: 'replace_building' }>>();
  const beacons: { at: V2; height: number }[] = [];
  const streetById = new Map(lt.streets.map((s) => [s.id, s]));
  const streetMid = (id: string): V2 | null => {
    const s = streetById.get(id);
    return s ? s.line[Math.floor(s.line.length / 2)] : null;
  };

  for (const op of ops) {
    switch (op.type) {
      case 'add_bike_lane': {
        const m = mod(op.streetSegmentId);
        for (const side of expand(op.side)) m.bike.add(side);
        m.protectedBike ||= op.protected;
        break;
      }
      case 'add_bus_lane':
        for (const side of expand(op.side)) mod(op.streetSegmentId).bus.add(side);
        break;
      case 'widen_sidewalk':
        mod(op.streetSegmentId).widenM = Math.max(mod(op.streetSegmentId).widenM, op.meters);
        break;
      case 'remove_parking':
        for (const side of expand(op.side)) mod(op.streetSegmentId).noParking.add(side);
        break;
      case 'replace_building':
        replaced.set(op.buildingId, op);
        break;
      case 'add_park': {
        const ring = op.polygon.map(toLocal);
        for (const b of lt.buildings) if (pointInRing(b.centroid, ring)) removed.add(b.id);
        break;
      }
      default:
        break;
    }
    const at = opAnchor(op, lt, streetMid);
    if (at) beacons.push({ at, height: 45 });
  }

  // ---- ground
  const [hx, hn] = lt.half;
  mesh('ground')?.flat([[-hx, -hn], [hx, -hn], [hx, hn], [-hx, hn]], Y.ground);

  // ---- existing parks (+ trees)
  for (const p of lt.parks) {
    mesh('park')?.flat(p.ring, Y.park);
    if (changesOnly) continue;
    const area = Math.abs(signedArea(p.ring));
    scatterTrees(p.ring, Math.min(60, Math.floor(area / 150)), mulberry32(hashString(p.id + lt.id)));
  }

  // ---- streets
  for (const s of lt.streets) {
    const m = streetMods.get(s.id);
    if (changesOnly && !m) continue; // unchanged streets are just the dark ground between blocks
    const halfRoad = Math.max(3, s.widthM / 2 - (m?.widenM ?? 0));
    mesh('sidewalk')?.ribbon(s.line, s.widthM + SIDEWALK_W * 2, Y.sidewalk);
    mesh('road')?.ribbon(s.line, halfRoad * 2, Y.road);

    const parkingSides: Side[] = s.parkingLanes >= 2 ? ['left', 'right'] : s.parkingLanes === 1 ? ['right'] : [];
    const bikeSides = m?.bike.size ? m.bike : new Set<Side>(s.hasBikeLane ? ['right'] : []);

    for (const side of ['left', 'right'] as Side[]) {
      const sign = SIDE_SIGN[side];
      // Offset from the centerline for a band that sits `a`..`b` meters in from the curb.
      const band = (a: number, b: number) => ({ offset: sign * (halfRoad - (a + b) / 2), width: b - a });
      let cursor = 0;

      // Travel runs along the line on its right side and against it on the left.
      const along = (h: number) => (side === 'right' ? h : h + Math.PI);
      const edgeLine = (at: number, w = 0.15) => mesh('lane_line')?.ribbon(s.line, w, Y.marking, sign * (halfRoad - at));
      if (bikeSides.has(side)) {
        const { offset, width } = band(cursor, cursor + BIKE_W);
        mesh('bike')?.ribbon(s.line, width, Y.lane, offset);
        cursor += BIKE_W;
        if (m?.bike.has(side)) {
          edgeLine(cursor);
          for (const { p, heading } of trimmedPoints(offsetLine(s.line, offset), 28, 10)) props.stencils.push([r2(p[0]), r2(p[1]), r3(along(heading)), 'bike']);
        }
        if (m?.protectedBike && m.bike.has(side)) {
          const buf = band(cursor, cursor + BUFFER_W);
          mesh('buffer')?.ribbon(s.line, buf.width, Y.lane, buf.offset);
          edgeLine(cursor + BUFFER_W);
          hatch(s.line, buf.offset, buf.width);
          const posts = mesh('post');
          for (const { p } of trimmedPoints(offsetLine(s.line, buf.offset), 3, 4)) {
            posts?.box(p[0], p[1], 0.18, 0.18, Y.lane, 0.9);
            props.posts.push([r2(p[0]), r2(p[1])]);
          }
          cursor += BUFFER_W;
        }
      }
      if (m?.bus.has(side)) {
        const { offset, width } = band(cursor, cursor + BUS_W);
        mesh('bus')?.ribbon(s.line, width, Y.lane, offset);
        edgeLine(cursor + BUS_W, 0.25);
        for (const { p, heading } of trimmedPoints(offsetLine(s.line, offset), 32, 12)) props.stencils.push([r2(p[0]), r2(p[1]), r3(along(heading)), 'bus']);
        cursor += BUS_W; // curbside bus lanes displace parking on that side
      } else if (!changesOnly && parkingSides.includes(side) && !m?.noParking.has(side)) {
        const cars = mesh('car');
        if (cars) {
          // Seeded per street side so unchanged streets look identical before and after.
          const rng = mulberry32(hashString(s.id + side));
          const carLine = offsetLine(s.line, band(cursor, cursor + PARKING_W).offset);
          for (const { p, heading } of trimmedPoints(carLine, 6.5, 9)) {
            if (rng() < 0.25) continue;
            const color: RGB = CAR_COLORS[Math.floor(rng() * CAR_COLORS.length)];
            cars.box(p[0], p[1], 4.4, 1.85, Y.lane, 1.45, heading, color);
          }
        }
      }
    }

    // Dashed center line on two-way streets.
    const marks = mesh('marking');
    if (marks && !changesOnly && s.travelLanes >= 2) {
      for (const { p, heading } of trimmedPoints(s.line, 9, 6)) {
        const d: V2 = [Math.cos(heading) * 1.5, Math.sin(heading) * 1.5];
        marks.ribbon([[p[0] - d[0], p[1] - d[1]], [p[0] + d[0], p[1] + d[1]]], 0.15, Y.marking);
      }
    }
  }

  // ---- buildings
  const shape = (ring: V2[]): V2[] => {
    if (lod === 0) return ring;
    if (lod === 1) return simplifyRing(ring, 2);
    const xs = ring.map((p) => p[0]);
    const ns = ring.map((p) => p[1]);
    const [x0, x1, n0, n1] = [Math.min(...xs), Math.max(...xs), Math.min(...ns), Math.max(...ns)];
    return [[x0, n0], [x1, n0], [x1, n1], [x0, n1]];
  };
  for (const b of lt.buildings) {
    if (removed.has(b.id)) continue;
    const rep = replaced.get(b.id);
    if (rep) {
      const c = changesOnly ? undefined : USE_COLORS[rep.use];
      mesh('building_new')?.prism(shape(b.ring), 0, newBuildingHeight(rep.floors), c, c && darken(c, 0.8));
      continue;
    }
    if (changesOnly) {
      mesh('city_building')?.prism(shape(b.ring), 0, b.heightM);
      continue;
    }
    const c = buildingColor(hashString(b.id), b.heightM);
    mesh('building')?.prism(shape(b.ring), 0, b.heightM, c, darken(c, 0.82));
  }

  // ---- additive ops: parks, trees, crosswalks
  for (const op of ops) {
    const rng = mulberry32(hashString(JSON.stringify(op)));
    if (op.type === 'add_park') {
      const ring = op.polygon.map(toLocal);
      mesh('park_new')?.flat(ring, Y.parkNew);
      scatterTrees(ring, Math.min(150, Math.floor(Math.abs(signedArea(ring)) / 120)), rng);
    } else if (op.type === 'plant_trees') {
      if (op.line) {
        const line = op.line.map(toLocal);
        const len = line.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
        const spacing = len / op.count;
        for (const { p } of pointsAlong(line, spacing, spacing / 2).slice(0, op.count)) tree(p, 0.9 + rng() * 0.3);
      } else if (op.polygon) {
        scatterTrees(op.polygon.map(toLocal), op.count, rng);
      }
    } else if (op.type === 'add_crosswalk') {
      crosswalk(toLocal(op.at), op.raised);
    }
  }

  // ---- highlight beacons for every change
  // The full style marks each change with a beacon; the changes-only style is already all change.
  const hl = beacons.length && !changesOnly ? mesh('highlight') : null;
  if (hl) for (const { at, height } of beacons) hl.box(at[0], at[1], 1.6, 1.6, 0, height);

  return parts;

  // -------------------------------------------------------------- helpers (hoisted)
  /** Diagonal white stripes across a buffer, like painted chevrons. */
  function hatch(line: V2[], offset: number, width: number) {
    const marks = mesh('lane_line');
    if (!marks) return;
    for (const { p, heading } of trimmedPoints(offsetLine(line, offset), 3, 3)) {
      const a = heading + Math.PI / 4;
      const half = (width / 2) * Math.SQRT2 * 0.9;
      marks.ribbon([[p[0] - Math.cos(a) * half, p[1] - Math.sin(a) * half], [p[0] + Math.cos(a) * half, p[1] + Math.sin(a) * half]], 0.12, Y.marking);
    }
  }

  function tree(p: V2, scale: number) {
    props.trees.push([r2(p[0]), r2(p[1]), r3(scale)]);
    mesh('trunk')?.box(p[0], p[1], 0.35, 0.35, Y.lane, 2.6 * scale);
    mesh('canopy')?.blob(p[0], 4.2 * scale, p[1], 2.3 * scale);
  }

  function scatterTrees(ring: V2[], count: number, r: () => number) {
    if (count <= 0 || MATERIALS.canopy.maxLod < lod) return;
    const xs = ring.map((p) => p[0]);
    const ns = ring.map((p) => p[1]);
    const [x0, x1, n0, n1] = [Math.min(...xs), Math.max(...xs), Math.min(...ns), Math.max(...ns)];
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * 30; attempt++) {
      const p: V2 = [x0 + r() * (x1 - x0), n0 + r() * (n1 - n0)];
      if (!pointInRing(p, ring)) continue;
      tree(p, 0.8 + r() * 0.5);
      placed++;
    }
  }

  function crosswalk(at: V2, raised: boolean) {
    const s = nearestStreet(lt, at);
    if (!s) return;
    const { heading, halfRoad } = s;
    const dir: V2 = [Math.cos(heading), Math.sin(heading)];
    const perp: V2 = [-dir[1], dir[0]];
    const y = raised ? Y.marking + 0.12 : Y.marking;
    if (raised) {
      const road = mesh('road');
      road?.box(at[0], at[1], 5, halfRoad * 2, Y.road - 0.05, 0.17, heading);
    }
    const marks = mesh('marking') ?? mesh('buffer'); // stripes still read at lod1 via the buffer tone
    if (!marks) return;
    for (let off = -halfRoad + 0.6; off <= halfRoad - 0.6; off += 1.2) {
      const c: V2 = [at[0] + perp[0] * off, at[1] + perp[1] * off];
      marks.ribbon([[c[0] - dir[0] * 1.5, c[1] - dir[1] * 1.5], [c[0] + dir[0] * 1.5, c[1] + dir[1] * 1.5]], 0.6, y);
    }
  }
}

/** Evenly spaced points that stay `margin` meters clear of both ends (i.e. away from intersections). */
function trimmedPoints(line: V2[], spacing: number, margin: number) {
  const len = line.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
  if (len < margin * 2) return [];
  const count = Math.floor((len - margin * 2) / spacing) + 1;
  return pointsAlong(line, spacing, margin).slice(0, count);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function darken(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

export function nearestStreet(lt: LocalTile, p: V2) {
  let best: { id: string; dist: number; heading: number; halfRoad: number } | null = null;
  for (const s of lt.streets) {
    for (let i = 0; i < s.line.length - 1; i++) {
      const a = s.line[i];
      const b = s.line[i + 1];
      const dx = b[0] - a[0];
      const dn = b[1] - a[1];
      const l2 = dx * dx + dn * dn || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dn) / l2));
      const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dn));
      if (!best || d < best.dist) best = { id: s.id, dist: d, heading: Math.atan2(dn, dx), halfRoad: s.widthM / 2 };
    }
  }
  return best;
}

function opAnchor(op: ChangeOp, lt: LocalTile, streetMid: (id: string) => V2 | null): V2 | null {
  switch (op.type) {
    case 'add_bike_lane':
    case 'add_bus_lane':
    case 'widen_sidewalk':
    case 'remove_parking':
      return streetMid(op.streetSegmentId);
    case 'replace_building':
      return lt.buildings.find((b) => b.id === op.buildingId)?.centroid ?? null;
    case 'add_park':
      return ringCentroid(op.polygon.map(lt.toLocal));
    case 'plant_trees':
      return ringCentroid((op.line ?? op.polygon ?? []).map(lt.toLocal));
    case 'add_crosswalk':
      return lt.toLocal(op.at);
  }
}

/**
 * Surround a changes-only scene with the neighbouring zones' buildings (grey, no detail) and a
 * ground plate under all of them, so a request's 3D view sits inside the city, not in a void.
 */
export function addNeighbourContext(parts: SceneParts, lt: LocalTile, neighbours: { ring: V2[]; heightM: number }[], lod: Lod) {
  const mesh = (m: MaterialName) => {
    let b = parts.get(m);
    if (!b) parts.set(m, (b = new MeshBuilder(!!MATERIALS[m].vertexColors)));
    return b;
  };
  const blocks = mesh('city_building');
  for (const b of neighbours) {
    const ring = lod === 0 ? simplifyRing(b.ring, 1.5) : simplifyRing(b.ring, 3);
    if (Math.abs(signedArea(ring)) < 30) continue;
    blocks.prism(ring, 0, Math.max(4, b.heightM));
  }
  const [hx, hn] = lt.half;
  // Three zones wide in each direction, just under the zone's own ground.
  mesh('ground').flat([[-hx * 3, -hn * 3], [hx * 3, -hn * 3], [hx * 3, hn * 3], [-hx * 3, hn * 3]], Y.ground - 0.02);
}
