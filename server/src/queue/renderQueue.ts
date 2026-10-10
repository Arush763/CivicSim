import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import type { ChangeOp, RenderEvent, RenderJobInfo, RenderStatus } from '@mamdani/shared';
import type { Db } from '../db';
import { isRendered, renderHash, renderTile, renderedUrls } from '../scene/render';

export const PRIORITY = { prewarm: 0, draft: 10, confirm: 20 } as const;

type RenderFn = typeof renderTile;

/**
 * Background render queue.
 *
 * - Jobs are keyed by content hash (area + ops), so identical scenes render once and are cached on disk.
 * - Edits to the same draft are debounced, and a newer edit supersedes an older one that hasn't started.
 * - Job state is persisted, so unfinished work resumes after a restart.
 * - Emits `render` events as jobs move queued → building → lod_ready → done.
 */
export class RenderQueue extends EventEmitter<{ render: [RenderEvent] }> {
  private q: PQueue;
  private inflight = new Map<string, Promise<RenderJobInfo>>(); // hash → job
  private latestForDraft = new Map<string, string>(); // draftId → hash it should show
  private debounce = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Db,
    opts: { concurrency?: number; debounceMs?: number; render?: RenderFn } = {},
  ) {
    super();
    this.q = new PQueue({ concurrency: opts.concurrency ?? 2 });
    this.debounceMs = opts.debounceMs ?? 500;
    this.render = opts.render ?? renderTile;
  }
  private debounceMs: number;
  private render: RenderFn;

  info(areaId: string, ops: ChangeOp[]): RenderJobInfo {
    const hash = renderHash(areaId, ops);
    if (isRendered(areaId, hash)) return { hash, status: 'done', lods: renderedUrls(areaId, hash) };
    const job = this.db.getJob(hash);
    return { hash, status: (job?.status as RenderStatus) ?? 'queued', lods: [], error: job?.error ?? undefined };
  }

  /** Queue a draft render after the debounce window. Returns the hash the draft will end up at. */
  requestForDraft(draftId: string, areaId: string, ops: ChangeOp[]): RenderJobInfo {
    const hash = renderHash(areaId, ops);
    const previous = this.latestForDraft.get(draftId);
    this.latestForDraft.set(draftId, hash);
    if (previous && previous !== hash && !this.inflight.has(previous)) {
      this.emitStatus(draftId, areaId, { hash: previous, status: 'superseded', lods: [] });
    }
    clearTimeout(this.debounce.get(draftId));
    const current = this.info(areaId, ops);
    if (current.status === 'done') {
      this.debounce.delete(draftId);
      this.emitStatus(draftId, areaId, current);
      return current;
    }
    this.debounce.set(
      draftId,
      setTimeout(() => {
        this.debounce.delete(draftId);
        // Only the latest edit for this draft gets rendered.
        if (this.latestForDraft.get(draftId) === hash) void this.enqueue(areaId, ops, draftId, PRIORITY.draft).catch(() => {});
      }, this.debounceMs),
    );
    return { hash, status: 'queued', lods: [] };
  }

  /** Render now (skipping debounce) and wait for it — used on confirm, at top priority. */
  async renderNow(areaId: string, ops: ChangeOp[], draftId: string | null = null): Promise<RenderJobInfo> {
    if (draftId) {
      clearTimeout(this.debounce.get(draftId));
      this.debounce.delete(draftId);
      this.latestForDraft.set(draftId, renderHash(areaId, ops));
    }
    return this.enqueue(areaId, ops, draftId, PRIORITY.confirm);
  }

  /** Pre-render a scene in the background at low priority (e.g. every area's "before"). */
  prewarm(areaId: string, ops: ChangeOp[] = []) {
    void this.enqueue(areaId, ops, null, PRIORITY.prewarm).catch(() => {});
  }

  /** Re-queue jobs left unfinished by a previous run. */
  resume() {
    for (const j of this.db.unfinishedJobs()) void this.enqueue(j.areaId, j.ops, null, PRIORITY.prewarm).catch(() => {});
  }

  forgetDraft(draftId: string) {
    clearTimeout(this.debounce.get(draftId));
    this.debounce.delete(draftId);
    this.latestForDraft.delete(draftId);
  }

  get pending() {
    return this.q.size + this.q.pending;
  }

  onIdle() {
    return this.q.onIdle();
  }

  private enqueue(areaId: string, ops: ChangeOp[], draftId: string | null, priority: number): Promise<RenderJobInfo> {
    const hash = renderHash(areaId, ops);
    if (isRendered(areaId, hash)) {
      const done: RenderJobInfo = { hash, status: 'done', lods: renderedUrls(areaId, hash) };
      this.emitStatus(draftId, areaId, done);
      return Promise.resolve(done);
    }
    const existing = this.inflight.get(hash);
    if (existing) return existing;

    this.db.setJob(hash, areaId, ops, 'queued');
    this.emitStatus(draftId, areaId, { hash, status: 'queued', lods: [] });

    const job = this.q
      .add(
        async (): Promise<RenderJobInfo> => {
          // A draft edit that was superseded while waiting in line is skipped.
          if (draftId && priority === PRIORITY.draft && this.latestForDraft.get(draftId) !== hash) {
            this.db.setJob(hash, areaId, ops, 'superseded');
            const skipped: RenderJobInfo = { hash, status: 'superseded', lods: [] };
            this.emitStatus(draftId, areaId, skipped);
            return skipped;
          }
          this.db.setJob(hash, areaId, ops, 'building');
          this.emitStatus(draftId, areaId, { hash, status: 'building', lods: [] });
          const ready: string[] = [];
          const r = await this.render(areaId, ops, (lod) => {
            // LODs arrive low → high detail; tell the viewer each time one is ready.
            ready.unshift(`/tiles/${areaId}/${hash}/lod${lod}.glb`);
            if (lod > 0) this.emitStatus(draftId, areaId, { hash, status: 'lod_ready', lods: [...ready] });
          });
          this.db.setJob(hash, areaId, ops, 'done');
          const done: RenderJobInfo = { hash, status: 'done', lods: r.lods };
          this.emitStatus(draftId, areaId, done);
          return done;
        },
        { priority },
      )
      .catch((err: Error) => {
        this.db.setJob(hash, areaId, ops, 'failed', err.message);
        const failed: RenderJobInfo = { hash, status: 'failed', lods: [], error: err.message };
        this.emitStatus(draftId, areaId, failed);
        throw err;
      })
      .finally(() => this.inflight.delete(hash)) as Promise<RenderJobInfo>;

    this.inflight.set(hash, job);
    return job;
  }

  private emitStatus(draftId: string | null, areaId: string, job: RenderJobInfo) {
    this.emit('render', { kind: 'render', draftId, areaId, job });
  }
}
