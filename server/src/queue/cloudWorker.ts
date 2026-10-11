import { setTimeout as pause } from 'node:timers/promises';
import { ChangeOp, type AreaDetail } from '@mamdani/shared';
import { estimate } from '../cost/estimate';
import { ensureTile, findArea } from '../data/tiles';
import { zoneIssues } from '../data/zoneIssues';
import { localTile, sceneIndex } from '../scene/local';
import { validateOpsForTile } from '../scene/validate';
import { supabase, uploadRender, setSnapshots } from '../supabase';
import type { RenderQueue } from './renderQueue';
import type { Prerenderer } from '../ai/prerender';
import type { SnapshotStore } from '../ai/snapshots';

export interface CloudJob {
  id: string;
  kind: 'zone' | 'proposal';
  ref: string;
  lease_token: string;
  attempts: number;
}

/** Publishes the small pickable scene. It can then be opened without contacting the laptop. */
export async function publishZone(id: string): Promise<AreaDetail> {
  const tile = await ensureTile(id);
  const area = findArea(id);
  if (!tile || !area) throw new Error('Unknown zone');
  const issues = await zoneIssues(id, tile.bbox);
  const detail: AreaDetail = { ...area, ...issues, scene: sceneIndex(tile), before: null };
  const client = supabase();
  const issueTotal = issues.issues.reduce((t, i) => t + i.count, 0);
  const { error: areaError } = await client.from('areas').upsert({ id, name: area.name, bbox: tile.bbox, issue_total: issueTotal });
  if (areaError) throw new Error(areaError.message);
  const { error } = await client.from('zone_scenes').upsert({ area_id: id, detail });
  if (error) throw new Error(error.message);
  return detail;
}

export interface JobStore {
  claim(): Promise<CloudJob | null>;
  renew(job: CloudJob): Promise<boolean>;
  finish(job: CloudJob, error: string | null, retryAt: string | null): Promise<boolean>;
}

export function cloudJobStore(): JobStore {
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await supabase().rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    claim: async () => (await rpc('claim_cloud_job'))?.[0] ?? null,
    renew: (job) => rpc('renew_cloud_job', { p_id: job.id, p_token: job.lease_token }),
    finish: (job, error, retryAt) => rpc('finish_cloud_job', {
      p_id: job.id, p_token: job.lease_token, p_error: error, p_retry_at: retryAt,
    }),
  };
}

/** Daily limits defer work until reset instead of repeatedly consuming retry attempts. */
export function retryAfterDailyLimit(error: string, now = new Date()): string | null {
  if (!/daily limit|today.s limit/i.test(error)) return null;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 1)).toISOString();
}

/** Serial worker with database leases. Polling survives missed events and laptop restarts. */
export class CloudWorker {
  private stopped = false;
  private loop: Promise<void> | null = null;
  private wake = new AbortController();

  constructor(
    private store: JobStore,
    private processJob: (job: CloudJob, assertLease: () => void) => Promise<void>,
    private log: (message: string) => void = console.warn,
    private pollMs = 5000,
    private heartbeatMs = 20_000,
  ) {}

  start() {
    if (!this.loop) this.loop = this.run();
  }

  /** Drain the current job before shutdown. A crash is handled by lease expiry instead. */
  async stop() {
    this.stopped = true;
    this.wake.abort();
    await this.loop;
  }

  async tick(): Promise<boolean> {
    const job = await this.store.claim();
    if (!job) return false;
    let leaseError: Error | null = null;
    let renewing: Promise<void> | null = null;
    const renew = () => {
      if (renewing) return;
      renewing = this.store.renew(job)
        .then((ok) => { if (!ok) leaseError = new Error('Job lease expired'); })
        .catch(() => { leaseError = new Error('Could not renew job lease'); })
        .finally(() => { renewing = null; });
    };
    const timer = setInterval(renew, this.heartbeatMs);
    const assertLease = () => { if (leaseError) throw leaseError; };
    try {
      await this.processJob(job, assertLease);
      assertLease();
      if (!(await this.store.finish(job, null, null))) throw new Error('Job lease expired before completion');
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.log(`Cloud ${job.kind} job failed: ${message}`);
      if (!leaseError) await this.store.finish(job, message, retryAfterDailyLimit(message));
    } finally {
      clearInterval(timer);
      await renewing;
    }
    return true;
  }

