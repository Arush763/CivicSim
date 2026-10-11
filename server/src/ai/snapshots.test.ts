import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config';
import { SnapshotStore, type Snapshot } from './snapshots';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('petition snapshots', () => {
  const saved = config.cacheDir;
  afterEach(() => Object.assign(config, { cacheDir: saved }));

  it('keeps pictures in the design order and reports progress', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'snaps-')) });
    const store = new SnapshotStore();
    expect(store.get(ID)).toEqual({ status: 'none', shots: [] });
    store.start(ID);
    await store.save(ID, 'top', Buffer.from('3d'));
    await store.save(ID, 'after', Buffer.from('sv'));
    expect(store.get(ID).status).toBe('running');
    expect(store.get(ID).shots.map((s) => s.kind)).toEqual(['after', 'top']);
    expect(store.get(ID).shots[0]).toEqual({ kind: 'after', label: 'Street View · after', url: `/snapshots/${ID}/after.jpg` });
    store.finish(ID, 'Street View timed out');
    expect(store.get(ID)).toMatchObject({ status: 'done', error: 'Street View timed out' }); // some pictures beat none
  });

  it('shares each picture (Supabase) and never uses a bad id as a folder', async () => {
    Object.assign(config, { cacheDir: mkdtempSync(path.join(tmpdir(), 'snaps-')) });
    let listed: Snapshot[] = [];
    const store = new SnapshotStore(async (_id, kind) => `https://sb.example/${kind}.jpg`, (_id, shots) => {
      listed = shots;
    });
    await store.save(ID, 'before', Buffer.from('x'));
    expect(listed).toEqual([{ kind: 'before', label: 'Street View · before', url: 'https://sb.example/before.jpg' }]);
    expect(store.get('../../etc')).toEqual({ status: 'none', shots: [] });
    await expect(store.save('../../etc', 'top', Buffer.from('x'))).rejects.toThrow(/bad request id/);
  });
});
