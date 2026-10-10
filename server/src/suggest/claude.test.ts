import type Anthropic from '@anthropic-ai/sdk';
import { unproject } from '@mamdani/shared';
import { describe, expect, it, vi } from 'vitest';
import type { TileData } from '../data/tiles';
import { localTile } from '../scene/local';
import { createClaudeSuggester, describeArea } from './claude';

const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
const rect = (x0: number, n0: number, x1: number, n1: number): [number, number][] => [ll(x0, n0), ll(x1, n0), ll(x1, n1), ll(x0, n1)];
const tile: TileData = {
  id: 'r97c97',
  bbox: [...ll(-200, -200), ...ll(200, 200)] as [number, number, number, number],
  streets: [{ id: 's1', name: 'Test St', line: [ll(-150, 0), ll(150, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false }],
  buildings: [
    { id: 'b1', ring: rect(-40, 20, -10, 40), heightM: 8 },
    { id: 'b2', ring: rect(10, 20, 40, 40), heightM: 90 },
  ],
  parks: [],
};

function fakeClient(response: Record<string, unknown>) {
  const parse = vi.fn(async () => response);
  return { client: { beta: { messages: { parse } } } as unknown as Anthropic, parse };
}

describe('describeArea', () => {
  it('lists issues, streets, and only low buildings as candidate sites', () => {
    const text = describeArea(tile, localTile(tile), [{ category: 'traffic_safety', count: 40 }]);
    expect(text).toContain('traffic_safety: 40');
    expect(text).toContain('"id":"s1"');
    expect(text).toContain('"id":"b1"');
    expect(text).not.toContain('"id":"b2"'); // 90 m tower is not a redevelopment site
  });
});

describe('createClaudeSuggester', () => {
  it('converts model output into validated, priced change ops', async () => {
    const { client, parse } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: {
        suggestions: [
          {
            title: 'Safer Test St',
            rationale: 'Crashes and near-misses; costs some parking.',
            addresses: ['traffic_safety'],
            ops: [
              { type: 'add_bike_lane', streetId: 's1', side: 'right', protected: true },
              { type: 'add_crosswalk', streetId: 's1', raised: true },
              { type: 'plant_street_trees', streetId: 's1', count: 500 }, // clamped to street length
              { type: 'add_bus_lane', streetId: 'made-up', side: 'left' }, // unknown id → dropped
            ],
          },
          {
            title: 'Pocket park',
            rationale: 'Green space.',
            addresses: ['trees_parks'],
            ops: [{ type: 'building_to_park', buildingId: 'b1', name: 'Test Green' }],
          },
          { title: 'Nothing valid', rationale: '', addresses: [], ops: [{ type: 'replace_building', buildingId: 'nope', floors: 5, use: 'school', units: 0 }] },
        ],
      },
    });
    const out = await createClaudeSuggester('test-key', client).suggest(tile, [{ category: 'traffic_safety', count: 40 }]);

    const req = (parse.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.fallbacks).toBe('default');

    expect(out.map((s) => s.title)).toEqual(['Safer Test St', 'Pocket park']);
    const [safer, park] = out;
    expect(safer.ops.map((o) => o.type)).toEqual(['add_bike_lane', 'add_crosswalk', 'plant_trees']);
    const trees = safer.ops[2] as { count: number };
    expect(trees.count).toBeLessThanOrEqual(Math.floor(300 / 8));
    expect(safer.cost.total).toBeGreaterThan(0);
    expect(park.ops[0].type).toBe('add_park');
  });

  it('surfaces refusals instead of returning nothing', async () => {
    const { client } = fakeClient({ stop_reason: 'refusal', stop_details: { category: 'general_harms' }, parsed_output: null });
    await expect(createClaudeSuggester('k', client).suggest(tile, [])).rejects.toThrow(/declined/);
  });
});
