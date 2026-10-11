import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zoneBbox, zoneIdAt } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildingHeight, clipLine, ensureZone, nameZone, osmToTiles, parseMeters, streetProfile, type OsmElement } from './osm';

const id = zoneIdAt(-0.1276, 51.5072); // central London
const [w, s, e, n] = zoneBbox(id)!;
const at = (fx: number, fy: number) => ({ lon: w + (e - w) * fx, lat: s + (n - s) * fy });
const square = (fx: number, fy: number, size = 0.1) => [at(fx, fy), at(fx + size, fy), at(fx + size, fy + size), at(fx, fy + size), at(fx, fy)];

const elements: OsmElement[] = [
  { type: 'way', id: 1, tags: { building: 'yes', height: '30 m' }, geometry: square(0.2, 0.2) },
  { type: 'way', id: 2, tags: { building: 'house', 'building:levels': '3' }, geometry: square(0.6, 0.6) },
  { type: 'way', id: 3, tags: { building: 'yes' }, geometry: square(1.4, 0.5) }, // in the zone to the east
  // A long street crossing the whole block west to east, through the middle of the zone.
  { type: 'way', id: 10, tags: { highway: 'residential', name: 'Test Street', 'cycleway:left': 'lane' }, geometry: [at(-0.9, 0.5), at(1.9, 0.5)] },
  { type: 'way', id: 11, tags: { highway: 'primary', name: 'Main Road', lanes: '4', 'parking:both': 'no' }, geometry: [at(0.3, -0.5), at(0.3, 1.5)] },
  { type: 'way', id: 20, tags: { leisure: 'park', name: 'Big Green' }, geometry: square(0.8, 0.8, 0.5) },
];

describe('OpenStreetMap zones', () => {
  it('reads heights and street profiles from tags', () => {
    expect(parseMeters('23.5')).toBe(23.5);
    expect(parseMeters("75'")).toBeCloseTo(22.86, 1);
    expect(buildingHeight({ building: 'yes', 'building:levels': '5' })).toBeCloseTo(17, 0);
    expect(buildingHeight({ building: 'house' })).toBe(6);
    const main = streetProfile({ highway: 'primary', lanes: '4', 'parking:both': 'no' });
    expect(main).toMatchObject({ travelLanes: 4, parkingLanes: 0, hasBikeLane: false });
    expect(main.widthM).toBeCloseTo(13.2, 1);
    expect(streetProfile({ highway: 'residential', cycleway: 'track' }).hasBikeLane).toBe(true);
  });

  it('clips a polyline to a box', () => {
    const runs = clipLine([[-1, 0.5], [2, 0.5]], [0, 0, 1, 1]);
    expect(runs).toEqual([[[0, 0.5], [1, 0.5]]]);
    expect(clipLine([[2, 2], [3, 3]], [0, 0, 1, 1])).toEqual([]);
  });

  it('splits one fetch into zones', () => {
    const east = zoneIdAt(w + (e - w) * 1.5, s + (n - s) * 0.5);
    const [zone, eastZone] = osmToTiles(elements, [id, east]);
    expect(zone.buildings.map((b) => b.id).sort()).toEqual(['w1', 'w2']);
    expect(zone.buildings.find((b) => b.id === 'w1')!.heightM).toBe(30);
    expect(eastZone.buildings.map((b) => b.id)).toEqual(['w3']);
    // The long street is cut at the zone edges and appears in both zones under the same way id.
    const st = zone.streets.find((x) => x.name === 'Test Street')!;
    expect(st.hasBikeLane).toBe(true);
    expect(st.line[0][0]).toBeCloseTo(w, 9);
    expect(eastZone.streets.some((x) => x.id === 'w10')).toBe(true);
    // The park is clipped to the zone.
    expect(zone.parks[0].ring.every(([x, y]) => x <= e + 1e-12 && y <= n + 1e-12)).toBe(true);
    expect(nameZone(zone)).toBe('Main Road & Test Street');
  });

  it('fetches a zone and its neighbours once, then serves them from disk', async () => {
    const prev = config.dataDir;
    config.dataDir = mkdtempSync(path.join(tmpdir(), 'zones-'));
    try {
      let calls = 0;
      const fake = async () => {
        calls++;
        return elements;
      };
      const [a, b] = await Promise.all([ensureZone(id, fake), ensureZone(id, fake)]);
      expect(calls).toBe(1);
      expect(a.buildings).toHaveLength(2);
      expect(b.name).toBe('Main Road & Test Street');
      expect(readdirSync(path.join(config.dataDir, 'zones'))).toHaveLength(9);
      await ensureZone(id, fake);
      expect(calls).toBe(1);
    } finally {
      config.dataDir = prev;
    }
  });
});

