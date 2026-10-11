import { unproject } from '@mamdani/shared';
import { describe, expect, it } from 'vitest';
import type { TileData } from '../data/tiles';
import { createGeminiSuggester, geminiApiEndpoint } from './gemini';

const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
const tile: TileData = {
  id: 'r97c97',
  bbox: [...ll(-200, -200), ...ll(200, 200)] as [number, number, number, number],
  streets: [{ id: 's1', name: 'Test St', line: [ll(-150, 0), ll(150, 0)], widthM: 12, travelLanes: 2, parkingLanes: 2, hasBikeLane: false }],
  buildings: [],
  parks: [],
};

describe('Gemini suggestions', () => {
  it('accepts the change names Gemini uses instead of the exact ones, and drops what it made up', async () => {
    // What Gemini on Vertex actually answered: "bike_lane", "crosswalk", "plant_trees", an unknown tag.
    const answer = {
      suggestions: [
        {
          title: 'Protected bike lanes on Test St',
          rationale: 'Parking complaints suggest double-parking; a protected lane calms traffic. Trade-off: some parking is lost.',
          addresses: ['parking', 'not_a_category'],
          ops: [
            { type: 'bike_lane', streetId: 's1', side: 'both', protected: true },
            { type: 'crosswalk', streetId: 's1', raised: true },
            { type: 'plant_trees', streetId: 's1', count: 10 },
            { type: 'teleporter', streetId: 's1' },
          ],
        },
      ],
    };
    let sent: { url: string; body: { generationConfig: { responseMimeType: string } } } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      sent = { url, body: JSON.parse(String(init!.body)) };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }));
    }) as typeof fetch;
    const out = await createGeminiSuggester(geminiApiEndpoint('k', 'gemini-test'), fake).suggest(tile, [{ category: 'parking', count: 10 }]);
    expect(sent!.url).toContain('/models/gemini-test:generateContent');
    expect(sent!.body.generationConfig.responseMimeType).toBe('application/json');
    expect(out).toHaveLength(1);
    expect(out[0].addresses).toEqual(['parking']);
    expect(out[0].ops.map((o) => o.type)).toEqual(['add_bike_lane', 'add_crosswalk', 'plant_trees']);
    expect(out[0].cost.total).toBeGreaterThan(0);
  });

  it('says why when Google refuses', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { message: 'Your prepayment credits are depleted.' } }), { status: 429 })) as typeof fetch;
    await expect(createGeminiSuggester(geminiApiEndpoint('k', 'm'), fake).suggest(tile, [])).rejects.toThrow(/credits are depleted/);
  });
});
