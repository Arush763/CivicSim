import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, type App } from './app';
import { SnapshotStore } from './ai/snapshots';
import { config } from './config';
import { openDb } from './db';
import { RenderQueue } from './queue/renderQueue';

// Routes the phone app uses that need no map data: the 3D model page and petition snapshots.
describe('phone app routes', () => {
  let app: App;
  const saved = { cacheDir: config.cacheDir, supabaseUrl: config.supabaseUrl, supabaseServiceKey: config.supabaseServiceKey, adminRemote: config.adminRemote };
  const id = '9b2c7a40-5d3e-4f1a-8c6b-0e7f2a1d3c4b';

  beforeAll(async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'phone-')), supabaseUrl: '', supabaseServiceKey: '', adminRemote: false });
    const db = openDb(':memory:');
    const snapshots = new SnapshotStore();
    await snapshots.save(id, 'top', Buffer.from([0xff, 0xd8, 0xff]));
    app = await buildApp({ db, queue: new RenderQueue(db), snapshots, logger: false });
  });
  afterAll(async () => {
    await app.close();
    Object.assign(config, saved);
  });

  it('serves the 3D model page', async () => {
    const res = await app.inject('/model?glb=/tiles/x/lod0.glb');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('OrbitControls');
  });

  it('rejects processing retries arriving through a tunnel or another device', async () => {
    const tunnel = await app.inject({ method: 'POST', url: `/proposals/${id}/process`, headers: { 'x-forwarded-for': '203.0.113.8' }, payload: {} });
    expect(tunnel.statusCode).toBe(403);
    const phone = await app.inject({ method: 'POST', url: `/proposals/${id}/process`, remoteAddress: '192.168.1.10', payload: {} });
    expect(phone.statusCode).toBe(403);
  });

  it('lists a request\'s snapshots and serves them', async () => {
    const list = (await app.inject(`/proposals/${id}/snapshots`)).json();
    expect(list).toMatchObject({ status: 'running', shots: [{ kind: 'top', url: `/snapshots/${id}/top.jpg` }] });
    const img = await app.inject(list.shots[0].url);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((await app.inject(`/snapshots/${id}/index.json`)).statusCode).toBe(404);
    expect((await app.inject('/proposals/unknown/snapshots')).json()).toEqual({ status: 'none', shots: [] });
  });
});