describe('mergeStreets', () => {
  it('joins pieces of one street that continue end-to-start, but not other streets', async () => {
    const { mergeStreets } = await import('./osm');
    const base = { name: 'A St', widthM: 10, travelLanes: 2, parkingLanes: 2, hasBikeLane: false };
    const merged = mergeStreets([
      { id: 'w2', line: [[1, 0], [2, 0]], ...base },
      { id: 'w1', line: [[0, 0], [1, 0]], ...base },
      { id: 'w3', line: [[2, 0], [3, 0]], ...base, name: 'B St' },
    ]);
    expect(merged.map((m) => m.id).sort()).toEqual(['w1', 'w3']);
    expect(merged.find((m) => m.id === 'w1')!.line).toEqual([[0, 0], [1, 0], [2, 0]]);
    // A piece that doubles back (the other side of a divided road, a loop) stays separate.
    const hairpin = mergeStreets([
      { id: 'w1', line: [[0, 0], [0, -1]], ...base },
      { id: 'w2', line: [[0, -1], [0.1, 0]], ...base },
    ]);
    expect(hairpin).toHaveLength(2);
  });
});

describe('roadwayFromBuildings', () => {
  it('measures the gap between buildings on both sides, minus sidewalks', async () => {
    const { roadwayFromBuildings } = await import('./osm');
    // A street along y=0 with building walls 12 m north and 12 m south (24 m gap).
    const lat = 51.5;
    const dy = (m: number) => m / 111_195;
    const dx = (m: number) => m / (111_195 * Math.cos((lat * Math.PI) / 180));
    const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
      [dx(x0), lat + dy(y0)], [dx(x1), lat + dy(y0)], [dx(x1), lat + dy(y1)], [dx(x0), lat + dy(y1)],
    ];
    const line: [number, number][] = [[dx(0), lat], [dx(100), lat]];
    const road = roadwayFromBuildings(line, [box(-10, 12, 110, 30), box(-10, -30, 110, -12)]);
    expect(road).toBeCloseTo(24 - 2 * 4.8, 1);
    expect(roadwayFromBuildings(line, [box(-10, 12, 110, 30)])).toBeNull(); // buildings on one side only
  });
});

describe('streetSetting', () => {
  it('tells city streets from country roads', async () => {
    const { streetSetting } = await import('./osm');
    const lat = 40.7;
    const dx = (m: number) => m / (111_195 * Math.cos((lat * Math.PI) / 180));
    const dy = (m: number) => m / 111_195;
    const line: [number, number][] = [[0, lat], [dx(200), lat]];
    const house = (x: number, y: number): [number, number][] => [[dx(x), lat + dy(y)], [dx(x + 8), lat + dy(y)], [dx(x + 8), lat + dy(y + 8)], [dx(x), lat + dy(y + 8)]];
    const row = Array.from({ length: 20 }, (_, i) => house(i * 10, 12)).concat(Array.from({ length: 20 }, (_, i) => house(i * 10, -20)));
    expect(streetSetting({ highway: 'residential' }, line, row)).toBe('urban');
    expect(streetSetting({ highway: 'residential' }, line, row.slice(0, 6))).toBe('suburban');
    expect(streetSetting({ highway: 'tertiary', maxspeed: '50 mph' }, line, [house(50, 20)])).toBe('rural');
    // A village road with its houses missing from OSM: the mapped residential area still counts.
    const town: [number, number][] = [[dx(-50), lat - dy(100)], [dx(300), lat - dy(100)], [dx(300), lat + dy(100)], [dx(-50), lat + dy(100)]];
    expect(streetSetting({ highway: 'tertiary' }, line, [], [town])).toBe('suburban');
    expect(streetSetting({ highway: 'residential' }, line, [])).toBe('suburban');
    // Near a village centre point: built-up; 3 km out in the fields: rural.
    expect(streetSetting({ highway: 'tertiary' }, line, [], [], [{ at: [dx(100), lat + dy(400)], radius: 1000 }])).toBe('suburban');
    expect(streetSetting({ highway: 'tertiary' }, line, [], [], [{ at: [dx(100), lat + dy(3000)], radius: 1000 }])).toBe('rural');
  });
});
