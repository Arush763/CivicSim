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
import { changeFocus, describeRequest, streetViewQuery, type ChangeOp } from '@mamdani/shared';
import { config } from '../config';
import type { Db, PrerenderRow } from '../db';
import { ensureTile } from '../data/tiles';
import { sceneIndex } from '../scene/local';
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

/** Opens a page and waits for its prepare run to finish. Swapped out in tests. */
export type Launch = (url: string, timeoutMs: number) => Promise<PrepareResult>;

const TIMEOUT_MS = 20 * 60_000;

export class Prerenderer {
  private q = new PQueue({ concurrency: 1 });

  constructor(
    private db: Db,
    private launch: Launch = launchChrome,
    private baseUrl = () => `http://127.0.0.1:${config.port}`,
  ) {}

  get pending() {
    return this.q.size + this.q.pending;
  }

  onIdle() {
    return this.q.onIdle();
  }

  status(proposalId: string): PrerenderRow | null {
    return this.db.getPrerender(proposalId);
  }

  /** Queue a request for preparation. Returns false if photo-real isn't set up (nothing to prepare). */
  enqueue(job: PrerenderJob): boolean {
    const base = { proposalId: job.proposalId, areaId: job.areaId, spots: 0, edited: 0, failures: 0 };
    const why = config.prerenderSpots <= 0 ? 'turned off (PRERENDER_SPOTS=0)' : !aiRenderEnabled() ? 'photo-real is not set up' : !config.chromePath ? 'Chrome not found (set CHROME_PATH)' : null;
    if (why) {
      this.db.setPrerender({ ...base, status: 'skipped', error: why });
      return false;
    }
    const current = this.db.getPrerender(job.proposalId);
    if (current && (current.status === 'queued' || current.status === 'running')) return true;
    this.db.setPrerender({ ...base, status: 'queued', error: null });
    void this.q.add(() => this.run(job));
    return true;
  }

  /** The page address the hidden browser opens for a request. */
  async pageUrl(job: PrerenderJob): Promise<string | null> {
    const tile = await ensureTile(job.areaId);
    if (!tile) return null;
    const scene = sceneIndex(tile);
    const focus = changeFocus(job.ops, scene);
    if (!focus) return null;
    const glb = /^https?:/.test(job.afterUrl) ? job.afterUrl : `${this.baseUrl()}${job.afterUrl}`;
    const q = streetViewQuery(glb, focus, job.ops, describeRequest(job.ops, scene));
    q.set('prepare', String(config.prerenderSpots));
    // The sign-in goes after the #, so it never reaches a log.
    return `${this.baseUrl()}/streetview?${q}#token=${encodeURIComponent(config.prerenderSecret)}`;
  }

  private async run(job: PrerenderJob) {
    const base = { proposalId: job.proposalId, areaId: job.areaId };
    this.db.setPrerender({ ...base, status: 'running', spots: 0, edited: 0, failures: 0, error: null });
    try {
      const url = await this.pageUrl(job);
      if (!url) {
        this.db.setPrerender({ ...base, status: 'skipped', spots: 0, edited: 0, failures: 0, error: 'nowhere to look at this change from' });
        return;
      }
      const r = await this.launch(url, TIMEOUT_MS);
      this.db.setPrerender({
        ...base,
        status: r.error ? 'failed' : 'done',
        spots: r.spots ?? 0,
        edited: r.edited ?? 0,
        failures: r.failures ?? 0,
        error: r.error ?? null,
      });
    } catch (err) {
      this.db.setPrerender({ ...base, status: 'failed', spots: 0, edited: 0, failures: 0, error: (err as Error).message.slice(0, 300) });
    }
  }
}

/**
 * A hidden Chrome (software WebGL, so it runs without a screen) that opens the page and waits for
 * its prepare run. If the tab dies part-way (it happens occasionally with software WebGL), it tries
 * once more in a fresh browser: edits already made are saved, so the retry only does what's left.
 */
const launchChrome: Launch = async (url, timeoutMs) => {
  let last: PrepareResult = {};
  for (let attempt = 1; attempt <= 2; attempt++) {
    last = await prepareOnce(url, timeoutMs);
    if (!last.error || /too long|not set up/.test(last.error)) return last;
    console.warn(`prerender attempt ${attempt} failed: ${last.error}`);
  }
  return last;
};

async function prepareOnce(url: string, timeoutMs: number): Promise<PrepareResult> {
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
    await page.setViewport({ width: 1100, height: 700 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // Check every 2 s (one long wait would hit the browser connection's 3-minute command limit).
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (crashed) return { error: crashed };
      const result = await page.evaluate(() => (window as unknown as { __prepared?: PrepareResult & { done: boolean } }).__prepared ?? null);
      if (result?.done) return result;
      if (Date.now() > end) return { error: 'preparing took too long' };
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (err) {
    return { error: crashed ?? (err as Error).message.slice(0, 300) };
  } finally {
    await browser.close().catch(() => {});
  }
}
