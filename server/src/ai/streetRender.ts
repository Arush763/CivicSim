/**
 * Photo-real "after" views. Takes the exact Street View image a person is looking at, plus a
 * placement guide (the request's 3D model rendered from the same camera), and asks Gemini's
 * image model to redraw the photo with the change physically built.
 *
 * Note: editing Street View imagery goes against the Google Maps Platform terms (3.2.3(c), "No
 * Creating Content From Google Maps Content"). The project owner chose this knowingly.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChangeOpType } from '@mamdani/shared';
import { config } from '../config';

export const ASPECTS = { '21:9': 21 / 9, '16:9': 16 / 9, '3:2': 3 / 2, '4:3': 4 / 3, '5:4': 5 / 4, '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '2:3': 2 / 3, '9:16': 9 / 16 } as const;
export type Aspect = keyof typeof ASPECTS;

export interface RenderRequest {
  pano: string;
  heading: number;
  pitch: number;
  /** Horizontal field of view in degrees (Street View Static allows up to 120). */
  fov: number;
  aspect: Aspect;
  /** PNG, base64: the 3D model from the same camera, on black. */
  guide: string;
  ops: ChangeOpType[];
  /** Plain-language summary of the request, e.g. "Protected bike lane on Whitehall (both sides)". */
  desc: string;
  /** Identifies the request's model, so a different request never reuses this render. */
  model: string;
}

/** What each kind of change means physically, so the model builds it rather than paints it. */
const BUILD: Record<ChangeOpType, string> = {
  add_bike_lane:
    'Build a real, finished protected bike lane where the guide shows green: a separate lane with a smooth green surface and bicycle symbols, physically divided from car traffic by a raised concrete kerb island with low planters and white flexible posts (if the request says painted rather than protected, use a painted buffer with posts instead of the kerb). Remove any parked cars or vehicles standing in the new lane.',
  add_bus_lane:
    'Convert the lane the guide shows in red into a finished bus-only lane: red-surfaced asphalt with "BUS ONLY" markings and solid white lines. Remove parked cars from it.',
  widen_sidewalk:
    'Physically extend the sidewalk into the roadway as the guide shows: new concrete paving and a new kerb further out, so the road is visibly narrower. Remove parked cars where the new sidewalk is.',
  remove_parking: 'Remove the parked cars and the parking lane on the side shown; leave clear, clean kerbside.',
  plant_trees: 'Plant mature, healthy street trees in proper tree pits exactly where the guide shows trees.',
  add_park:
    'Turn the area the guide marks into a finished public park: lawn, mature trees, paths, benches and planting. Whatever stood there before (paving, cars) is gone.',
  add_crosswalk: 'Add a fresh high-visibility zebra crosswalk across the street where the guide shows white bars (raised to sidewalk height if the request says raised).',
  replace_building:
    'Replace the existing building the guide marks with a newly built one of the shape and height shown: a realistic contemporary facade (brick, stone or glass that suits the street), real windows and a ground-floor shopfront and entrance. The old building is gone.',
};

export function buildPrompt(ops: ChangeOpType[], desc: string): string {
  const kinds = [...new Set(ops)];
  return [
    'Image 1 is a real street-level photograph. Image 2 is a rough 3D placement guide rendered from exactly the same camera, on black: its shapes show where new things go and how big they are.',
    'Edit image 1 so it looks like a real photograph taken from the same spot after this construction was finished:',
    ...kinds.map((k) => `- ${BUILD[k]}`),
    `The request, in words: ${desc.slice(0, 600)}`,
    'Keep the camera position, framing, perspective, lighting, weather and sky exactly the same, and keep every building, person and object that is not part of the change unchanged.',
    'Use the guide only for placement and size. Do not copy its flat colours or computer look, and do not add any text, labels or outlines. The result must be indistinguishable from a real photo.',
  ].join('\n');
}

const aiDir = () => path.join(config.cacheDir, 'ai');
export const aiUrl = (file: string) => `/ai/${file}`;

export function renderKey(r: RenderRequest, model: string): string {
  const round = (v: number) => Math.round(v);
  return createHash('sha1')
    .update(JSON.stringify([model, r.model, r.pano, round(r.heading), round(r.pitch), round(r.fov), r.aspect, r.desc]))
    .digest('hex')
    .slice(0, 20);
}

