import { M2_PER_FT2, M_PER_MILE, unproject } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import type { TileData } from '../data/tiles';
import { localTile } from '../scene/local';
import { estimate } from './estimate';
import { UNIT_COSTS } from './unitCosts';

const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
const rect = (x0: number, n0: number, x1: number, n1: number): [number, number][] => [ll(x0, n0), ll(x1, n0), ll(x1, n1), ll(x0, n1)];

// One mile-long street, and a 10 x 10 m, 3-storey (9.6 m) building.
const tile: TileData = {
  id: 'r98c98',
  bbox: [...ll(-900, -100), ...ll(900, 100)] as [number, number, number, number],
  streets: [{ id: 's1', name: 'Mile St', line: [ll(-M_PER_MILE / 2, 0), ll(M_PER_MILE / 2, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false }],
  buildings: [{ id: 'b1', ring: rect(0, 20, 10, 30), heightM: 9.6 }],
  parks: [],
};
const lt = localTile(tile);

describe('estimate', () => {
  it('prices a protected bike lane by lane-mile per side', () => {
    const e = estimate([{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'both', protected: true }], lt);
    expect(e.items).toHaveLength(1);
    expect(e.items[0].quantity).toBeCloseTo(2, 2);
    expect(e.subtotal).toBeCloseTo(2 * UNIT_COSTS.bikeLaneProtectedPerMile, -3);
    expect(e.total).toBe(e.subtotal + e.contingency);
    expect(e.low).toBeLessThan(e.total);
    expect(e.high).toBeGreaterThan(e.total);
  });

  it('prices trees per tree', () => {
    const e = estimate([{ type: 'plant_trees', count: 12, line: [ll(0, 5), ll(100, 5)] }], lt);
    expect(e.subtotal).toBe(12 * UNIT_COSTS.streetTree);
  });

  it('prices a park by area and charges for clearing buildings inside it', () => {
    const e = estimate([{ type: 'add_park', polygon: rect(-10, 10, 20, 40) }], lt); // 30 x 30 m
    const park = e.items.find((i) => i.unit === 'sq ft')!;
    expect(park.quantity).toBeCloseTo(900 / M2_PER_FT2, 0);
    const clear = e.items.find((i) => i.label.startsWith('Clear'))!;
    expect(clear.label).toContain('1 existing');
    expect(clear.quantity).toBeCloseTo((100 * 3) / M2_PER_FT2, 0);
  });

  it('derives affordable unit count from floor area when not given', () => {
    const e = estimate([{ type: 'replace_building', buildingId: 'b1', floors: 20, use: 'affordable_housing', units: 0 }], lt);
    const homes = e.items.find((i) => i.unit === 'unit')!;
    expect(homes.quantity).toBe(Math.floor((100 * 20) / M2_PER_FT2 / 950));
  });

  it('ignores ops that reference missing features', () => {
    expect(estimate([{ type: 'add_bus_lane', streetSegmentId: 'nope', side: 'left' }], lt).total).toBe(0);
  });
});
