import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
// The SDK's structured-output helper takes zod v4 schemas; the rest of the app uses v3.
import * as z from 'zod/v4';
import { ChangeOp, ISSUE_CATEGORIES, unproject, type AreaIssue, type Suggestion } from '@mamdani/shared';
import { estimate } from '../cost/estimate';
import type { TileData } from '../data/tiles';
import { offsetLine, type V2 } from '../scene/geometry';
import { localTile, type LocalTile } from '../scene/local';
import { validateOpsForTile } from '../scene/validate';
import type { Suggester } from './suggest';

const MODEL = 'claude-opus-5-5';

// The model only references ids from the scene summary; the server turns those into geometry.
// That keeps suggestions inside the area and on real streets/buildings.
const Side = z.enum(['left', 'right', 'both']);
export const LlmOp = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_bike_lane'), streetId: z.string(), side: Side, protected: z.boolean() }),
  z.object({ type: z.literal('add_bus_lane'), streetId: z.string(), side: Side }),
  z.object({ type: z.literal('widen_sidewalk'), streetId: z.string(), meters: z.number() }),
  z.object({ type: z.literal('remove_parking'), streetId: z.string(), side: Side }),
  z.object({ type: z.literal('plant_street_trees'), streetId: z.string(), count: z.number().int() }),
  z.object({ type: z.literal('add_crosswalk'), streetId: z.string(), raised: z.boolean() }),
  z.object({
    type: z.literal('replace_building'),
    buildingId: z.string(),
    floors: z.number().int(),
    use: z.enum(['affordable_housing', 'mixed_use', 'community_center', 'school', 'clinic']),
    units: z.number().int(),
  }),
  z.object({ type: z.literal('building_to_park'), buildingId: z.string(), name: z.string() }),
]);
type LlmOp = z.infer<typeof LlmOp>;

export const SuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      title: z.string(),
      rationale: z.string(),
      addresses: z.array(z.enum(ISSUE_CATEGORIES)),
      ops: z.array(LlmOp),
    }),
  ),
});

export const SYSTEM = `You help residents brainstorm physical changes to one small (about 200 m square) area of their city. The area may be anywhere in the world. For New York City you also get recent 311 complaint counts; elsewhere there may be none, so work from the street layout itself (missing bike lanes, wide roads, few trees, low lots).

Your output is a set of candidate ideas. A person will review, edit or discard every one; nothing you suggest is submitted automatically. So favour clear, concrete, realistic ideas over bold ones, and say plainly what each idea trades off.

Rules:
- Propose 1 to 3 suggestions, each with 1 to 5 changes.
- Only reference street ids and building ids that appear in the area summary. Never invent ids.
- Tie every suggestion to the complaint categories it addresses (an empty list is fine when there is no complaint data), and explain the reasoning in the rationale (2-4 sentences, plain language, mention the main trade-off such as lost parking or displaced uses).
- Keep changes proportionate to common big-city practice: widen sidewalks by 1-4 m, 3-20 street trees per block, rebuilt lots of 4-30 floors. Only rebuild low, small buildings listed as candidate sites, and prefer affordable housing or community uses.
- Do not propose changes to address complaint categories that physical design cannot help with; it is fine to leave those out.
- Do not estimate costs; the app prices every change itself.`;

export function createClaudeSuggester(apiKey: string, client = new Anthropic({ apiKey })): Suggester {
  return {
    async suggest(tile, issues) {
      const lt = localTile(tile);
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        // Planning-style reasoning over a small summary: medium is the model's default; set it explicitly.
        output_config: { effort: 'medium', format: betaZodOutputFormat(SuggestionsSchema) },
        // If a safety classifier declines, retry on the appropriate fallback model server-side.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: describeArea(tile, lt, issues) }],
      });

      if (response.stop_reason === 'refusal') {
        throw new Error(`suggestion request was declined${response.stop_details?.category ? ` (${response.stop_details.category})` : ''}`);
      }
      const parsed = response.parsed_output;
      if (!parsed) throw new Error(`no structured suggestions returned (stop_reason=${response.stop_reason})`);

      return toSuggestions(parsed, tile, lt);
    },
  };
}

/** The model's ideas as real, priced suggestions (Claude and Gemini share this). */
export function toSuggestions(parsed: z.infer<typeof SuggestionsSchema>, tile: TileData, lt: LocalTile): Suggestion[] {
  const out: Suggestion[] = [];
  for (const s of parsed.suggestions.slice(0, 3)) {
    const ops = s.ops.map((o) => toChangeOp(o, tile, lt)).filter((o): o is ChangeOp => o !== null);
    // Drop anything that doesn't fit the tile rather than showing a broken idea.
    const valid = ops.filter((o) => validateOpsForTile([o], tile).length === 0);
    if (valid.length === 0) continue;
    out.push({ title: s.title.slice(0, 120), rationale: s.rationale, addresses: s.addresses, ops: valid, cost: estimate(valid, lt) });
  }
  return out;
}

