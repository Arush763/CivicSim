import { editedPng, greyJpeg } from './testImages';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { openDb } from '../db';
import { buildPrompt, findImage, renderStreetView, staticSize, type RenderRequest } from './streetRender';

const req: RenderRequest = {
  pano: 'PANO_abc123', heading: 165.2, pitch: -4, fov: 90, aspect: '16:9',
  guide: editedPng().toString('base64'), ops: ['add_bike_lane'],
  desc: 'Protected bike lane on Whitehall (both sides)', model: '/tiles/g1/abc/lod0.glb',
};

describe('photo-real Street View renders', () => {
  const saved = { ...config };
  afterEach(() => Object.assign(config, { cacheDir: saved.cacheDir, geminiKey: saved.geminiKey, googleMapsServerKey: saved.googleMapsServerKey }));

  it('asks for a physically built change, not paint', () => {
    const p = buildPrompt(['add_bike_lane', 'plant_trees'], 'Protected bike lane on Whitehall');
    expect(p).toMatch(/raised concrete kerb/);
    expect(p).toMatch(/dense city street/);
    expect(p).toMatch(/tree pits/);
    expect(p).toMatch(/Protected bike lane on Whitehall/);
  });

  it("doesn't give Gemini totals that won't match a single direction", async () => {
    const { withoutCounts } = await import('./streetRender');
    expect(withoutCounts('Plant 10 trees; Bus lane on East 4th Street (both sides)')).toBe('Plant trees; Bus lane on East 4th Street (both sides)');
    expect(buildPrompt(['plant_trees'], 'Plant 10 trees')).not.toMatch(/10/);
  });

  it('builds changes to suit the place', () => {
    const rural = buildPrompt(['add_bike_lane'], 'Bike lane on Mill Road', 'rural');
    expect(rural).toMatch(/rural road/);
    expect(rural).toMatch(/trust the photo/);
    expect(rural).toMatch(/no posts, cones or planters/);
    expect(rural).not.toMatch(/raised concrete kerb/);
  });

  it('sizes Street View images within 640 px', () => {
    expect(staticSize('16:9')).toEqual([640, 360]);
    expect(staticSize('9:16')).toEqual([360, 640]);
  });

  it('finds the image wherever the response nests it', () => {
    expect(findImage({ steps: [{ content: [{ type: 'text', text: 'hi' }, { type: 'image', mime_type: 'image/jpeg', data: 'AAA' }] }] })).toEqual({ data: 'AAA', mime: 'image/jpeg' });
    expect(findImage({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'BBB' } }] } }] })).toEqual({ data: 'BBB', mime: 'image/png' });
    expect(findImage({ outputs: [{ type: 'text', text: 'no' }] })).toBeNull();
  });

  it('fetches the photo, sends it with the guide to Gemini, and caches the result', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'ai-')), geminiKey: 'g-key', googleMapsServerKey: 'm-key' });
    const calls: string[] = [];
    let sent: { input: { type: string }[]; response_format: { aspect_ratio: string } } | null = null;
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes('streetview')) return new Response(new Uint8Array(greyJpeg()));
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ outputs: [{ type: 'image', mime_type: 'image/jpeg', data: editedPng().toString('base64') }] }));
    }) as typeof fetch;

    const db = openDb(':memory:');
    const url = await renderStreetView(req, 'u1', db, fake);
    expect(url).toMatch(/^\/ai\/[0-9a-f]{20}\.png$/);
    expect(calls[0]).toContain('pano=PANO_abc123');
    expect(calls[0]).toContain('size=640x360');
    expect(sent!.input.map((x) => x.type)).toEqual(['text', 'image', 'image']);
    expect(sent!.response_format.aspect_ratio).toBe('16:9');

    // The same view again is served from disk, with no new calls.
    expect(await renderStreetView({ ...req, heading: 165.4 }, 'u1', db, fake)).toBe(url);
    expect(calls).toHaveLength(2);
    expect(db.aiRendersOn(new Date().toISOString().slice(0, 10))).toBe(1);
  });

  it('stops at the daily limit', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'ai-')), geminiKey: 'g', googleMapsServerKey: 'm', aiDailyLimit: 0 });
    await expect(renderStreetView({ ...req, pano: 'OTHER_PANO' }, 'u1', openDb(':memory:'))).rejects.toThrow(/limit/);
    config.aiDailyLimit = saved.aiDailyLimit;
  });

  it('keeps counting toward the daily limit after a server restart', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'ai-')), geminiKey: 'g', googleMapsServerKey: 'm', aiDailyLimit: 1 });
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'db-')), 'server.sqlite');
    const ok = (async (url: string) =>
      String(url).includes('streetview')
        ? new Response(new Uint8Array(greyJpeg()))
        : new Response(JSON.stringify({ outputs: [{ type: 'image', mime_type: 'image/png', data: editedPng().toString('base64') }] }))) as typeof fetch;
    await renderStreetView({ ...req, pano: 'PANO_one' }, 'u1', openDb(file), ok);
    // A fresh database connection, as after a restart: today's render is still counted.
    await expect(renderStreetView({ ...req, pano: 'PANO_two' }, 'u2', openDb(file), ok)).rejects.toThrow(/limit/);
    config.aiDailyLimit = saved.aiDailyLimit;
  });

  it('explains what is missing when keys are not set', async () => {
    Object.assign(config, { geminiKey: '', googleMapsServerKey: '' });
    await expect(renderStreetView(req, 'u1', openDb(':memory:'))).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe('maskEdit', () => {
  it('keeps the edit only where it changed the photo', async () => {
    const { maskEdit } = await import('./changeMask');
    const { PNG } = await import('pngjs');
    const { png, changed } = maskEdit(greyJpeg(), editedPng());
    const out = PNG.sync.read(png);
    const alpha = (x: number, y: number) => out.data[(y * out.width + x) * 4 + 3];
    expect(alpha(32, 32)).toBe(255); // the new thing
    expect(alpha(5, 32)).toBe(0); // untouched street: Google's own photo shows here
    expect(changed).toBeGreaterThan(0.02);
    expect(changed).toBeLessThan(0.1);
  });
});

describe('maskEdit with a guide', () => {
  it('ignores changes far from where the change was planned', async () => {
    const { maskEdit } = await import('./changeMask');
    const { PNG } = await import('pngjs');
    // The guide plans something in the top-left corner only; the edit changed the middle.
    const guide = new PNG({ width: 64, height: 64 });
    for (let i = 0; i < 64 * 64; i++) {
      const x = i % 64, y = Math.floor(i / 64);
      const on = x < 8 && y < 8;
      guide.data[i * 4] = guide.data[i * 4 + 1] = guide.data[i * 4 + 2] = on ? 200 : 0;
      guide.data[i * 4 + 3] = 255;
    }
    const { changed } = maskEdit(greyJpeg(), editedPng(), PNG.sync.write(guide));
    expect(changed).toBe(0);
  });
});
