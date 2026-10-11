import * as z from 'zod/v4';
import { ISSUE_CATEGORIES } from '@mamdani/shared';
import { localTile } from '../scene/local';
import { describeArea, LlmOp, SuggestionsSchema, SYSTEM, toSuggestions } from './claude';
import type { Suggester } from './suggest';

/** Where a Gemini request goes: Vertex AI (billed to the Cloud project) or the Gemini API key. */
export type GeminiEndpoint = () => Promise<{ url: string; headers: Record<string, string> }>;

export const geminiApiEndpoint = (apiKey: string, model: string): GeminiEndpoint => async () => ({
  url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  headers: { 'x-goog-api-key': apiKey },
});

/**
 * "Get AI ideas" with Gemini, for when there's no Anthropic key. Same prompt, area summary and
 * checks as the Claude version; Gemini returns JSON in the same shape.
 */
export function createGeminiSuggester(endpoint: GeminiEndpoint, fetchFn: typeof fetch = fetch): Suggester {
  return {
    async suggest(tile, issues) {
      const lt = localTile(tile);
      const { url, headers } = await endpoint();
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: describeArea(tile, lt, issues) }] }],
          generationConfig: { responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(SuggestionsSchema) },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      };
      if (!res.ok) throw new Error(`Gemini: ${json.error?.message ?? res.status}`);
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const parsed = lenient(JSON.parse(text || 'null'));
      if (!parsed) throw new Error(`no usable suggestions from Gemini (${json.candidates?.[0]?.finishReason ?? 'empty answer'})`);
      return toSuggestions(parsed, tile, lt);
    },
  };
}

/** Gemini on Vertex doesn't always keep to the exact change names: map the ones it uses instead. */
const ALIASES: Record<string, string> = {
  bike_lane: 'add_bike_lane',
  bus_lane: 'add_bus_lane',
  sidewalk: 'widen_sidewalk',
  widen_sidewalks: 'widen_sidewalk',
  parking_removal: 'remove_parking',
  plant_trees: 'plant_street_trees',
  street_trees: 'plant_street_trees',
  crosswalk: 'add_crosswalk',
  rebuild: 'replace_building',
  park: 'building_to_park',
  add_park: 'building_to_park',
};

/** Keep every suggestion and change that makes sense; drop single changes that don't. */
function lenient(raw: unknown): z.infer<typeof SuggestionsSchema> | null {
  const list = (raw as { suggestions?: unknown[] } | null)?.suggestions;
  if (!Array.isArray(list)) return null;
  const suggestions = list.flatMap((item) => {
    const s = item as { ops?: { type?: string }[] };
    const ops = (Array.isArray(s.ops) ? s.ops : [])
      .map((o) => LlmOp.safeParse({ ...o, type: ALIASES[o?.type ?? ''] ?? o?.type }))
      .flatMap((r) => (r.success ? [r.data] : []));
    const addresses = ((s as { addresses?: unknown }).addresses as string[] | undefined ?? []).filter((c) => (ISSUE_CATEGORIES as readonly string[]).includes(c));
    const one = SuggestionsSchema.shape.suggestions.element.safeParse({ ...s, addresses, ops });
    return one.success && ops.length ? [one.data] : [];
  });
  return suggestions.length ? { suggestions } : null;
}
