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

/**
 * What each kind of change is, physically, in the same design the 3D model (and so the plan image)
 * uses. Written as a specification rather than a wish: saved edits showed Gemini "improving" a
 * vague brief differently in every direction (green paint here, hatching and posts there).
 */
const BIKE_LANE: Record<Setting, string> = {
  urban:
    'BIKE LANE (city design): where the plan shows the lane, the roadway surface becomes a muted green bike lane with a solid white line on each edge and white bicycle symbols where the plan shows them. Flexible white posts stand only where the plan shows posts, on a painted buffer. No raised kerbs, planters or barriers. Parked cars stay where they are unless the plan puts the lane under them.',
  suburban:
    'BIKE LANE (suburban design): paint the solid white lane lines exactly where the plan shows lines, and white bicycle symbols and arrows only where the plan shows them. The road surface between the lines stays the existing asphalt: no green or coloured surface, no hatching, no new asphalt. Posts only where the plan shows posts; no kerbs or planters.',
  rural:
    'CYCLE PATH (country design): build a separate plain dark asphalt path beside the road where the plan shows it, set behind a grass verge: no green paint, no posts, cones or planters, with its edges blending naturally into the grass and verge.',
};

const BUILD: Record<ChangeOpType, string> = {
  add_bike_lane: BIKE_LANE.urban,
  add_bus_lane:
    'BUS LANE: the lane the plan shows in red becomes a bus-only lane: the existing asphalt of that lane surfaced in bus-lane red, a solid white line along its edge, and "BUS ONLY" lettering readable to a driver travelling along the lane. Parked cars standing in that lane are gone; every other lane keeps its surface and markings.',
  widen_sidewalk:
    'WIDER SIDEWALK: the sidewalk extends into the roadway as far as the plan shows: new concrete paving matching the existing sidewalk, with a new kerb at its outer edge, so the road is visibly narrower. Parked cars standing where the new sidewalk is are gone.',
  remove_parking:
    'NO PARKING: the parked cars along the kerb on the side the plan marks are gone, leaving the clean, empty road surface and kerb that was behind them. Moving traffic and cars elsewhere stay.',
  plant_trees:
    'STREET TREES: one tree stands at each place the plan shows a tree, trunk base exactly where the plan\'s trunk meets the ground, about the plan\'s height and spread, in a tree pit in the sidewalk or verge. The plan\'s trees are crude stand-ins: draw real trees of a species common on streets in this region, in the season the photo shows (in leaf if the existing trees are in leaf, bare if they are bare), with natural bark and branches, lit like the rest of the photo and casting a shadow in the same direction as the other shadows. Each new tree must be clearly visible as a new tree. If a tree already stands at a planned place, leave it and plant the new one in the nearest free stretch of sidewalk along the same kerb. Overhead wires and poles stay in front of or through the canopy as they really would. Existing trees keep their shape and season.',
  add_park:
    'PARK: the area the plan marks becomes a finished public park: lawn, trees where the plan shows trees, paths and planting. What stood on that ground before (paving, parked cars) is gone; everything around the area stays.',
  add_crosswalk:
    'CROSSWALK: paint white zebra bars on the road exactly where the plan shows bars: the same number, position and direction, flat on the existing road surface, crisp and newly painted. Existing crosswalks and markings elsewhere stay as they are.',
  replace_building:
    'NEW BUILDING: the existing building where the plan shows a block is replaced by a newly built one of the plan\'s shape and height: a realistic contemporary facade (brick, stone or glass that suits its neighbours), real windows on every floor, and a ground-floor shopfront and entrance. The neighbouring buildings stay.',
};

/** Raised crosswalks came out as a ramp-sided block when the brief only said "raised". */
const RAISED = ' This crossing is raised to kerb height, which from here shows only as a short, gentle ramp in the road surface along the two edges of the bars that traffic drives over, each ramp marked with a row of small white triangles. The bars themselves are the main thing and must be clearly painted; do not build a block, a platform with steep sides, or a brick or coloured surface, and do not repave the road around it.';

/**
 * "Plant 10 trees" → "Plant trees": each direction only shows some of them, and the guide already
 * shows exactly how many go where. A total that doesn't match the view could make Gemini cram in extras.
 */
export const withoutCounts = (desc: string) => desc.replace(/\b(plant|add)\s+\d+\s+/gi, '$1 ');

/**
 * The brief Gemini gets with the photo (image 1) and the placement guide (image 2). Each rule
 * answers something seen in saved edits: designs that differed by direction, whole scenes redrawn
 * or re-lit, roads resurfaced, existing trees changed, and changes built beside the plan.
 */
