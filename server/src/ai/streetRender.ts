/**
 * Photo-real "after" views. Takes the exact Street View image a person is looking at, plus a
 * placement guide (the request's 3D model rendered from the same camera), and asks Gemini's
 * image model to redraw the photo with the change physically built.
 *
 * Note: editing Street View imagery goes against the Google Maps Platform terms (3.2.3(c), "No
 * Creating Content From Google Maps Content"). The project owner chose this knowingly.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { ChangeOpType } from '@mamdani/shared';
import { config } from '../config';
import { maskEdit } from './changeMask';
import { loadServiceAccount, vertexGenerate, type VertexAuth } from './vertex';
import type { Db } from '../db';

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
  /** What kind of place this is; changes are built the way they would be there. */
  setting?: Setting;
  /**
   * An already-edited neighbouring direction from the same spot (an /ai/… URL), so the new
   * construction looks the same in every direction you turn to.
   */
  reference?: string;
}

export type Setting = 'urban' | 'suburban' | 'rural';

const PLACE: Record<Setting, string> = {
  urban: 'From the map, this is a dense city street.',
  suburban: 'From the map, this is a suburban or small-town street.',
  rural: 'From the map, this is a rural road outside town.',
};

/** What each kind of change means physically, so the model builds it rather than paints it. */
const BIKE_LANE: Record<Setting, string> = {
  urban:
    'Build a real, finished bike lane where the guide shows it: a smooth lane with bicycle symbols, separated from traffic as the guide shows (if protected: a raised concrete kerb or a buffer with flexible posts; if painted: a painted buffer). Keep parked cars where they are unless the guide puts the lane under them.',
  suburban:
    'Build a real bike lane where the guide shows it, as a suburban street would have it: a painted lane with a buffer stripe and bicycle symbols, and only occasional posts if protected. No planters or heavy kerbs.',
  rural:
    'Build a separate asphalt cycle path beside the road where the guide shows it, set behind a grass verge, as country roads have: plain dark asphalt, no green paint, no posts, cones or planters, and blend its edges naturally into the surrounding grass and verge.',
};

const BUILD: Record<ChangeOpType, string> = {
  add_bike_lane: BIKE_LANE.urban,
  add_bus_lane:
    'Convert the lane the guide shows in red into a finished bus-only lane: red-surfaced asphalt with "BUS ONLY" markings and solid white lines. Remove parked cars from it.',
  widen_sidewalk:
    'Physically extend the sidewalk into the roadway as the guide shows: new concrete paving and a new kerb further out, so the road is visibly narrower. Remove parked cars where the new sidewalk is.',
  remove_parking: 'Remove the parked cars and the parking lane on the side shown; leave clear, clean kerbside.',
  plant_trees: 'Plant mature, healthy street trees in proper tree pits exactly where the guide shows trees. The guide\'s trees are crude stand-ins: draw real trees of a species that suits this street, with natural bark, branches and foliage lit like the rest of the photo, never the guide\'s leaf pattern. Overhead wires and poles stay in front of or through the canopy as they really would.',
  add_park:
    'Turn the area the guide marks into a finished public park: lawn, mature trees, paths, benches and planting. Whatever stood there before (paving, cars) is gone.',
  add_crosswalk: 'Add a fresh high-visibility zebra crosswalk across the street where the guide shows white bars (raised to sidewalk height if the request says raised).',
  replace_building:
    'Replace the existing building the guide marks with a newly built one of the shape and height shown: a realistic contemporary facade (brick, stone or glass that suits the street), real windows and a ground-floor shopfront and entrance. The old building is gone.',
};

/**
 * "Plant 10 trees" → "Plant trees": each direction only shows some of them, and the guide already
 * shows exactly how many go where. A total that doesn't match the view could make Gemini cram in extras.
 */
export const withoutCounts = (desc: string) => desc.replace(/\b(plant|add)\s+\d+\s+/gi, '$1 ');

