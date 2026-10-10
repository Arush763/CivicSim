import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { buildPrompt, findImage, renderStreetView, staticSize, type RenderRequest } from './streetRender';

const req: RenderRequest = {
  pano: 'PANO_abc123', heading: 165.2, pitch: -4, fov: 90, aspect: '16:9',
  guide: Buffer.from('guide').toString('base64'), ops: ['add_bike_lane'],
  desc: 'Protected bike lane on Whitehall (both sides)', model: '/tiles/g1/abc/lod0.glb',
};

describe('photo-real Street View renders', () => {
  const saved = { ...config };
  afterEach(() => Object.assign(config, { cacheDir: saved.cacheDir, geminiKey: saved.geminiKey, googleMapsServerKey: saved.googleMapsServerKey }));

  it('asks for a physically built change, not paint', () => {
    const p = buildPrompt(['add_bike_lane', 'plant_trees'], 'Protected bike lane on Whitehall');
    expect(p).toMatch(/raised concrete kerb/);
    expect(p).toMatch(/Remove any parked cars/);
    expect(p).toMatch(/tree pits/);
    expect(p).toMatch(/Protected bike lane on Whitehall/);
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
      if (String(url).includes('streetview')) return new Response(Buffer.from('jpeg-bytes'));
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ outputs: [{ type: 'image', mime_type: 'image/jpeg', data: Buffer.from('after').toString('base64') }] }));
    }) as typeof fetch;

    const url = await renderStreetView(req, fake);
    expect(url).toMatch(/^\/ai\/[0-9a-f]{20}\.jpg$/);
    expect(calls[0]).toContain('pano=PANO_abc123');
    expect(calls[0]).toContain('size=640x360');
    expect(sent!.input.map((x) => x.type)).toEqual(['text', 'image', 'image']);
    expect(sent!.response_format.aspect_ratio).toBe('16:9');

    // The same view again is served from disk, with no new calls.
    expect(await renderStreetView({ ...req, heading: 165.4 }, fake)).toBe(url);
    expect(calls).toHaveLength(2);
  });

  it('stops at the daily limit', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'ai-')), geminiKey: 'g', googleMapsServerKey: 'm', aiDailyLimit: 0 });
    await expect(renderStreetView({ ...req, pano: 'OTHER_PANO' })).rejects.toThrow(/limit/);
    config.aiDailyLimit = saved.aiDailyLimit;
  });

  it('explains what is missing when keys are not set', async () => {
    Object.assign(config, { geminiKey: '', googleMapsServerKey: '' });
    await expect(renderStreetView(req)).rejects.toThrow(/GEMINI_API_KEY/);
  });
});
