import { describe, expect, it } from 'vitest';
import { bboxContains, ChangeOp, DraftInput, isZoneId, lineLengthM, polygonAreaM2, rankFor, zoneBbox, zoneBlock, zoneIdAt, zonesInView } from './index';

describe('ChangeOp schema', () => {
  it('accepts a valid bike lane', () => {
    const r = ChangeOp.safeParse({ type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: true });
    expect(r.success).toBe(true);
  });

  it('rejects unknown op types', () => {
    expect(ChangeOp.safeParse({ type: 'demolish_city' }).success).toBe(false);
  });

  it('requires exactly one of line/polygon for trees', () => {
    const line: [number, number][] = [[-74, 40.7], [-74.001, 40.7]];
    expect(ChangeOp.safeParse({ type: 'plant_trees', count: 5, line }).success).toBe(true);
    expect(ChangeOp.safeParse({ type: 'plant_trees', count: 5 }).success).toBe(false);
    expect(
      ChangeOp.safeParse({ type: 'plant_trees', count: 5, line, polygon: [...line, [-74, 40.701]] }).success,
    ).toBe(false);
  });

  it('defaults draft source to human', () => {
    const d = DraftInput.parse({ areaId: 'r0c0', title: 'Safer Canal St', ops: [] });
    expect(d.source).toBe('human');
  });
});

describe('geo', () => {
  it('measures ~111 m for 0.001 deg latitude', () => {
    expect(lineLengthM([[-74, 40.7], [-74, 40.701]])).toBeCloseTo(111.2, 0);
  });

  it('measures a ~100m x 100m square', () => {
    const dLat = 100 / 111195;
    const dLng = 100 / (111195 * Math.cos((40.7 * Math.PI) / 180));
    const sq: [number, number][] = [[-74, 40.7], [-74 + dLng, 40.7], [-74 + dLng, 40.7 + dLat], [-74, 40.7 + dLat]];
    expect(polygonAreaM2(sq)).toBeCloseTo(10000, -1);
  });
});

describe('rankFor', () => {
  it('maps points to tiers', () => {
    expect(rankFor(0)).toBe('Resident');
    expect(rankFor(60)).toBe('Advocate');
    expect(rankFor(1000)).toBe('Council Voice');
  });
});

describe('zone grid', () => {
  it('round-trips a point to a ~200 m zone that contains it', () => {
    for (const [lng, lat] of [[-73.998, 40.7265], [139.7, 35.68], [-0.12, 51.5], [151.2, -33.86], [18.4, -33.9]] as const) {
      const id = zoneIdAt(lng, lat);
      const b = zoneBbox(id)!;
      expect(isZoneId(id)).toBe(true);
      expect(bboxContains(b, [lng, lat])).toBe(true);
      expect(lineLengthM([[b[0], b[1]], [b[0], b[3]]])).toBeCloseTo(200, -1);
      expect(lineLengthM([[b[0], (b[1] + b[3]) / 2], [b[2], (b[1] + b[3]) / 2]])).toBeCloseTo(200, -1);
    }
  });

  it('lines columns up from row to row', () => {
    const a = zoneBbox(zoneIdAt(-73.998, 40.7265))!;
    const above = zoneBbox(zoneIdAt(-73.998, a[3] + 0.0001))!;
    expect(above[0]).toBeCloseTo(a[0], 12);
  });

  it('finds the block of 9 around a zone', () => {
    const id = zoneIdAt(-73.998, 40.7265);
    const block = zoneBlock(id);
    expect(block).toHaveLength(9);
    expect(block).toContain(id);
  });

  it('lists zones in a view and refuses huge views', () => {
    const ids = zonesInView([-74.0, 40.72, -73.99, 40.73]);
    expect(ids.length).toBeGreaterThan(20);
    expect(ids).toContain(zoneIdAt(-73.995, 40.725));
    expect(zonesInView([-75, 40, -73, 42])).toEqual([]);
  });

  it('rejects ids that are not on the grid', () => {
    expect(zoneBbox('r09c14')).toBeNull();
  });
});
