import { describe, expect, it } from 'vitest';
import { opVerdict, streetVerdict, typeVerdict, maxSidewalkWidening, type SceneFacts, type StreetFacts } from './availability';
import { unproject } from './geo';

const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
const avenue: StreetFacts = { id: 'av', lengthM: 200, widthM: 18, travelLanes: 4, parkingLanes: 2, hasBikeLane: false, setting: 'urban', line: [ll(-100, 0), ll(100, 0)] };
const lane: StreetFacts = { id: 'ln', lengthM: 120, widthM: 6, travelLanes: 2, parkingLanes: 0, hasBikeLane: true, setting: 'urban', line: [ll(0, -60), ll(0, 60)] };
const scene: SceneFacts = {
  origin,
  streets: [avenue, lane],
  buildings: [{ id: 'tower', heightM: 90, footprintM2: 900 }, { id: 'shed', heightM: 3, footprintM2: 40 }],
  parks: [{ id: 'p', name: 'Little Park', ring: [ll(20, 20), ll(60, 20), ll(60, 60), ll(20, 60)] }],
};

describe('which changes make sense where', () => {
  it('turns down what a street already has or has no room for', () => {
    expect(streetVerdict('add_bike_lane', lane)).toEqual({ ok: false, reason: 'This street already has a bike lane.' });
    expect(streetVerdict('remove_parking', lane).ok).toBe(false);
    expect(streetVerdict('widen_sidewalk', lane).ok).toBe(false); // 6 m road, two 3 m lanes
    expect(streetVerdict('add_bus_lane', lane).ok).toBe(false);
    for (const t of ['add_bike_lane', 'add_bus_lane', 'remove_parking', 'widen_sidewalk'] as const) expect(streetVerdict(t, avenue).ok).toBe(true);
    expect(maxSidewalkWidening(avenue)).toBe(6);
  });

  it('keeps bus lanes off country roads and lanes off intersection corners', () => {
    expect(streetVerdict('add_bus_lane', { ...avenue, setting: 'rural' }).ok).toBe(false);
    expect(streetVerdict('add_bike_lane', { ...avenue, lengthM: 8 }).ok).toBe(false);
  });

  it('never blocks on facts older zone data lacks', () => {
    expect(streetVerdict('add_bike_lane', { id: 'old', lengthM: 100, widthM: 8 }).ok).toBe(true);
  });

  it('greys out a change type with nowhere to go', () => {
    expect(typeVerdict('replace_building', scene).ok).toBe(false); // a high-rise and a shed
    expect(typeVerdict('add_bike_lane', scene).ok).toBe(true);
  });

  it('turns down parks on parks or streets, repeats, and too-wide sidewalks', () => {
    expect(opVerdict({ type: 'add_park', polygon: [ll(30, 30), ll(50, 30), ll(50, 50), ll(30, 50)] }, scene)).toEqual({ ok: false, reason: 'That’s already a park (Little Park).' });
    expect(opVerdict({ type: 'add_park', polygon: [ll(-40, -2), ll(-20, -2), ll(-20, 2), ll(-40, 2)] }, scene).ok).toBe(false);
    const bike = { type: 'add_bus_lane' as const, streetSegmentId: 'av', side: 'both' as const };
    expect(opVerdict(bike, scene, [bike]).ok).toBe(false);
    expect(opVerdict({ type: 'widen_sidewalk', streetSegmentId: 'av', meters: 6 }, scene).ok).toBe(true);
    const x = { type: 'add_crosswalk' as const, at: ll(-50, 0), raised: false };
    expect(opVerdict({ ...x, at: ll(-45, 0) }, scene, [x]).ok).toBe(false);
  });
});
