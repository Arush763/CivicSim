import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AreaDetail, Draft } from '@mamdani/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from './app';
import { config } from './config';
import { openDb } from './db';
import { loadAreas } from './data/tiles';
import { RenderQueue } from './queue/renderQueue';

// Uses the real imported NYC tiles (npm run import:nyc). Runs in local-only mode (no Supabase).
const hasData = existsSync(path.join(config.dataDir, 'areas.json'));

describe.skipIf(!hasData || config.supabaseEnabled)('HTTP API (local-only mode)', () => {
  let app: App;
  let queue: RenderQueue;
  const headers = { 'x-dev-user': 'tester' };

  beforeAll(async () => {
    const db = openDb(':memory:');
    queue = new RenderQueue(db, { debounceMs: 10 });
    app = await buildApp({ db, queue, logger: false });
  });
  afterAll(() => app.close());

  const areaId = () => loadAreas().sort((a, b) => b.issueTotal - a.issueTotal)[0].id;

  it('lists areas and describes one', async () => {
    const list = (await app.inject('/areas')).json();
    expect(list.length).toBeGreaterThan(50);
    const detail: AreaDetail = (await app.inject(`/areas/${areaId()}`)).json();
    expect(detail.issues.length).toBeGreaterThan(0);
    expect(detail.scene.streets.length).toBeGreaterThan(0);
    expect(detail.scene.buildings[0].ring.length).toBeGreaterThanOrEqual(3);
  });

  it('serves the low-detail city map, gzipped', async () => {
    const city = (await app.inject('/city')).json();
    expect(city.zones.length).toBeGreaterThan(200);
    expect(city.labels.map((l: { name: string }) => l.name)).toContain('Lower East Side');
    const glb = await app.inject({ url: city.url, headers: { 'accept-encoding': 'gzip' } });
    expect(glb.statusCode).toBe(200);
    expect(glb.headers['content-encoding']).toBe('gzip');
  }, 30_000);

  it('serves the Street View before/after page', async () => {
    const res = await app.inject('/streetview?at=-0.12,51.5');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('StreetViewPanorama');
  });

  it('only accepts photo-real render requests from its own Street View page', async () => {
    const payload = { pano: 'PANO_abc', heading: 0, pitch: 0, fov: 90, aspect: '16:9', guide: 'x', ops: ['add_bike_lane'], desc: 'x', model: 'x' };
    const res = await app.inject({ method: 'POST', url: '/ai/render', headers: { origin: 'https://evil.example' }, payload });
    expect(res.statusCode).toBe(403);
  });

  it('rejects ops that reference streets outside the area', async () => {
    const res = await app.inject({
      method: 'POST', url: '/drafts', headers,
      payload: { areaId: areaId(), title: 'Bad', ops: [{ type: 'add_bus_lane', streetSegmentId: 'nope', side: 'left' }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('runs the draft → render → confirm loop', async () => {
    const detail: AreaDetail = (await app.inject(`/areas/${areaId()}`)).json();
    const street = detail.scene.streets[0];
    const created = await app.inject({
      method: 'POST', url: '/drafts', headers,
      payload: { areaId: detail.id, title: 'Protected lane', ops: [] },
    });
    expect(created.statusCode).toBe(201);
    const draft: Draft = created.json();

    const patched: Draft = (
      await app.inject({
        method: 'PATCH', url: `/drafts/${draft.id}`, headers,
        payload: { ops: [{ type: 'add_bike_lane', streetSegmentId: street.id, side: 'both', protected: true }] },
      })
    ).json();
    expect(patched.cost.total).toBeGreaterThan(0);
    expect(patched.cost.items[0].label).toContain(street.name);

    // Background render finishes on its own…
    await new Promise((r) => setTimeout(r, 50));
    await queue.onIdle();
    const after: Draft = (await app.inject({ url: `/drafts/${draft.id}`, headers })).json();
    expect(after.render?.status).toBe('done');

    // …and the rendered file is served.
    const glb = await app.inject(after.render!.lods[2]);
    expect(glb.statusCode).toBe(200);
    expect(glb.rawPayload.subarray(0, 4).toString()).toBe('glTF');
    expect(glb.headers['cache-control']).toContain('immutable');

    // Other users can't see or confirm it.
    expect((await app.inject({ url: `/drafts/${draft.id}`, headers: { 'x-dev-user': 'someone-else' } })).statusCode).toBe(404);

    const confirmed = await app.inject({ method: 'POST', url: `/drafts/${draft.id}/confirm`, headers, payload: {} });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().mode).toBe('local-only');
    expect((await app.inject({ url: `/drafts/${draft.id}`, headers })).statusCode).toBe(404);
    const proposals = (await app.inject({ url: `/local/proposals?areaId=${detail.id}`, headers: { authorization: 'Bearer tester' } })).json();
    expect(proposals[0].title).toBe('Protected lane');
    expect(proposals[0].after_url).toMatch(/lod0\.glb$/);
    const pid = proposals[0].id;

    // Residents confirm or deny; changing your vote moves it rather than adding another.
    const vote = (user: string, value: number) =>
      app.inject({ method: 'POST', url: `/local/proposals/${pid}/vote`, headers: { 'x-dev-user': user }, payload: { value } });
    await vote('alice', 1);
    await vote('bob', -1);
    await vote('bob', 1);
    const tally = (await vote('carol', -1)).json();
    expect(tally).toMatchObject({ confirm_count: 2, deny_count: 1, my_vote: -1 });

    // …and the admin makes the final call.
    const decided = await app.inject({ method: 'POST', url: `/proposals/${pid}/status`, headers, payload: { status: 'accepted' } });
    expect(decided.json().status).toBe('accepted');

    // Phones reach the server through ngrok, which marks requests as forwarded: never admin there.
    const viaNgrok = { ...headers, 'x-forwarded-for': '203.0.113.9' };
    const fromPhone = await app.inject({ method: 'POST', url: `/proposals/${pid}/status`, headers: viaNgrok, payload: { status: 'rejected' } });
    expect(fromPhone.statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/areas/${areaId()}/suggest`, headers: viaNgrok })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/ai/status', headers: { authorization: 'Bearer dev-user', 'x-forwarded-for': '203.0.113.9' } })).json().canGenerate).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/ai/status', headers: { authorization: 'Bearer dev-user' } })).json().canGenerate).toBe(true);
  });

  it('starts preparing photo-real views as soon as a request is submitted', async () => {
    const jobs: string[] = [];
    const db = openDb(':memory:');
    const q2 = new RenderQueue(db, { debounceMs: 10 });
    const app2 = await buildApp({ db, queue: q2, logger: false, prerender: { enqueue: (j: { proposalId: string }) => (jobs.push(j.proposalId), true), status: () => null } as never });
    const detail: AreaDetail = (await app2.inject(`/areas/${areaId()}`)).json();
    const d: Draft = (
      await app2.inject({ method: 'POST', url: '/drafts', headers, payload: { areaId: detail.id, title: 'Trees', ops: [{ type: 'add_bike_lane', streetSegmentId: detail.scene.streets[0].id, side: 'right', protected: false }] } })
    ).json();
    const res = (await app2.inject({ method: 'POST', url: `/drafts/${d.id}/confirm`, headers, payload: {} })).json();
    expect(jobs).toEqual([res.proposalId]);
    await app2.close();
  }, 30_000);

  it('refuses to submit an empty proposal', async () => {
    const d: Draft = (await app.inject({ method: 'POST', url: '/drafts', headers, payload: { areaId: areaId(), title: 'Empty', ops: [] } })).json();
    expect((await app.inject({ method: 'POST', url: `/drafts/${d.id}/confirm`, headers, payload: {} })).statusCode).toBe(422);
  });

  it('reports suggestions as unavailable without an API key', async () => {
    expect((await app.inject({ method: 'POST', url: `/areas/${areaId()}/suggest`, headers })).statusCode).toBe(503);
  });
});