export function buildPrompt(ops: ChangeOpType[], desc: string, setting: Setting = 'urban', withReference = false): string {
  const kinds = [...new Set(ops)];
  const build = (k: ChangeOpType) => (k === 'add_bike_lane' ? BIKE_LANE[setting] : BUILD[k]);
  return [
    'Image 1 is a real street-level photograph. Image 2 is a rough 3D placement guide rendered from exactly the same camera, on black: its shapes show where new things go and how big they are.',
    `${PLACE[setting]} If the photo clearly shows a different kind of place, trust the photo. Build everything the way it would really be built in this kind of place and in this country (local materials, markings and conventions), so it looks like it has always belonged there.`,
    'Edit image 1 so it looks like a real photograph taken from the same spot after this construction was finished. Build only what the guide shows, exactly where it shows it; add nothing else:',
    ...kinds.map((k) => `- ${build(k)}`),
    `The request, in words: ${withoutCounts(desc).slice(0, 600)}`,
    'Place things the way a city engineer would, and only where the guide shows them: nothing new goes in the middle of an intersection or in a traffic lane unless it is that lane or its markings. Lanes and markings stop at the edge of an intersection. Crosswalks span one street just outside the intersection, lined up with the corners. Trees, planters and furniture stand on the sidewalk or in the park, clear of corners, crosswalks, driveways, doorways, hydrants and bus stops. Never block an existing entrance, driveway or crossing.',
    'Do not add street lamps, poles, signs, benches, bollards, cars or people that the guide does not show.',
    'Keep the camera position, framing, perspective, lighting, weather and sky exactly the same, and keep every building, person and object that is not part of the change unchanged.',
    'Use the guide only for placement and size. Do not copy its flat colours or computer look, and do not add any text, labels or outlines. The result must be indistinguishable from a real photo.',
    ...(withReference
      ? ['Image 3 is the same place, already edited, looking in a neighbouring direction. Where the same new construction appears, make it look identical: same materials, colours, markings and style.']
      : []),
  ].join('\n');
}

const aiDir = () => path.join(config.cacheDir, 'ai');
/**
 * An edit that changed less than this share of where the guide planned the change was built
 * somewhere else (measured on street trees: well-placed edits 0.45–0.93, misplaced ones 0.21–0.33).
 */
const MIN_ON_PLAN = 0.4;
/**
 * What each edit was made from (the Street View photo, the placement guide and Gemini's raw
 * answer), kept out of the served folder so the cut-out (changeMask.ts) can be tuned without
 * paying for new edits.
 */
const keepRaw = (file: string, photo: Buffer, guide: string, edited: string) => {
  try {
    const dir = path.join(config.cacheDir, 'ai-raw', file.replace(/\.png$/, ''));
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'photo.jpg'), photo);
    writeFileSync(path.join(dir, 'guide.png'), Buffer.from(guide, 'base64'));
    writeFileSync(path.join(dir, 'edit.img'), Buffer.from(edited, 'base64'));
  } catch (e) {
    console.warn(`keeping the raw edit failed: ${(e as Error).message}`);
  }
};
export const aiUrl = (file: string) => `/ai/${file}`;

