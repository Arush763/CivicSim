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
  issuesRefreshMs: 60 * 60 * 1000,
};
