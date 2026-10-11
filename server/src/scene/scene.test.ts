import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { ChangeOp } from '@mamdani/shared';
import { unproject } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import type { TileData } from '../data/tiles';
import { buildScene, crosswalkSpot, junctions, newBuildingHeight } from './build';
import { toGlb } from './exportGlb';
import { simplifyRing, type V2 } from './geometry';
import { localTile } from './local';

// A synthetic 200 m tile: one two-way street running east-west with parking both sides,
// and two buildings north of it.
const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
const rect = (x0: number, n0: number, x1: number, n1: number): [number, number][] => [
  ll(x0, n0), ll(x1, n0), ll(x1, n1), ll(x0, n1),
];
const tile: TileData = {
  id: 'r99c99',
  bbox: [...ll(-100, -100), ...ll(100, 100)] as [number, number, number, number],
  streets: [
    { id: 's1', name: 'Test St', line: [ll(-90, 0), ll(90, 0)], widthM: 16, travelLanes: 2, parkingLanes: 2, hasBikeLane: false },
  ],
  buildings: [
    { id: 'b1', ring: rect(-40, 20, -10, 40), heightM: 20 },
    { id: 'b2', ring: rect(10, 20, 40, 40), heightM: 60 },
  ],
  parks: [],
};
const lt = localTile(tile);

const vcount = (parts: ReturnType<typeof buildScene>, m: string) => parts.get(m as never)?.vertexCount ?? 0;

describe('buildScene', () => {
  it('builds the base scene without change-only materials', () => {
    const parts = buildScene(lt, [], 0);
    expect(vcount(parts, 'building')).toBeGreaterThan(0);
    expect(vcount(parts, 'car')).toBeGreaterThan(0);
    expect(parts.has('bike')).toBe(false);
    expect(parts.has('highlight')).toBe(false);
  });

  it('is deterministic', () => {
    const ops: ChangeOp[] = [{ type: 'plant_trees', count: 8, polygon: rect(-30, -60, 30, -30) }];
    const a = buildScene(lt, ops, 0).get('canopy')!.positions;
    const b = buildScene(lt, ops, 0).get('canopy')!.positions;
    expect(a).toEqual(b);
  });

  it('keeps unchanged parked cars identical between before and after', () => {
    const before = buildScene(lt, [], 0).get('car')!.positions;
    const after = buildScene(lt, [{ type: 'plant_trees', count: 3, line: [ll(-50, 10), ll(50, 10)] }], 0).get('car')!.positions;
    expect(after).toEqual(before);
  });

  it('adds a protected bike lane and removes parking on that side', () => {
    const before = vcount(buildScene(lt, [], 0), 'car');
    const parts = buildScene(lt, [{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: true }], 0);
    expect(vcount(parts, 'bike')).toBeGreaterThan(0);
    expect(vcount(parts, 'buffer')).toBeGreaterThan(0);
    expect(vcount(parts, 'highlight')).toBeGreaterThan(0);
    // Parking stays but shifts outward; bus lanes, not bike lanes, displace it.
    expect(vcount(parts, 'car')).toBeGreaterThan(0);
    const bus = buildScene(lt, [{ type: 'add_bus_lane', streetSegmentId: 's1', side: 'both' }], 0);
    expect(vcount(bus, 'car')).toBe(0);
    expect(before).toBeGreaterThan(0);
  });

  it('replaces a building with a new one of the requested height', () => {
    const parts = buildScene(lt, [{ type: 'replace_building', buildingId: 'b1', floors: 10, use: 'affordable_housing', units: 80 }], 0);
    const ys = parts.get('building_new')!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(newBuildingHeight(10));
    // Only b2 remains in the regular building mesh.
    const oldYs = parts.get('building')!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...oldYs)).toBeCloseTo(60);
  });

  it('clears buildings that sit inside a new park', () => {
    const parts = buildScene(lt, [{ type: 'add_park', polygon: rect(-50, 15, 0, 45) }], 1);
    const ys = parts.get('building')!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(60); // b1 (20 m) gone, b2 stays
    expect(vcount(parts, 'park_new')).toBeGreaterThan(0);
    expect(vcount(parts, 'canopy')).toBeGreaterThan(0);
  });

  it('drops props at lower LODs and gets smaller', () => {
    const size = (l: 0 | 1 | 2) => [...buildScene(lt, [], l).values()].reduce((t, m) => t + m.vertexCount, 0);
    expect(buildScene(lt, [], 2).has('car')).toBe(false);
    expect(buildScene(lt, [], 1).has('car')).toBe(false);
    expect(size(0)).toBeGreaterThan(size(1));
    expect(size(1)).toBeGreaterThan(size(2));
  });

  it('builds up-facing roofs and outward walls', () => {
    const b = buildScene(lt, [], 0).get('building')!;
    // Every face normal must point away from the building interior or up.
    for (let i = 0; i < b.indices.length; i += 3) {
      const v = b.indices[i];
      const [nx, ny, nz] = b.normals.slice(v * 3, v * 3 + 3);
      const [px, , pz] = b.positions.slice(v * 3, v * 3 + 3);
      const center = px < 0 ? [-25, -30] : [25, -30]; // building centers in world (x, z)
      if (ny > 0.5) continue;
      expect(nx * (px - center[0]) + nz * (pz - center[1])).toBeGreaterThan(0);
    }
  });
});

