import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** Pilot area: lower Manhattan up to 14th St. [west, south, east, north] */
  pilotBbox: [-74.02, 40.7, -73.97, 40.739] as [number, number, number, number],
  tileSizeM: 200,
  dataDir: path.join(root, 'data'),
  cacheDir: path.join(root, 'cache'),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  /** When Supabase isn't configured, the server runs in local-only dev mode (no auth, no upload). */
  get supabaseEnabled() {
    return !!(this.supabaseUrl && this.supabaseServiceKey);
  },
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** Photo-real Street View renders (see ai/streetRender.ts). */
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-nano-banana-2.1',
  /** The browser key the Street View page loads Google Maps with (inserted into the page, never put in URLs). */
  googleMapsBrowserKey: process.env.GOOGLE_MAPS_BROWSER_KEY ?? '',
  /** Fetches Street View images server-side; needs the Street View Static API and no website restriction. */
  googleMapsServerKey: process.env.GOOGLE_MAPS_SERVER_KEY ?? '',
  /** Most new photo-real renders per day, so nobody (or no bug) can run up the Gemini bill. */
  aiDailyLimit: Number(process.env.AI_DAILY_LIMIT ?? 100),
  /**
   * Development only: stand in for Gemini by pasting the 3D guide into the real photo, to test
   * the photo-real viewer (stitching, alignment, moving) without spending anything.
   */
  aiFake: process.env.AI_FAKE === '1',
  /** Photo-real views prepared as soon as a request comes in: how many Street View spots around it. */
  prerenderSpots: Number(process.env.PRERENDER_SPOTS ?? 5),
  /** Chrome, for preparing views in a hidden browser (any Chrome or Chromium). */
  chromePath:
    process.env.CHROME_PATH ||
    ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) =>
      existsSync(p),
    ) ||
    '',
  /** A private sign-in for that hidden browser; changes every time the server starts. */
  prerenderSecret: process.env.PRERENDER_SECRET || randomUUID(),
  /**
   * The admin panel runs on this computer. Requests that arrive through ngrok (or any proxy) are
   * never admin, so phones can only make requests, even with an admin's sign-in. Set
   * ADMIN_REMOTE=1 to let admins work from other computers too.
   */
  adminRemote: process.env.ADMIN_REMOTE === '1',
  /**
   * Gemini through Vertex AI (billed to the Google Cloud project and its credits): used whenever
   * this service-account key file exists. Otherwise GEMINI_API_KEY (AI Studio) is used.
   */
  vertexKeyFile: process.env.VERTEX_KEY_FILE || path.join(root, 'vertex-key.json'),
  /** Or: an API key bound to a service account, plus the project it bills to. */
  vertexApiKey: process.env.VERTEX_API_KEY ?? '',
  vertexProject: process.env.VERTEX_PROJECT ?? '',
  vertexLocation: process.env.VERTEX_LOCATION || 'global',
  // Picked by comparing models on the same Street View edit: 3.1 Flash Image kept the photo best
  // (edge match 0.70–0.72 vs 0.37 for 2.5 Flash Image) and placed trees correctly; 3 Pro Image was
  // as faithful but slower, pricier, and changed things it wasn't asked to. 1K is as faithful as 2K
  // (Street View images are only 640 px) and twice as fast: ~15 s vs ~34 s.
  vertexImageModel: process.env.VERTEX_IMAGE_MODEL || 'gemini-3.1-flash-image',
  vertexImageSize: process.env.VERTEX_IMAGE_SIZE || '1K',
  /**
   * When the main model is busy, try these, cheapest first, then the main one again, round and
   * round (0.1 s apart) until one answers. Each model has its own share of Google's capacity.
   * 3.1 Flash Lite: ~8 s and photo-real but less precise; 2.5 Flash: in between.
   */
  vertexFallbackModels: (process.env.VERTEX_FALLBACK_MODELS ?? 'gemini-3.1-flash-lite-image,gemini-2.5-flash-image').split(',').map((m) => m.trim()).filter(Boolean),
  /** Give up on a busy edit after this long. */
  vertexBusyLimitMs: Number(process.env.VERTEX_BUSY_LIMIT_MS ?? 60_000),
  issuesRefreshMs: 60 * 60 * 1000,
};