/** Compact text summary of the area the model reasons over. */
export function describeArea(tile: TileData, lt: LocalTile, issues: AreaIssue[]): string {
  const streets = lt.streets.map((s) => ({
    id: s.id,
    name: s.name,
    lengthM: Math.round(s.lengthM),
    widthM: Math.round(s.widthM),
    travelLanes: s.travelLanes,
    parkingLanes: s.parkingLanes,
    hasBikeLane: s.hasBikeLane,
  }));
  // Candidate redevelopment sites: the lowest buildings with a usable footprint.
  const sites = lt.buildings
    .filter((b) => b.heightM < 12 && b.areaM2 > 150)
    .sort((a, b) => a.heightM - b.heightM || b.areaM2 - a.areaM2)
    .slice(0, 25)
    .map((b) => ({ id: b.id, heightM: Math.round(b.heightM), footprintM2: Math.round(b.areaM2) }));
  const heights = lt.buildings.map((b) => b.heightM).sort((a, b) => a - b);
  const median = heights.length ? Math.round(heights[Math.floor(heights.length / 2)]) : 0;

  return [
    `Area ${tile.id}${'name' in tile ? ` (${String(tile.name)})` : ''}: about ${Math.round(lt.half[0] * 2)} x ${Math.round(lt.half[1] * 2)} m, ${lt.buildings.length} buildings (median height ${median} m), ${lt.parks.length} park parcel(s).`,
    '',
    'Complaints in the last 90 days (New York City 311), by category:',
    ...(issues.length ? issues.map((i) => `- ${i.category}: ${i.count}`) : ['- none recorded (or no complaint data for this city)']),
    '',
    'Streets (id, name, length, curb-to-curb width, lanes, existing bike lane):',
    JSON.stringify(streets),
    '',
    'Candidate redevelopment sites (low buildings):',
    JSON.stringify(sites),
  ].join('\n');
}

/** Turn a model-facing op into a real ChangeOp, clamping values to sensible ranges. */
export function toChangeOp(o: LlmOp, tile: TileData, lt: LocalTile): ChangeOp | null {
  const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
  const street = 'streetId' in o ? lt.streets.find((s) => s.id === o.streetId) : undefined;
  const toLngLat = (p: V2) => unproject(lt.origin, p);

  let op: unknown;
  switch (o.type) {
    case 'add_bike_lane':
      op = { type: o.type, streetSegmentId: o.streetId, side: o.side, protected: o.protected };
      break;
    case 'add_bus_lane':
      op = { type: o.type, streetSegmentId: o.streetId, side: o.side };
      break;
    case 'widen_sidewalk':
      op = { type: o.type, streetSegmentId: o.streetId, meters: clamp(o.meters, 0.5, 6) };
      break;
    case 'remove_parking':
      op = { type: o.type, streetSegmentId: o.streetId, side: o.side };
      break;
    case 'plant_street_trees': {
      if (!street) return null;
      // Along the right-hand sidewalk, ~8 m apart at most.
      const line = offsetLine(street.line, -(street.widthM / 2 + 1.5));
      const count = clamp(Math.round(o.count), 1, Math.max(1, Math.floor(street.lengthM / 8)));
      op = { type: 'plant_trees', count, line: line.map(toLngLat) };
      break;
    }
    case 'add_crosswalk': {
      if (!street || street.lengthM < 16) return null;
      // Just inside the street from its first intersection, not in the middle of the box.
      const [a, b] = street.line;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const d = Math.min(6, len / 2);
      op = { type: o.type, at: toLngLat([a[0] + ((b[0] - a[0]) / len) * d, a[1] + ((b[1] - a[1]) / len) * d]), raised: o.raised };
      break;
    }
    case 'replace_building':
      op = { type: o.type, buildingId: o.buildingId, floors: clamp(o.floors, 1, 80), use: o.use, units: clamp(o.units, 0, 2000) };
      break;
    case 'building_to_park': {
      const b = tile.buildings.find((x) => x.id === o.buildingId);
      if (!b) return null;
      op = { type: 'add_park', polygon: b.ring.slice(0, 200), name: o.name.slice(0, 80) };
      break;
    }
  }
  const r = ChangeOp.safeParse(op);
  return r.success ? r.data : null;
}
