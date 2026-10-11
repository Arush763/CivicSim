/**
 * Photo-real views prepared as soon as a request comes in, so nobody waits for them. The server
 * opens the request's Street View page in a hidden Chrome, in "prepare" mode: the page builds the
 * spot nearest the change and neighbouring spots along the street, exactly as a viewer's page would
 * (same guides, same requests), and the server saves every edit. When anyone opens the request,
 * those spots load instantly from the saved edits.
 *
 * One request is prepared at a time. Each one's progress is kept in the `prerenders` table.
 */
import PQueue from 'p-queue';
import type { Page } from 'puppeteer-core';
import { changeFocus, describeRequest, streetViewQuery, type ChangeOp } from '@mamdani/shared';
import { config } from '../config';
import type { Db, PrerenderRow } from '../db';
import { ensureTile } from '../data/tiles';
import { sceneIndex } from '../scene/local';
import type { ShotKind, SnapshotStore } from './snapshots';
import { aiRenderEnabled } from './streetRender';

export interface PrerenderJob {
  proposalId: string;
  areaId: string;
  ops: ChangeOp[];
  /** The request's 3D model (lod0): a /tiles/… path or a full URL. */
  afterUrl: string;
}

export interface PrepareResult {
  spots?: number;
  edited?: number;
  failures?: number;
  error?: string;
}

/** Keeps one snapshot the page took (see snapshots.ts). */
export type ShotSink = (kind: ShotKind, jpeg: Buffer) => Promise<unknown>;

/** Opens a page and waits for its prepare run to finish, taking snapshots on the way if asked. Swapped out in tests. */
export type Launch = (url: string, timeoutMs: number, shots?: ShotSink) => Promise<PrepareResult>;

type Status = Omit<PrerenderRow, 'updatedAt'>;

const TIMEOUT_MS = 60 * 60_000; // a whole zone can take a while when Google is busy

export class Prerenderer {
  private q = new PQueue({ concurrency: 1 });

  constructor(
    private db: Db,
    private launch: Launch = launchChrome,
    private baseUrl = () => `http://127.0.0.1:${config.port}`,
    /** Also told about every change, e.g. to show "Preparing…"/"Ready" on the request in Supabase. */
    private onStatus: ((s: Status) => Promise<void> | void) | null = null,
    /** Where the petition snapshots taken on the way are kept (none: no snapshots). */
    private snapshots: SnapshotStore | null = null,
  ) {}

  private save(s: Status) {
    this.db.setPrerender(s);
    if (this.onStatus) void Promise.resolve(this.onStatus(s)).catch((err) => console.warn(`prerender status not shared: ${(err as Error).message}`));
  }

  get pending() {
    return this.q.size + this.q.pending;
  }

  onIdle() {
    return this.q.onIdle();
  }

  status(proposalId: string): PrerenderRow | null {
    return this.db.getPrerender(proposalId);
  }

  /**
   * Queue a request for preparation. Returns false if photo-real isn't set up (nothing to prepare);
   * its snapshots (plain Street View and the 3D model) are still taken then, if Chrome is there.
   */
  enqueue(job: PrerenderJob): boolean {
    const base = { proposalId: job.proposalId, areaId: job.areaId, spots: 0, edited: 0, failures: 0 };
    const why = config.prerenderSpots <= 0 || config.prerenderEdits <= 0 ? 'turned off (PRERENDER_SPOTS or PRERENDER_EDITS is 0)' : !aiRenderEnabled() ? 'photo-real is not set up' : !config.chromePath ? 'Chrome not found (set CHROME_PATH)' : null;
    if (why) {
      this.save({ ...base, status: 'skipped', error: why });
      if (this.snapshots && config.chromePath) {
        this.snapshots.start(job.proposalId);
        void this.q.add(() => this.run(job, false));
      }
      return false;
    }
    const current = this.db.getPrerender(job.proposalId);
    if (current && (current.status === 'queued' || current.status === 'running')) return true;
    this.save({ ...base, status: 'queued', error: null });
    void this.q.add(() => this.run(job));
    return true;
  }