export function buildPrompt(ops: ChangeOpType[], desc: string, setting: Setting = 'urban', withReference = false): string {
  const kinds = [...new Set(ops)];
  const build = (k: ChangeOpType) => (k === 'add_bike_lane' ? BIKE_LANE[setting] : k === 'add_crosswalk' && /\braised\b/i.test(desc) ? BUILD[k] + RAISED : BUILD[k]);
  return [
    'You are retouching a real photograph to show one planned street change, for a public notice that must not mislead anyone. The result has to be the same photograph with only that change built in it.',
    'Image 1 is the photograph, taken at street level. Image 2 is the plan: a 3D model of only the new construction, rendered from exactly the same camera, on black. Its shapes show where each new thing goes and how big it is. Black means nothing is built there.',
    `${PLACE[setting]} If the photo clearly shows a different kind of place, trust the photo. Use the materials, markings and conventions of this country, so the change looks like it has always belonged there.`,
    '',
    `The request, in words: ${withoutCounts(desc).slice(0, 600)}`,
    'What to build:',
    ...kinds.map((k) => `- ${build(k)}`),
    '',
    'The plan is complete and exact:',
    '- Every shape in image 2 becomes one real thing at the same place and size in the photo. Where image 2 is black, build nothing.',
    '- A shape cut off by the edge of image 2 continues outside the picture: draw only the part that is inside the frame, cut off at the same edge. Never move or shrink something to fit it into view.',
    '- Do not improve on the plan: no extra lanes, lines, hatching, coloured surfaces, kerbs, posts, bollards, planters, signs, street lamps, benches, trees, cars or people that image 2 does not show. If the plan marks one side of the street, the other side stays untouched.',
    '- Place things as a city engineer would: lanes and markings stop at the edge of an intersection, and nothing new blocks an existing entrance, driveway, hydrant, bus stop or crossing.',
    '- Whatever stands in front of the planned spot in the photo (a parked car, a pole, a person, a tree) stays in front of it: build behind and around it.',
    '- The plan can sit a little off the photo. Road markings and lanes belong on the road surface: if a planned marking falls on grass, sidewalk or a wall, slide it the short distance onto the road beside it. Never turn grass, sidewalk or buildings into road.',
    '- If the photo already has, at that place, what the plan shows (a crosswalk where the plan paints one, say), leave it exactly as it is rather than repainting or repaving it.',
    '',
    'Everything else stays exactly as photographed:',
    '- Do not redraw, re-light, sharpen, clean up or repaint the photo. Outside the new construction, every pixel should match image 1: the same road surface with its cracks, patches, stains and old markings, the same shadows, buildings, cars, people, existing trees in the same season, wires, sky and weather.',
    '- Keep the camera position, framing, perspective and lens distortion identical, including the stretched, blurry road at the bottom of the frame and any watermark text.',
    '',
    'Make the new construction real:',
    '- It follows the perspective of the road and kerbs in the photo, and it is lit by the photo\'s own light: shadows already on the ground fall across it, and it casts shadows in the same direction as everything else.',
    '- It has the same sharpness, grain and blur as the part of the photo it sits in. Paint lies flat on the road and follows its texture.',
    '- Use image 2 only for position, size and layout. Do not copy its flat colours or computer look, and add no text, labels, outlines or arrows other than real road markings.',
    ...(withReference
      ? ['Image 3 is the same place, already edited, looking in a neighbouring direction. Where the same new construction appears, make it look identical: same materials, colours, markings and style.']
      : []),
    '',
    'Return only the edited photograph.',
  ].join('\n');
}

const aiDir = () => path.join(config.cacheDir, 'ai');
/**
 * An edit that changed less than this share of where the guide planned the change was built
 * somewhere else (measured on street trees: well-placed edits 0.45–0.93, misplaced ones 0.21–0.33).
 */
const MIN_ON_PLAN = 0.4;
/**
 * An edit that differs from the photo over more than this share of the frame is a different picture,
 * not an edit (saved edits: real ones 0.04–0.41; a redrawn street or a changed season 0.88–0.99).
 */
const MAX_REDRAWN = 0.6;
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
    // Or it drew a whole new picture instead of editing this one.
    const off = (m: typeof masked) => m.redrawn > MAX_REDRAWN || (m.onPlan !== null && m.onPlan < MIN_ON_PLAN);
    if (off(masked)) {
      console.info(`photo-real edit for ${r.pano}@${Math.round(r.heading)}° changed ${Math.round((masked.onPlan ?? 1) * 100)}% of the planned spot and ${Math.round(masked.redrawn * 100)}% of the photo; asking again`);
      usage.addAiRender(new Date().toISOString().slice(0, 10), userId);
      const again = await askGemini().catch(() => null);
      const second = again ? maskEdit(photoBytes, Buffer.from(again, 'base64'), guide) : null;
      if (again && second && (masked.redrawn > MAX_REDRAWN ? second.redrawn < masked.redrawn : second.redrawn <= MAX_REDRAWN && (second.onPlan ?? 0) > (masked.onPlan ?? 0))) [edited, masked] = [again, second];
    }
    // Still a different picture (Google's photo here may be unusable): better no view than a made-up street.
    if (masked.redrawn > MAX_REDRAWN) {
      keepRaw(file, photoBytes, r.guide, edited);
      throw new AiRenderError(502, 'Gemini redrew this whole view instead of editing it, so it was not saved. Try another spot.');
    }
    keepRaw(file, photoBytes, r.guide, edited);
    writeFileSync(`${out}.tmp`, masked.png);
    renameSync(`${out}.tmp`, out);
    return aiUrl(file);
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