  private async run() {
    let unavailable = 0;
    while (!this.stopped) {
      try {
        const worked = await this.tick();
        unavailable = 0;
        if (worked) continue;
      } catch (err) {
        unavailable++;
        this.log(`Cloud queue unavailable: ${(err as Error).message}`);
      }
      await pause(Math.min(60_000, this.pollMs * 2 ** Math.min(unavailable, 4)), undefined, { signal: this.wake.signal }).catch(() => {});
    }
  }
}

/** All geometry/cost work runs on the laptop, and finished phone previews are uploaded once. */
export function processCloudJob(queue: RenderQueue, prerender: Prerenderer, snapshots: SnapshotStore) {
  return async (job: CloudJob, assertLease: () => void) => {
    if (job.kind === 'zone') {
      assertLease();
      await publishZone(job.ref);
      return;
    }
    const client = supabase();
    const { data: proposal, error } = await client.from('proposals').select('id, area_id, ops, after_url,processing_status,snapshots').eq('id', job.ref).single();
    if (error) throw new Error(error.message);
    if (proposal.processing_status === 'ready' && proposal.after_url && proposal.snapshots?.length) return;
    const ops = ChangeOp.array().min(1).max(50).parse(proposal.ops);
    const tile = await ensureTile(proposal.area_id);
    if (!tile) throw new Error('Unknown zone');
    const validation = validateOpsForTile(ops, tile);
    if (validation.length) {
      // A change that can't work there (a bike lane the street already has, parking on a street
      // without any): turned down straight away, with the reason, instead of being prepared.
      const { error: rejectError } = await client
        .from('proposals')
        .update({ status: 'rejected', processing_status: 'failed', processing_error: `Automatically rejected. ${validation.join(' ')}`.slice(0, 1000) })
        .eq('id', job.ref);
      if (rejectError) throw new Error(rejectError.message);
      return;
    }
    const cost = estimate(ops, localTile(tile));
    assertLease();
    const { error: stateError } = await client.from('proposals').update({ processing_status: 'running', processing_error: null, cost }).eq('id', job.ref);
    if (stateError) throw new Error(stateError.message);
    const rendered = await queue.renderNow(proposal.area_id, ops);
    assertLease();
    // Content-addressed models can be reused after a crash; uploadRender also avoids reuploading.
    const urls = await uploadRender(proposal.area_id, rendered.hash);
    const { error: modelError } = await client.from('proposals').update({ after_url: urls[0] }).eq('id', job.ref);
    if (modelError) throw new Error(modelError.message);
    assertLease();
    await prerender.prepare({ proposalId: job.ref, areaId: proposal.area_id, ops, afterUrl: urls[0] });
    assertLease();
    const status = prerender.status(job.ref);
    if (status?.status === 'failed') throw new Error(status.error ?? 'Preview preparation failed');
    const shots = snapshots.get(job.ref);
    if (!shots.shots.length) throw new Error(shots.error ?? status?.error ?? 'No preview images were prepared');
    // Reconcile the manifest, including on retries where the saved pictures already existed.
    await setSnapshots(job.ref, shots.shots);
    const { error: readyError } = await client.from('proposals').update({
      processing_status: 'ready', processing_error: null,
      thumb_url: shots.shots.find((s) => s.kind === 'after')?.url ?? shots.shots[0].url,
    }).eq('id', job.ref);
    if (readyError) throw new Error(readyError.message);
  };
}