  /** The page address the hidden browser opens for a request (`photo`: also prepare its photo-real views). */
  async pageUrl(job: PrerenderJob, photo = true): Promise<string | null> {
    const tile = await ensureTile(job.areaId);
    if (!tile) return null;
    const scene = sceneIndex(tile);
    const focus = changeFocus(job.ops, scene);
    if (!focus) return null;
    const glb = /^https?:/.test(job.afterUrl) ? job.afterUrl : `${this.baseUrl()}${job.afterUrl}`;
    const q = streetViewQuery(glb, focus, job.ops, describeRequest(job.ops, scene));
    // Without photo-real: one spot, plain Street View, only for the snapshots.
    q.set('prepare', photo ? String(config.prerenderSpots) : '1');
    q.set('edits', String(config.prerenderEdits));
    if (!photo) q.set('photo', '0');
    if (this.snapshots) q.set('snaps', '1');
    // The sign-in goes after the #, so it never reaches a log.
    return `${this.baseUrl()}/streetview?${q}#token=${encodeURIComponent(config.prerenderSecret)}`;
  }

  private async run(job: PrerenderJob, photo = true) {
    const base = { proposalId: job.proposalId, areaId: job.areaId };
    const shots = this.snapshots;
    const sink: ShotSink | undefined = shots ? (kind, jpeg) => shots.save(job.proposalId, kind, jpeg) : undefined;
    if (!photo) {
      // Snapshots only: the request's photo-real status (skipped, and why) stays as it is.
      try {
        const url = await this.pageUrl(job, false);
        const r = url ? await this.launch(url, TIMEOUT_MS, sink) : { error: 'nowhere to look at this change from' };
        shots?.finish(job.proposalId, r.error && !/not set up|not asked/.test(r.error) ? r.error : undefined);
      } catch (err) {
        shots?.finish(job.proposalId, (err as Error).message.slice(0, 300));
      }
      return;
    }
    shots?.start(job.proposalId);
    this.save({ ...base, status: 'running', spots: 0, edited: 0, failures: 0, error: null });
    try {
      const url = await this.pageUrl(job);
      if (!url) {
        this.save({ ...base, status: 'skipped', spots: 0, edited: 0, failures: 0, error: 'nowhere to look at this change from' });
        shots?.finish(job.proposalId, 'nowhere to look at this change from');
        return;
      }
      const r = await this.launch(url, TIMEOUT_MS, sink);
      shots?.finish(job.proposalId, r.error);
      this.save({
        ...base,
        status: r.error ? 'failed' : 'done',
        spots: r.spots ?? 0,
        edited: r.edited ?? 0,
        failures: r.failures ?? 0,
        error: r.error ?? null,
      });
    } catch (err) {
      shots?.finish(job.proposalId, (err as Error).message.slice(0, 300));
      this.save({ ...base, status: 'failed', spots: 0, edited: 0, failures: 0, error: (err as Error).message.slice(0, 300) });
    }
  }
}

/**
 * A hidden Chrome (software WebGL, so it runs without a screen) that opens the page and waits for
 * its prepare run. If the tab dies part-way (it happens occasionally with software WebGL), it tries
 * once more in a fresh browser: edits already made are saved, so the retry only does what's left.
 */
const launchChrome: Launch = async (url, timeoutMs, shots) => {
  let last: PrepareResult = {};
  const taken = new Set<ShotKind>(); // a retry doesn't take the same pictures again
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await prepareOnce(url, timeoutMs, shots, taken);
    if (!last.error || /too long|not set up|limit/i.test(last.error)) return last;
    console.warn(`prerender attempt ${attempt} failed: ${last.error}`);
  }
  return last;
};