/** Street View Static image size for an aspect ratio (max 640 px per side). */
export function staticSize(aspect: Aspect): [number, number] {
  const a = ASPECTS[aspect];
  return a >= 1 ? [640, Math.round(640 / a)] : [Math.round(640 * a), 640];
}

/** Find the last image block anywhere in a Gemini response (the format nests it in steps/outputs). */
export function findImage(json: unknown): { data: string; mime: string } | null {
  let found: { data: string; mime: string } | null = null;
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    const inline = (o.inline_data ?? o.inlineData) as Record<string, unknown> | undefined;
    if (inline && typeof inline.data === 'string') found = { data: inline.data, mime: String(inline.mime_type ?? inline.mimeType ?? 'image/png') };
    else if (o.type === 'image' && typeof o.data === 'string') found = { data: o.data, mime: String(o.mime_type ?? 'image/png') };
    for (const x of Object.values(o)) walk(x);
  };
  walk(json);
  return found;
}

export class AiRenderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const inflight = new Map<string, Promise<string>>();
const recent: number[] = [];
const PER_MINUTE = 20; // a guard against runaway cost while panning around
const daily = { day: '', count: 0 }; // renders that reached Gemini today (cached views don't count)

export function aiRenderEnabled() {
  return !!(config.geminiKey && config.googleMapsServerKey);
}

export async function renderStreetView(r: RenderRequest, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!config.geminiKey) throw new AiRenderError(503, 'Photo-real renders are not set up: add GEMINI_API_KEY to server/.env.');
  if (!config.googleMapsServerKey) throw new AiRenderError(503, 'Photo-real renders are not set up: add GOOGLE_MAPS_SERVER_KEY to server/.env.');
  const key = renderKey(r, config.geminiImageModel);
  const file = `${key}.jpg`;
  if (existsSync(path.join(aiDir(), file))) return aiUrl(file);
  const running = inflight.get(key);
  if (running) return running;

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= PER_MINUTE) throw new AiRenderError(429, 'Too many photo-real renders in the last minute. Wait a moment.');
  const today = new Date(now).toISOString().slice(0, 10);
  if (daily.day !== today) Object.assign(daily, { day: today, count: 0 });
  if (daily.count >= config.aiDailyLimit) {
    throw new AiRenderError(429, `Today's limit of ${config.aiDailyLimit} photo-real renders is used up (AI_DAILY_LIMIT in server/.env). Views already rendered still work.`);
  }
  recent.push(now);
  daily.count++;

  const job = (async () => {
    const [w, h] = staticSize(r.aspect);
    const qs = new URLSearchParams({
      size: `${w}x${h}`,
      pano: r.pano,
      heading: r.heading.toFixed(1),
      pitch: Math.max(-90, Math.min(90, r.pitch)).toFixed(1),
      fov: Math.max(10, Math.min(120, r.fov)).toFixed(1),
      return_error_code: 'true',
      key: config.googleMapsServerKey,
    });
    const photoRes = await fetchFn(`https://maps.googleapis.com/maps/api/streetview?${qs}`);
    if (!photoRes.ok) {
      const body = (await photoRes.text()).slice(0, 200);
      throw new AiRenderError(502, `Street View image request failed (${photoRes.status}). Is the Street View Static API enabled for GOOGLE_MAPS_SERVER_KEY? ${body}`);
    }
    const photo = Buffer.from(await photoRes.arrayBuffer()).toString('base64');

    const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        model: config.geminiImageModel,
        input: [
          { type: 'text', text: buildPrompt(r.ops, r.desc) },
          { type: 'image', mime_type: 'image/jpeg', data: photo },
          { type: 'image', mime_type: 'image/png', data: r.guide },
        ],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: r.aspect, image_size: '1K' },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new AiRenderError(502, `Gemini: ${json.error?.message ?? res.status}`);
    const img = findImage(json);
    if (!img) throw new AiRenderError(502, 'Gemini returned no image (it may have declined this one). Try another view.');

    mkdirSync(aiDir(), { recursive: true });
    const out = path.join(aiDir(), file);
    writeFileSync(`${out}.tmp`, Buffer.from(img.data, 'base64'));
    renameSync(`${out}.tmp`, out);
    return aiUrl(file);
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