export function renderKey(r: RenderRequest, model: string): string {
  const round = (v: number) => Math.round(v);
  return createHash('sha1')
    // The model is identified by its path, so the browser (localhost) and phones (LAN address) share saved views.
    .update(JSON.stringify([config.aiFake ? 'fake' : model, r.model.replace(/^https?:\/\/[^/]+/, ''), r.setting ?? 'urban', r.reference ?? '', r.pano, round(r.heading), round(r.pitch), round(r.fov), r.aspect, r.desc]))
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
/**
 * Gemini on Vertex uses a shared pool of capacity per model ("dynamic shared quota"): a 429 means
 * that model's pool is briefly busy. So when the main model is busy, rotate through the fallback
 * models (cheapest first, then back up to the main one), this long between attempts. Busy replies
 * aren't billed. Tests set it to 0.
 */
export let fallbackGapMs = 100;
export const setFallbackGap = (ms: number) => (fallbackGapMs = ms);

/** Models that take an output size (2.5 Flash Image has a fixed size and rejects it). */
const takesSize = (model: string) => !model.startsWith('gemini-2.5');
const recent: number[] = [];
const PER_MINUTE = 20; // a guard against runaway cost while panning around

/** Where the daily count is kept (the server's SQLite), so restarting the server doesn't reset it. */
export type RenderUsage = Pick<Db, 'aiRendersOn' | 'addAiRender'>;

/** Which image editor renders go to: Vertex AI if its key file is present, else AI Studio, else the test stand-in. */
export function aiProvider(): 'vertex' | 'gemini' | 'fake' | null {
  if (config.aiFake) return 'fake';
  if (vertexAuth()) return 'vertex';
  return config.geminiKey ? 'gemini' : null;
}

export function aiRenderEnabled() {
  return !!(aiProvider() && config.googleMapsServerKey);
}

/** Vertex sign-in: the service-account key file if present, else a bound API key + project. */
export function vertexAuth(): VertexAuth | null {
  const sa = loadServiceAccount(config.vertexKeyFile);
  if (sa) return { sa };
  return config.vertexApiKey ? { apiKey: config.vertexApiKey, ...(config.vertexProject ? { project: config.vertexProject } : {}) } : null;
}

const editorModel = () => (aiProvider() === 'vertex' ? `vertex:${config.vertexImageModel}` : config.geminiImageModel);

/** AI_FAKE: the real photo with the guide pasted over it (no AI). Same size as the photo. */
export function fakeEdit(photoJpeg: Buffer, guidePng: Buffer): Buffer {
  const photo = jpeg.decode(photoJpeg, { useTArray: true });
  const guide = PNG.sync.read(guidePng);
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      const gx = Math.floor((x / photo.width) * guide.width);
      const gy = Math.floor((y / photo.height) * guide.height);
      const g = (gy * guide.width + gx) * 4;
      const [r, gg, b] = [guide.data[g], guide.data[g + 1], guide.data[g + 2]];
      if (r + gg + b < 24) continue; // black = nothing there
      const p = (y * photo.width + x) * 4;
      photo.data[p] = r;
      photo.data[p + 1] = gg;
      photo.data[p + 2] = b;
    }
  }
  return Buffer.from(jpeg.encode(photo, 90).data);
}

/**
 * `savedOnly`: only hand back views that are already made (or being made). Everyone except the
 * city admins at the server gets this, so nobody else can start a paid AI edit.
 */
