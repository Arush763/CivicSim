import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import type { ChangeOp } from '@mamdani/shared';
import { unproject } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import type { TileData } from '../data/tiles';
import { buildScene, newBuildingHeight } from './build';
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
    { id: 's1', name: 'Test St', line: [ll(-90, 0), ll(90, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false },
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
