import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from './app';
import { config } from './config';
import { openDb } from './db';
import { RenderQueue } from './queue/renderQueue';

// With Supabase on, only a valid access token is a signed-in person. The admin panel on this
// computer needs no sign-in and acts as the city admin account.
vi.mock('./supabase', () => ({
  userIdForToken: async (token: string) => ({ 'good-token': 'user-1' })[token] ?? null,
  cityAdminId: async () => 'city-admin',
}));

describe('photo-real render endpoint with Supabase on', () => {
  let app: App;
  const saved = { ...config };
  const payload = { pano: 'PANO_abc', heading: 0, pitch: 0, fov: 90, aspect: '16:9', guide: 'x', ops: ['add_bike_lane'], desc: 'x', model: 'x' };
  // Same-origin, as the Street View page sends it; outside a browser this header can be faked.
  const sameOrigin = { host: 'localhost:3000', origin: 'http://localhost:3000' };
  // A phone reaches the server through ngrok, which marks the request as forwarded.
  const viaNgrok = { ...sameOrigin, 'x-forwarded-for': '203.0.113.9' };

  beforeAll(async () => {
    Object.assign(config, { supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: 'service', geminiKey: '', googleMapsServerKey: '' });
    const db = openDb(':memory:');
    app = await buildApp({ db, queue: new RenderQueue(db), logger: false });
  });
  afterAll(async () => {
    await app.close();
    Object.assign(config, { supabaseUrl: saved.supabaseUrl, supabaseServiceKey: saved.supabaseServiceKey, geminiKey: saved.geminiKey, googleMapsServerKey: saved.googleMapsServerKey });
  });

  it('refuses a faked Origin header from a phone without a signed-in person', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/render', headers: viaNgrok, payload });
    expect(res.statusCode).toBe(401);
  });

  it('refuses an invalid token', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/render', headers: { ...viaNgrok, authorization: 'Bearer bad-token' }, payload });
    expect(res.statusCode).toBe(401);
  });

  it('lets a signed-in person through (then stops here only because no Gemini key is set)', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/render', headers: { ...viaNgrok, authorization: 'Bearer good-token' }, payload });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/GEMINI_API_KEY/);
  });

  it('lets the admin panel on this computer through without signing in', async () => {
    const res = await app.inject({ method: 'POST', url: '/ai/render', headers: sameOrigin, payload });
    expect(res.statusCode).toBe(503);
  });

  it('only lets the admin panel on this computer have new edits made', async () => {
    const status = (headers: Record<string, string>) =>
      app.inject({ method: 'GET', url: '/ai/status', headers }).then((r) => r.json().canGenerate);
    expect(await status({})).toBe(true); // the admin panel: no sign-in
    expect(await status({ authorization: 'Bearer good-token', 'x-forwarded-for': '203.0.113.9' })).toBe(false); // a phone, through ngrok
    expect(await status({ 'x-forwarded-for': '203.0.113.9' })).toBe(false);
  });
});