describe('changes-only style', () => {
  it('draws only the changes over a flat base', () => {
    const ops: ChangeOp[] = [
      { type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: true },
      { type: 'replace_building', buildingId: 'b1', floors: 6, use: 'community_center', units: 0 },
    ];
    const parts = buildScene(lt, ops, 0, 'changes');
    expect(vcount(parts, 'bike')).toBeGreaterThan(0);
    expect(vcount(parts, 'building_new')).toBeGreaterThan(0);
    // No street detail: no parked cars, no coloured existing buildings, no beacons.
    expect(parts.has('building')).toBe(false);
    expect(parts.has('car')).toBe(false);
    expect(parts.has('highlight')).toBe(false);
    // Existing buildings are plain grey blocks at their real height for context.
    const ys = parts.get('city_building')!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(60);
  });

  it('leaves unchanged streets out entirely', () => {
    const parts = buildScene(lt, [{ type: 'plant_trees', count: 4, line: [ll(-50, 10), ll(50, 10)] }], 0, 'changes');
    expect(parts.has('context_road')).toBe(false);
    expect(parts.has('road')).toBe(false);
    expect(vcount(parts, 'canopy')).toBeGreaterThan(0);
  });
});

describe('simplifyRing', () => {
  it('drops near-collinear points but keeps corners', () => {
    const ring: V2[] = [[0, 0], [5, 0.1], [10, 0], [10, 10], [0, 10]];
    expect(simplifyRing(ring, 0.5)).toHaveLength(4);
  });
});

