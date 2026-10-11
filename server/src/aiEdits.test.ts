import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zoneBbox, zoneIdAt } from '@mamdani/shared';
import { buildApp, type App } from './app';
import { openDb } from './db';
import { RenderQueue } from './queue/renderQueue';

describe('the whole zone of photo-real edits', () => {
  let app: App;
  const db = openDb(':memory:');

  beforeAll(async () => {
    app = await buildApp({ db, queue: new RenderQueue(db), logger: false });
  });
  afterAll(() => app.close());

  it('lists every edit made for a request, by Street View spot, whatever address the model was opened from', async () => {
    db.addAiEdit({ model: '/tiles/g1/abc/lod0.glb', pano: 'P1', heading: 90.4, pitch: -10, fov: 120, ops: ['add_bike_lane'], url: '/ai/a.png', at: [-73.99, 40.72] });
    db.addAiEdit({ model: '/tiles/g1/abc/lod0.glb', pano: 'P1', heading: 180, pitch: -10, fov: 120, ops: ['plant_trees'], url: '/ai/b.png', at: null });
    db.addAiEdit({ model: '/tiles/g1/abc/lod0.glb', pano: 'P2', heading: 0, pitch: -10, fov: 120, ops: ['add_bike_lane'], url: '/ai/c.png', at: [-73.991, 40.721] });
    db.addAiEdit({ model: '/tiles/g1/OTHER/lod0.glb', pano: 'P1', heading: 0, pitch: -10, fov: 120, ops: ['add_bike_lane'], url: '/ai/x.png', at: null });
    // The same direction again (e.g. re-prepared) replaces, not duplicates.
    db.addAiEdit({ model: '/tiles/g1/abc/lod0.glb', pano: 'P1', heading: 90, pitch: -10, fov: 120, ops: ['add_bike_lane'], url: '/ai/a.png', at: null });

    const model = encodeURIComponent('https://abc.ngrok.app/tiles/g1/abc/lod0.glb');
    const { spots } = (await app.inject(`/ai/edits?model=${model}`)).json();
    expect(Object.keys(spots).sort()).toEqual(['P1', 'P2']);
    expect(spots.P1).toHaveLength(2);
    expect(spots.P1.find((e: { url: string }) => e.url === '/ai/a.png')).toMatchObject({ heading: 90, ops: ['add_bike_lane'], at: [-73.99, 40.72] });
  });

  it("gives the zone's box, so Street View can keep you inside it", async () => {
    const id = zoneIdAt(-73.99, 40.72);
    expect((await app.inject(`/areas/${id}/bbox`)).json().bbox).toEqual(zoneBbox(id));
    expect((await app.inject('/areas/nope/bbox')).statusCode).toBe(404);
  });
});