export async function renderStreetView(r: RenderRequest, userId: string, usage: RenderUsage, fetchFn: typeof fetch = fetch, { savedOnly = false } = {}): Promise<string> {
  if (!aiProvider()) throw new AiRenderError(503, 'Photo-real renders are not set up: add server/vertex-key.json (Vertex AI) or GEMINI_API_KEY to server/.env.');
  if (!config.googleMapsServerKey) throw new AiRenderError(503, 'Photo-real renders are not set up: add GOOGLE_MAPS_SERVER_KEY to server/.env.');
  const key = renderKey(r, editorModel());
  // PNG with transparency wherever the edit left the photo unchanged (see changeMask.ts).
  const file = `${key}.png`;
  if (existsSync(path.join(aiDir(), file))) return aiUrl(file);
  const running = inflight.get(key);
  if (running) return running;
  if (savedOnly) throw new AiRenderError(404, 'This view has not been prepared yet.');

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  // The per-minute guard is for people panning around; preparing a whole zone is meant to be busy.
  const preparing = userId === 'system:prerender';
  if (!preparing && recent.length >= PER_MINUTE) throw new AiRenderError(429, 'Too many photo-real renders in the last minute. Wait a moment.');
  // Renders that reached Gemini today (cached views don't count).
  const today = new Date(now).toISOString().slice(0, 10);
  if (usage.aiRendersOn(today) >= config.aiDailyLimit) {
    throw new AiRenderError(429, `Today's limit of ${config.aiDailyLimit} photo-real renders is used up (AI_DAILY_LIMIT in server/.env). Views already rendered still work.`);
  }
  if (!preparing) recent.push(now);
  usage.addAiRender(today, userId);

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
    const photoBytes = Buffer.from(await photoRes.arrayBuffer());
    const photo = photoBytes.toString('base64');
    mkdirSync(aiDir(), { recursive: true });
    const out = path.join(aiDir(), file);

    if (config.aiFake) {
      writeFileSync(`${out}.tmp`, maskEdit(photoBytes, fakeEdit(photoBytes, Buffer.from(r.guide, 'base64')), Buffer.from(r.guide, 'base64')).png);
      renameSync(`${out}.tmp`, out);
      return aiUrl(file);
    }

    // A neighbouring view already edited at this spot, for a consistent look.
    const refFile = r.reference?.match(/^\/ai\/([0-9a-f]{20}\.jpg)$/)?.[1];
    const reference = refFile && existsSync(path.join(aiDir(), refFile)) ? readFileSync(path.join(aiDir(), refFile)).toString('base64') : null;

    const prompt = buildPrompt(r.ops, r.desc, r.setting, !!reference);
    const guide = Buffer.from(r.guide, 'base64');

    /** One edit from Gemini (base64 image). */
    const askGemini = async (): Promise<string> => {
      if (aiProvider() === 'vertex') {
        // New projects get a low per-minute allowance for image models: wait and retry when it's hit.
        const images = [{ mime: 'image/jpeg', data: photo }, { mime: 'image/png', data: r.guide }, ...(reference ? [{ mime: 'image/jpeg', data: reference }] : [])];
        const ask = (model: string) =>
          vertexGenerate(vertexAuth()!, { model, location: config.vertexLocation, prompt, aspect: r.aspect, size: takesSize(model) ? config.vertexImageSize : undefined, images }, fetchFn);
        // The main model first; if it's busy, the fallbacks cheapest-first, then the main one again,
        // round and round until one answers (or we've waited long enough).
        const generate = async (): Promise<Awaited<ReturnType<typeof vertexGenerate>> & { model: string }> => {
          const main = config.vertexImageModel;
          const loop = [...config.vertexFallbackModels.filter((m) => m !== main), main];
          const start = Date.now();
          let model = main;
          for (let i = 0; ; i++) {
            const res = await ask(model);
            if (res.status !== 429 || Date.now() - start > config.vertexBusyLimitMs) return { ...res, model };
            await new Promise((ok) => setTimeout(ok, fallbackGapMs));
            model = loop[i % loop.length];
          }
        };
        const v = await generate().catch((e: Error) => {
          throw new AiRenderError(502, e.message);
        });
        if (v.model !== config.vertexImageModel) console.info(`photo-real edit for ${r.pano}@${Math.round(r.heading)}° made by fallback model ${v.model}`);
        const err = (v.json as { error?: { message?: string } }).error;
        if (!v.ok) throw new AiRenderError(502, `Vertex AI: ${err?.message ?? v.status}`);
        const img = findImage(v.json);
        if (!img) throw new AiRenderError(502, 'Gemini returned no image (it may have declined this one). Try another view.');
        return img.data;
      }

      const res = await fetchFn('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          model: config.geminiImageModel,
          input: [
            { type: 'text', text: prompt },
            { type: 'image', mime_type: 'image/jpeg', data: photo },
            { type: 'image', mime_type: 'image/png', data: r.guide },
            ...(reference ? [{ type: 'image', mime_type: 'image/jpeg', data: reference }] : []),
          ],
          response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: r.aspect, image_size: '1K' },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) throw new AiRenderError(502, `Gemini: ${json.error?.message ?? res.status}`);
      const img = findImage(json);
      if (!img) throw new AiRenderError(502, 'Gemini returned no image (it may have declined this one). Try another view.');
      return img.data;
    };

    let edited = await askGemini();
    let masked = maskEdit(photoBytes, Buffer.from(edited, 'base64'), guide);
    // Built somewhere else than the guide shows (a median down the road instead of trees on the
    // sidewalk, say): ask once more, and keep whichever is closer to the plan.
    if (masked.onPlan !== null && masked.onPlan < MIN_ON_PLAN) {
      console.info(`photo-real edit for ${r.pano}@${Math.round(r.heading)}° changed only ${Math.round(masked.onPlan * 100)}% of the planned spot; asking again`);
      usage.addAiRender(new Date().toISOString().slice(0, 10), userId);
      const again = await askGemini().catch(() => null);
      const second = again ? maskEdit(photoBytes, Buffer.from(again, 'base64'), guide) : null;
      if (again && second && (second.onPlan ?? 0) > masked.onPlan) [edited, masked] = [again, second];
    }
    keepRaw(file, photoBytes, r.guide, edited);
    writeFileSync(`${out}.tmp`, masked.png);
    renameSync(`${out}.tmp`, out);
    return aiUrl(file);
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
