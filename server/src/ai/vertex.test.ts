import { editedPng, greyJpeg } from './testImages';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { aiProvider, renderStreetView, type RenderRequest } from './streetRender';
import { accessToken, loadServiceAccount } from './vertex';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'renders@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), project_id: 'test-project' };

describe('Vertex AI (service account)', () => {
  const saved = { ...config };
  afterEach(() =>
    Object.assign(config, { vertexKeyFile: saved.vertexKeyFile, vertexApiKey: saved.vertexApiKey, vertexProject: saved.vertexProject, cacheDir: saved.cacheDir, googleMapsServerKey: saved.googleMapsServerKey, geminiKey: saved.geminiKey }),
  );

  it('signs a JWT with the service account and exchanges it for an access token', async () => {
    let assertion = '';
    const fake = (async (_url: string, init?: RequestInit) => {
      assertion = new URLSearchParams(String(init!.body)).get('assertion')!;
      return new Response(JSON.stringify({ access_token: 'tok-123', expires_in: 3600 }));
    }) as typeof fetch;
    expect(await accessToken(sa, fake)).toBe('tok-123');
    const [h, c, s] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toMatchObject({ iss: sa.client_email, aud: 'https://oauth2.googleapis.com/token' });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('uses Vertex whenever the key file exists, and sends photo + guide to the project', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'vertex-'));
    const keyFile = path.join(dir, 'vertex-key.json');
    writeFileSync(keyFile, JSON.stringify(sa));
    Object.assign(config, { vertexKeyFile: keyFile, vertexApiKey: '', vertexProject: '', cacheDir: dir, googleMapsServerKey: 'm', geminiKey: '' });
    expect(loadServiceAccount(keyFile)?.project_id).toBe('test-project');
    expect(aiProvider()).toBe('vertex');

    const calls: string[] = [];
    let parts: unknown[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
      if (String(url).includes('streetview')) return new Response(new Uint8Array(greyJpeg()));
      parts = JSON.parse(String(init!.body)).contents[0].parts;
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: editedPng().toString('base64') } }] } }] }));
    }) as typeof fetch;
    const req: RenderRequest = { pano: 'PANO_x', heading: 10, pitch: -10, fov: 120, aspect: '1:1', guide: editedPng().toString('base64'), ops: ['add_bike_lane'], desc: 'Bike lane', model: 'm' };
    const usage = { aiRendersOn: () => 0, addAiRender: () => {} };
    const url = await renderStreetView(req, 'tester', usage, fake);
    expect(url).toMatch(/^\/ai\/[0-9a-f]{20}\.png$/);
    expect(calls.some((u) => u.includes('/projects/test-project/locations/global/publishers/google/models/gemini-3.1-flash-image:generateContent'))).toBe(true);
    expect(parts).toHaveLength(3); // prompt, photo, guide
  });
});

describe('Vertex AI (bound API key)', () => {
  it('sends the key in a header and bills the named project', async () => {
    const { vertexGenerate } = await import('./vertex');
    let seen: { url: string; key: string | null } = { url: '', key: null };
    const fake = (async (url: string, init?: RequestInit) => {
      seen = { url: String(url), key: new Headers(init!.headers).get('x-goog-api-key') };
      return new Response(JSON.stringify({ candidates: [] }));
    }) as typeof fetch;
    await vertexGenerate({ apiKey: 'AQ.test', project: 'my-proj' }, { model: 'gemini-2.5-flash-image', location: 'global', prompt: 'p', images: [], aspect: '1:1' }, fake);
    expect(seen.url).toContain('/projects/my-proj/locations/global/');
    expect(seen.key).toBe('AQ.test');
  });
});

describe('Vertex rate limits', () => {
  it('waits and retries when the per-minute allowance is used up', async () => {
    const { renderStreetView, setRetryDelay } = await import('./streetRender');
    const { config } = await import('../config');
    const dir = mkdtempSync(path.join(tmpdir(), 'vertex-'));
    Object.assign(config, { vertexApiKey: 'AQ.test', vertexProject: 'p', cacheDir: dir, googleMapsServerKey: 'm' });
    setRetryDelay(0);
    let tries = 0;
    const fake = (async (url: string) => {
      if (String(url).includes('streetview')) return new Response(new Uint8Array(greyJpeg()));
      tries++;
      if (tries < 3) return new Response(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted' } }), { status: 429 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: editedPng().toString('base64') } }] } }] }));
    }) as typeof fetch;
    const req = { pano: 'PANO_retry', heading: 1, pitch: 0, fov: 120, aspect: '1:1' as const, guide: editedPng().toString('base64'), ops: ['plant_trees' as const], desc: 'Plant trees', model: 'm' };
    expect(await renderStreetView(req, 'u', { aiRendersOn: () => 0, addAiRender: () => {} }, fake)).toMatch(/^\/ai\//);
    expect(tries).toBe(3);
    Object.assign(config, { vertexApiKey: '', vertexProject: '' });
  });
});
