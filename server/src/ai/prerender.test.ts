import { unproject } from '@mamdani/shared';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { openDb } from '../db';
import { Prerenderer, type Launch } from './prerender';

// A one-street pilot-style zone on disk (the pilot loader reads data/tiles/{id}.json).
const origin: [number, number] = [-74, 40.72];
const ll = (x: number, n: number) => unproject(origin, [x, n]);
function makeZone() {
  const dir = mkdtempSync(path.join(tmpdir(), 'prerender-'));
  mkdirSync(path.join(dir, 'tiles'), { recursive: true });
  writeFileSync(
    path.join(dir, 'tiles', 'r77c77.json'),
    JSON.stringify({
      id: 'r77c77',
      bbox: [...ll(-100, -100), ...ll(100, 100)],
      streets: [{ id: 's1', name: 'Test St', line: [ll(-90, 0), ll(90, 0)], widthM: 16, travelLanes: 2, parkingLanes: 2, hasBikeLane: false }],
      buildings: [],
      parks: [],
    }),
  );
  return dir;
}

describe('preparing photo-real views ahead of time', () => {
  const saved = { ...config };
  afterEach(() => Object.assign(config, { dataDir: saved.dataDir, aiFake: saved.aiFake, googleMapsServerKey: saved.googleMapsServerKey, chromePath: saved.chromePath }));

  it('opens the request in prepare mode, signed in, and records the result', async () => {
    Object.assign(config, { dataDir: makeZone(), aiFake: true, googleMapsServerKey: 'm', chromePath: '/fake/chrome' });
    const db = openDb(':memory:');
    let opened = '';
    const launch: Launch = async (url) => {
      opened = url;
      return { spots: 4, edited: 9, failures: 1 };
    };
    const p = new Prerenderer(db, launch, () => 'http://127.0.0.1:3000');
    expect(p.enqueue({ proposalId: 'p1', areaId: 'r77c77', ops: [{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'both', protected: true }], afterUrl: '/tiles/r77c77/abc/lod0.glb' })).toBe(true);
    await p.onIdle();
    const u = new URL(opened);
    expect(u.pathname).toBe('/streetview');
    expect(u.searchParams.get('prepare')).toBe(String(config.prerenderSpots));
    expect(u.searchParams.get('glb')).toBe('http://127.0.0.1:3000/tiles/r77c77/abc/lod0.glb');
    expect(u.searchParams.get('desc')).toMatch(/Protected bike lane on Test St/);
    expect(u.searchParams.get('look')).not.toBeNull(); // looking down the street, as the app does
    expect(u.hash).toBe(`#token=${encodeURIComponent(config.prerenderSecret)}`);
    expect(p.status('p1')).toMatchObject({ status: 'done', spots: 4, edited: 9, failures: 1 });
  });

  it('skips (and says why) when photo-real is not set up', () => {
    Object.assign(config, { aiFake: false, googleMapsServerKey: '' });
    const db = openDb(':memory:');
    const p = new Prerenderer(db, async () => ({}));
    expect(p.enqueue({ proposalId: 'p2', areaId: 'r77c77', ops: [], afterUrl: '/x' })).toBe(false);
    expect(p.status('p2')).toMatchObject({ status: 'skipped' });
  });

  it('records a failure from the page', async () => {
    Object.assign(config, { dataDir: makeZone(), aiFake: true, googleMapsServerKey: 'm', chromePath: '/fake/chrome' });
    const db = openDb(':memory:');
    const p = new Prerenderer(db, async () => ({ error: 'photo-real is not set up' }));
    p.enqueue({ proposalId: 'p3', areaId: 'r77c77', ops: [{ type: 'add_bike_lane', streetSegmentId: 's1', side: 'right', protected: false }], afterUrl: '/t.glb' });
    await p.onIdle();
    expect(p.status('p3')).toMatchObject({ status: 'failed', error: 'photo-real is not set up' });
  });
});
