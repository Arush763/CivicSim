import type { ChangeOp, RenderEvent } from '@mamdani/shared';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db';
import { renderHash } from '../scene/render';
import { RenderQueue } from './renderQueue';

const opsN = (n: number): ChangeOp[] => [{ type: 'plant_trees', count: n, line: [[-74, 40.72], [-74.001, 40.72]] }];

function setup(renderDelayMs = 5) {
  const rendered: string[] = [];
  const render = vi.fn(async (areaId: string, ops: ChangeOp[], onLod?: (l: 0 | 1 | 2) => void) => {
    await new Promise((r) => setTimeout(r, renderDelayMs));
    for (const l of [2, 1, 0] as const) onLod?.(l);
    const hash = renderHash(areaId, ops);
    rendered.push(hash);
    return { hash, lods: [0, 1, 2].map((l) => `/tiles/${areaId}/${hash}/lod${l}.glb`) };
  });
  const queue = new RenderQueue(openDb(':memory:'), { concurrency: 1, debounceMs: 20, render });
  const events: RenderEvent[] = [];
  queue.on('render', (e) => events.push(e));
  return { queue, render, rendered, events };
}

const settle = async (queue: RenderQueue) => {
  await new Promise((r) => setTimeout(r, 40)); // let debounce timers fire
  await queue.onIdle();
};

describe('RenderQueue', () => {
  it('debounces rapid edits to a draft and only renders the latest', async () => {
    const { queue, rendered } = setup();
    for (let n = 1; n <= 5; n++) queue.requestForDraft('d1', 'r00c00', opsN(n));
    await settle(queue);
    expect(rendered).toEqual([renderHash('r00c00', opsN(5))]);
  });

  it('skips a queued draft render that a newer edit superseded', async () => {
    const { queue, rendered, events } = setup(30);
    queue.prewarm('r00c00', opsN(100)); // occupies the single worker
    queue.requestForDraft('d1', 'r00c00', opsN(1));
    await new Promise((r) => setTimeout(r, 25)); // d1 edit #1 now waiting in the queue
    queue.requestForDraft('d1', 'r00c00', opsN(2));
    await settle(queue);
    expect(rendered).not.toContain(renderHash('r00c00', opsN(1)));
    expect(rendered).toContain(renderHash('r00c00', opsN(2)));
    expect(events.some((e) => e.draftId === 'd1' && e.job.status === 'superseded')).toBe(true);
  });

  it('dedupes identical scenes across requesters', async () => {
    const { queue, render } = setup();
    const a = queue.renderNow('r00c00', opsN(3), 'd1');
    const b = queue.renderNow('r00c00', opsN(3), 'd2');
    await Promise.all([a, b]);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('lets a confirm jump ahead of background pre-renders', async () => {
    const { queue, rendered } = setup(10);
    for (let n = 50; n < 55; n++) queue.prewarm('r00c00', opsN(n));
    await queue.renderNow('r00c00', opsN(1), 'd1');
    // The first prewarm had already started; the confirm must run before the other four.
    expect(rendered.indexOf(renderHash('r00c00', opsN(1)))).toBeLessThanOrEqual(1);
  });

  it('reports progress as queued → building → lod_ready → done', async () => {
    const { queue, events } = setup();
    await queue.renderNow('r00c00', opsN(7), 'd9');
    const statuses = events.filter((e) => e.draftId === 'd9').map((e) => e.job.status);
    expect(statuses[0]).toBe('queued');
    expect(statuses).toContain('building');
    expect(statuses).toContain('lod_ready');
    expect(statuses.at(-1)).toBe('done');
    const lodReady = events.find((e) => e.job.status === 'lod_ready')!;
    expect(lodReady.job.lods[0]).toMatch(/lod2\.glb$/); // lowest detail arrives first
  });

  it('marks failures', async () => {
    const q = new RenderQueue(openDb(':memory:'), {
      debounceMs: 1,
      render: async () => {
        throw new Error('boom');
      },
    });
    await expect(q.renderNow('r00c00', opsN(1))).rejects.toThrow('boom');
    expect(q.info('r00c00', opsN(1)).status).toBe('failed');
  });
});