/** What the Street View page offers for snapshots (?snaps=1, see streetview.html). */
interface SnapApi {
  modelReady: boolean;
  firstSpot: { photo: boolean } | null;
  done: boolean;
  face: (zoom: number) => void;
  street: () => void;
  setMode: (m: string) => void;
  model3d: (view: string) => Promise<string>;
}
type SnapWindow = { __snap?: SnapApi };

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The 3D model from above and at an angle: drawn by the page itself, as JPEG. */
async function takeModelShots(page: Page, shots: ShotSink, taken: Set<ShotKind>) {
  for (const kind of ['top', 'angled'] as const) {
    if (taken.has(kind)) continue;
    const b64 = await page.evaluate((v) => (window as unknown as SnapWindow).__snap!.model3d(v), kind);
    await shots(kind, Buffer.from(b64, 'base64'));
    taken.add(kind);
  }
}

/**
 * Street View pictures at the spot nearest the change, once it's photo-real: facing the change,
 * closer in, down the street, and the same view before. Screenshots, so they show exactly what a
 * viewer sees. The page waits for these before it walks on to the next spot.
 */
async function takeStreetShots(page: Page, photo: boolean, shots: ShotSink, taken: Set<ShotKind>) {
  const face = (zoom: number) => page.evaluate((z) => (window as unknown as SnapWindow).__snap!.face(z), zoom);
  const shoot = async (kind: ShotKind) => {
    if (taken.has(kind)) return;
    await pause(2500); // Google's photo tiles for the new view
    await shots(kind, Buffer.from(await page.screenshot({ type: 'jpeg', quality: 78 })));
    taken.add(kind);
  };
  await page.evaluate(() => document.body.classList.add('snap'));
  try {
    if (photo) {
      await face(1);
      await shoot('after');
      await face(2);
      await shoot('closeup');
    }
    await page.evaluate(() => (window as unknown as SnapWindow).__snap!.street());
    await shoot('street');
    await page.evaluate(() => (window as unknown as SnapWindow).__snap!.setMode('before'));
    await face(1);
    await shoot('before');
  } finally {
    await page.evaluate(() => {
      document.body.classList.remove('snap');
      (window as unknown as SnapWindow).__snap!.done = true;
    });
  }
}

async function prepareOnce(url: string, timeoutMs: number, shots?: ShotSink, taken = new Set<ShotKind>()): Promise<PrepareResult> {
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: config.chromePath,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
  });
  let crashed: string | null = null;
  try {
    const page = await browser.newPage();
    page.on('error', (e) => (crashed = `page crashed: ${e.message}`));
    // 4:3, the shape of the snapshots (the photo-real edits themselves don't depend on it).
    await page.setViewport({ width: 960, height: 720 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Check every 2 s (one long wait would hit the browser connection's 3-minute command limit).
    const end = Date.now() + timeoutMs;
    let streetDone = false;
    for (;;) {
      if (crashed) return { error: crashed };
      if (shots) {
        const snap = await page.evaluate(() => {
          const s = (window as unknown as SnapWindow).__snap;
          return s ? { modelReady: s.modelReady, firstSpot: s.firstSpot } : null;
        });
        try {
          if (snap?.modelReady && !(taken.has('top') && taken.has('angled'))) await takeModelShots(page, shots, taken);
          if (snap?.firstSpot && !streetDone) {
            streetDone = true;
            await takeStreetShots(page, snap.firstSpot.photo, shots, taken);
          }
        } catch (err) {
          // A missed picture never stops the photo-real views being prepared.
          console.warn(`snapshot failed: ${(err as Error).message}`);
          streetDone = true;
          await page.evaluate(() => { const s = (window as unknown as SnapWindow).__snap; if (s) s.done = true; }).catch(() => {});
        }
      }
      const result = await page.evaluate(() => (window as unknown as { __prepared?: PrepareResult & { done: boolean } }).__prepared ?? null);
      if (result?.done) return result;
      if (Date.now() > end) return { error: 'preparing took too long' };
      await pause(2000);
    }
  } catch (err) {
    return { error: crashed ?? (err as Error).message.slice(0, 300) };
  } finally {
    await browser.close().catch(() => {});
  }
}