describe('toGlb', () => {
  it('writes a valid, readable, quantized GLB', async () => {
    const glb = await toGlb(buildScene(lt, [{ type: 'add_crosswalk', at: ll(0, 0), raised: true }], 0), { areaId: tile.id });
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(glb);
    const names = doc.getRoot().listMeshes().map((m) => m.getName());
    expect(names).toEqual(expect.arrayContaining(['building', 'road', 'marking', 'highlight']));
    expect(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain('KHR_mesh_quantization');
  });
});

describe('scene props for realistic viewers', () => {
  it('places posts and bike symbols along a protected lane, and records trees', async () => {
    const { emptyProps } = await import('./build');
    const props = emptyProps();
    const parts = buildScene(lt, [
      { type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: true },
      { type: 'plant_trees', count: 4, line: [ll(-50, 10), ll(50, 10)] },
    ], 0, 'changes', props);
    expect(props.posts.length).toBeGreaterThan(20);
    expect(props.stencils.every((s) => s[3] === 'bike')).toBe(true);
    expect(props.stencils.length).toBeGreaterThanOrEqual(3);
    expect(props.trees).toHaveLength(4);
    expect(vcount(parts, 'lane_line')).toBeGreaterThan(0);
  });
});

describe('changes fit their setting', () => {
  it('puts a new lane beside parked cars rather than under them', async () => {
    const { emptyProps } = await import('./build');
    // Test St has parking on both sides: the lane should start 2.4 m out from the kerb.
    const parts = buildScene(lt, [{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: false }], 0, 'changes', emptyProps());
    const ns = parts.get('bike')!.positions.filter((_, i) => i % 3 === 2).map((z) => -z);
    // Kerb is at n = -8 (16 m road); the lane spans n ≈ -5.6 .. -3.8, clear of the parking lane.
    expect(Math.min(...ns)).toBeGreaterThan(-5.7);
  });

  it('gives a rural road a separate path, with no paint or posts', async () => {
    const { emptyProps } = await import('./build');
    const rural = localTile({ ...tile, id: 'r98c98', streets: tile.streets.map((s) => ({ ...s, setting: 'rural' as const })) });
    const props = emptyProps();
    const parts = buildScene(rural, [{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'both', protected: true }], 0, 'changes', props);
    expect(parts.has('bike_path')).toBe(true);
    expect(parts.has('bike')).toBe(false);
    expect(props.posts).toHaveLength(0);
    expect(props.setting).toBe('rural');
  });
});

describe('fitLanes', () => {
  it('drops the buffer, then parking, when a design does not leave room for traffic', async () => {
    const { fitLanes } = await import('./build');
    const mod = { bike: new Set(['right'] as const), protectedBike: true, bus: new Set<'left' | 'right'>(), widenM: 0, noParking: new Set<'left' | 'right'>() };
    expect(fitLanes({ travelLanes: 2 }, 16, mod as never, ['left', 'right'])).toMatchObject({ buffer: true });
    const tight = fitLanes({ travelLanes: 2 }, 12, mod as never, ['left', 'right']);
    expect(tight.buffer).toBe(false);
    expect([...tight.keepParking]).toEqual(['left']); // parking goes on the lane's side only
  });
});

describe('real-world placement', () => {
  it('moves trees out of the road onto the sidewalk, and keeps them out of buildings', async () => {
    const { emptyProps } = await import('./build');
    const props = emptyProps();
    // A line of trees straight down the middle of Test St (the road runs along n = 0, 16 m wide).
    buildScene(lt, [{ type: 'plant_trees', count: 6, line: [ll(-60, 0.5), ll(60, 0.5)] }], 0, 'changes', props);
    expect(props.trees.length).toBeGreaterThan(3);
    for (const [, n] of props.trees) expect(Math.abs(n)).toBeGreaterThanOrEqual(8.5); // kerb at 8 m, +1 m
    // An area that is all building: no trees.
    const none = emptyProps();
    buildScene(lt, [{ type: 'plant_trees', count: 5, polygon: rect(-38, 22, -12, 38) }], 0, 'changes', none);
    expect(none.trees).toHaveLength(0);
  });

  it('builds a widened sidewalk as raised strips only where the sidewalk grows', () => {
    const parts = buildScene(lt, [{ type: 'widen_sidewalk', streetSegmentId: 's1', meters: 2 }], 0, 'changes');
    const ys = parts.get('sidewalk_new')!.positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.15, 2);
    const ns = parts.get('sidewalk_new')!.positions.filter((_, i) => i % 3 === 2).map((z) => -z);
    // Old kerb at 8 m, new kerb 2 m further in: the strips span |n| 6..8.
    expect(Math.min(...ns.map(Math.abs))).toBeGreaterThan(5.9);
    expect(Math.max(...ns.map(Math.abs))).toBeLessThan(8.1);
  });
});

describe('placing things where they would really go', () => {
  // A + junction: an east–west street and a north–south street crossing at the origin.
  const cross = localTile({
    id: 'r96c96',
    bbox: [...ll(-120, -120), ...ll(120, 120)] as [number, number, number, number],
    streets: [
      { id: 'ew1', name: 'E–W', line: [ll(-100, 0), ll(0, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false },
      { id: 'ew2', name: 'E–W', line: [ll(0, 0), ll(100, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false },
      { id: 'ns', name: 'N–S', line: [ll(0, -100), ll(0, 100)], widthM: 10, travelLanes: 2, parkingLanes: 2, hasBikeLane: false },
    ],
    buildings: [],
    parks: [],
  });
  const local = (x: number, n: number) => cross.toLocal(ll(x, n));

  it('finds where streets meet', () => {
    const c = local(0, 0);
    expect(junctions(cross).some((j) => Math.hypot(j.p[0] - c[0], j.p[1] - c[1]) < 1)).toBe(true);
  });

  it('moves a crosswalk asked for in the middle of an intersection to just outside it', () => {
    const c = local(0, 0);
    const at = crosswalkSpot(cross, local(1, 1));
    const fromCentre = Math.hypot(at[0] - c[0], at[1] - c[1]);
    expect(fromCentre).toBeGreaterThanOrEqual(6 + 3 - 0.01); // past the widest kerb (6 m) plus the setback
    expect(fromCentre).toBeLessThan(15);
  });

  it('leaves a mid-block crosswalk where it was asked for', () => {
    const want = local(-50, 0);
    const at = crosswalkSpot(cross, local(-50, 2));
    expect(Math.hypot(at[0] - want[0], at[1] - want[1])).toBeLessThan(1);
  });
});
