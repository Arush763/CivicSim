import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z, ZodError } from 'zod';
import { CHANGE_OP_LABELS, ChangeOp, DraftInput, DraftPatch, zoneBbox, type AreaDetail, type ChangeOpType, type Draft } from '@mamdani/shared';
import type { Prerenderer } from './ai/prerender';
import type { SnapshotStore } from './ai/snapshots';
import { AiRenderError, aiProvider, aiRenderEnabled, ASPECTS, renderStreetView } from './ai/streetRender';
import { config } from './config';
import { estimate } from './cost/estimate';
import type { Db, DraftRow } from './db';
import { ensureTile, findArea, loadAreas, loadTile } from './data/tiles';
import { zoneIssues } from './data/zoneIssues';
import { zoneTerrain } from './data/terrain';
import type { RenderQueue } from './queue/renderQueue';
import { cityInfo } from './scene/city';
import { localTile, sceneIndex } from './scene/local';
import { validateOpsForTile } from './scene/validate';
import * as sb from './supabase';
import type { Suggester } from './suggest/suggest';

export interface AppDeps {
  db: Db;
  queue: RenderQueue;
  /** Prepares photo-real views as soon as a request comes in (optional). */
  prerender?: Prerenderer | null;
  /** Petition snapshots taken while preparing (optional). */
  snapshots?: SnapshotStore | null;
  suggester?: Suggester | null;
  logger?: boolean;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const DEV_USER = 'dev-user';

export async function buildApp({ db, queue, prerender = null, snapshots = null, suggester = null, logger = true }: AppDeps) {
  // Request logs never include API keys, even if a client puts one in a URL.
  const hideKeys = (url: string) => url.replace(/([?&](?:key|token)=)[^&]*/gi, '$1[hidden]');
  const loggerOptions: FastifyServerOptions['logger'] = logger
    ? { serializers: { req: (req: FastifyRequest) => ({ method: req.method, url: hideKeys(req.url), remoteAddress: req.ip }) } }
    : false;
  const app = Fastify({ logger: loggerOptions, bodyLimit: 6 * 1024 * 1024 });
  await app.register(cors, { origin: true });
  await app.register(websocket);
  const tilesRoot = path.join(config.cacheDir, 'tiles');
  mkdirSync(tilesRoot, { recursive: true }); // fastify-static requires the root to exist
  await app.register(fastifyStatic, {
    root: tilesRoot,
    prefix: '/tiles/',
    serve: true,
    decorateReply: false,
    // Render files are content-addressed by hash, so they never change.
    maxAge: '365d',
    immutable: true,
    preCompressed: true, // serves city-v*.glb.gz when the client accepts gzip
  });

  const aiRoot = path.join(config.cacheDir, 'ai');
  mkdirSync(aiRoot, { recursive: true });
  await app.register(fastifyStatic, { root: aiRoot, prefix: '/ai/', decorateReply: false, maxAge: '365d', immutable: true });

  // Petition snapshots (see ai/snapshots.ts). A retaken picture keeps its name, so only cache briefly.
  const snapRoot = path.join(config.cacheDir, 'snapshots');
  mkdirSync(snapRoot, { recursive: true });
  await app.register(fastifyStatic, { root: snapRoot, prefix: '/snapshots/', decorateReply: false, maxAge: '10m', allowedPath: (p) => p.endsWith('.jpg') });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid request', details: err.issues });
    if (err instanceof AiRenderError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    app.log.error(err);
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
  });

  // ------------------------------------------------------------------ auth
  async function userFrom(token: string | undefined): Promise<string | null> {
    // The server's own hidden browser, preparing photo-real views (see ai/prerender.ts).
    if (token && token === config.prerenderSecret) return 'system:prerender';
    if (!config.supabaseEnabled) return token || DEV_USER; // local-only dev mode
    return token ? sb.userIdForToken(token) : null;
  }
  async function requireUser(req: FastifyRequest): Promise<string> {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-dev-user'] as string | undefined);
    const uid = await userFrom(token);
    if (!uid) throw new HttpError(401, 'sign in required');
    return uid;
  }
  /** Typed on this computer, not forwarded by ngrok or another proxy (they add X-Forwarded-For). */
  const fromThisComputer = (req: FastifyRequest) =>
    !req.headers['x-forwarded-for'] && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  /**
   * City admins use the panel on this computer; phones only make requests. AI (ideas and new
   * photo-real edits) and decisions on requests are admin-only.
   */
  async function isAdmin(uid: string, req: FastifyRequest): Promise<boolean> {
    if (uid === 'system:prerender') return true;
    if (!config.adminRemote && !fromThisComputer(req)) return false;
    if (!config.supabaseEnabled) return true; // local-only mode: whoever is at this computer runs the panel
    return sb.isAdmin(uid);
  }
  async function requireAdmin(req: FastifyRequest, what: string): Promise<string> {
    const uid = await requireUser(req);
    if (!(await isAdmin(uid, req))) throw new HttpError(403, `${what} is only available in the city admin panel`);
    return uid;
  }

  // ------------------------------------------------------------------ helpers
  const tileOr404 = (areaId: string) => {
    const t = loadTile(areaId);
    if (!t) throw new HttpError(404, `unknown area ${areaId}`);
    return t;
  };
  /** Like tileOr404, but fetches a worldwide zone from OpenStreetMap the first time it's opened. */
  const ensure = async (areaId: string) => {
    try {
      const t = await ensureTile(areaId);
      if (t) return t;
    } catch (err) {
      app.log.warn({ err, areaId }, 'zone fetch failed');
      throw new HttpError(503, 'Map data for this zone could not be loaded right now (OpenStreetMap is busy). Try again in a minute.');
    }
    throw new HttpError(404, `unknown area ${areaId}`);
  };
  const checkOps = (areaId: string, ops: ChangeOp[]) => {
    const errors = validateOpsForTile(ops, tileOr404(areaId));
    if (errors.length) throw new HttpError(422, 'ops do not fit this area', errors);
  };
  const toDto = (d: DraftRow): Draft => ({
    id: d.id,
    areaId: d.areaId,
    title: d.title,
    description: d.description,
    ops: d.ops,
    source: d.source,
    cost: estimate(d.ops, localTile(tileOr404(d.areaId))),
    render: queue.info(d.areaId, d.ops),
    updatedAt: d.updatedAt,
  });
  const ownDraft = (id: string, uid: string) => {
    const d = db.getDraft(id);
    if (!d || d.ownerId !== uid) throw new HttpError(404, 'draft not found');
    return d;
  };

  // ------------------------------------------------------------------ routes
  app.post<{ Params: { id: string } }>('/proposals/:id/process', async (req) => {
    await requireAdmin(req, 'Retrying request processing');
    if (!config.supabaseEnabled) throw new HttpError(503, 'Cloud processing needs Supabase');
    const { data, error } = await sb.supabase().rpc('retry_cloud_request', { p_id: z.string().uuid().parse(req.params.id) });
    if (error) throw new HttpError(400, error.message);
    return { queued: data };
  });
  app.get('/health', async () => ({
    ok: true,
    mode: config.supabaseEnabled ? 'supabase' : 'local-only',
    suggestions: !!suggester,
    areas: loadAreas().length,
    queue: queue.pending,
  }));

  /** Desktop scene preview for checking renders without the phone. */
  const previewHtml = fileURLToPath(new URL('../public/preview.html', import.meta.url));
  app.get('/preview', async (_req, reply) => reply.type('text/html').send(readFileSync(previewHtml)));

  /**
   * Street View before/after: Google's panorama with a request's 3D model drawn into it. A
   * standalone page so the browser app (iframe) and phones (WebView) share one implementation.
   */
  const streetViewHtml = fileURLToPath(new URL('../public/streetview.html', import.meta.url));
  app.get('/streetview', async (_req, reply) => {
    // The Maps key is written into the page here so it never travels in a URL (or a log line).
    const html = readFileSync(streetViewHtml, 'utf8').replace("/*MAPS_KEY*/''", JSON.stringify(config.googleMapsBrowserKey));
    return reply.type('text/html').header('cache-control', 'no-store').send(html);
  });

  /** A request's 3D model for the phone app's "3D model" tab (a WebView, like /streetview). */
  const modelHtml = fileURLToPath(new URL('../public/model.html', import.meta.url));
  app.get('/model', async (_req, reply) => reply.type('text/html').header('cache-control', 'no-store').send(readFileSync(modelHtml)));

  app.get('/areas', async () => loadAreas());

  /** Ground heights around a zone (open terrain data), so Street View overlays follow hills. */
  app.get<{ Params: { id: string } }>('/terrain/:id', async (req, reply) => {
    try {
      const t = await zoneTerrain(req.params.id);
      return reply.header('cache-control', 'public, max-age=86400').send(t);
    } catch (err) {
      app.log.warn({ err }, 'terrain failed');
      throw new HttpError(503, 'terrain data is unavailable right now');
    }
  });

  /** The request's model is identified by its path, so the browser (localhost) and phones (ngrok) agree. */
  const modelPath = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

  /**
   * Every photo-real edit made for a request (by its model), grouped by Street View spot. The page
   * loads the whole zone's edits from this, so walking around never waits for an edit to be made.
   */
  app.get<{ Querystring: { model?: string } }>('/ai/edits', async (req) => {
    const model = z.string().min(1).max(500).parse(req.query.model);
    const spots: Record<string, { heading: number; pitch: number; fov: number; ops: string[]; url: string; at: [number, number] | null }[]> = {};
    for (const { pano, model: _m, ...e } of db.aiEdits(modelPath(model))) (spots[pano] ??= []).push(e);
    return { spots };
  });

  /** A zone's box [west, south, east, north]: the Street View page keeps you inside it. */
  app.get<{ Params: { id: string } }>('/areas/:id/bbox', async (req) => {
    const bbox = zoneBbox(req.params.id) ?? loadTile(req.params.id)?.bbox;
    if (!bbox) throw new HttpError(404, `unknown area ${req.params.id}`);
    return { bbox };
  });

  /** Photo-real "after" of one Street View image (Gemini). The Street View page calls this when you stop moving. */
  app.get('/ai/status', async (req) => {
    // canGenerate: this viewer may make new edits; everyone else only sees ones already prepared.
    const h = req.headers.authorization;
    const uid = await userFrom(h?.startsWith('Bearer ') ? h.slice(7) : undefined).catch(() => null);
    return { enabled: aiRenderEnabled(), provider: aiProvider(), canGenerate: !!uid && (await isAdmin(uid, req).catch(() => false)) };
  });
  app.post('/ai/render', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    // Each render costs money, so only this server's own Street View page may ask for one.
    const from = req.headers.origin ?? req.headers.referer ?? '';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (!host || !from || new URL(from, 'http://x').host !== host) throw new HttpError(403, 'renders can only be requested from the Street View page');
    // The Origin header can be faked outside a browser, so a signed-in person is required too.
    const uid = await requireUser(req);
    const body = z
      .object({
        pano: z.string().min(5).max(200),
        heading: z.number(),
        pitch: z.number(),
        fov: z.number().min(5).max(130),
        aspect: z.enum(Object.keys(ASPECTS) as [keyof typeof ASPECTS]),
        guide: z.string().max(6_000_000),
        ops: z.array(z.enum(Object.keys(CHANGE_OP_LABELS) as [ChangeOpType])).min(1),
        desc: z.string().max(2000),
        model: z.string().max(500),
        setting: z.enum(['urban', 'suburban', 'rural']).default('urban'),
        reference: z.string().max(200).optional(),
        /** Where the photo was taken [lng, lat], so viewers can preload the edits around them. */
        at: z.tuple([z.number(), z.number()]).optional(),
      })
      .parse(req.body);
    const url = await renderStreetView(body, uid, db, fetch, { savedOnly: !(await isAdmin(uid, req)) });
    db.addAiEdit({ model: modelPath(body.model), pano: body.pano, heading: body.heading, pitch: body.pitch, fov: body.fov, ops: body.ops, url, at: body.at ?? null });
    return { url };
  });

  /** The low-detail 3D map of the whole pilot area, plus where each zone and neighbourhood sits on it. */
  app.get('/city', async () => cityInfo());

  app.get<{ Params: { id: string } }>('/areas/:id', async (req): Promise<AreaDetail> => {
    const tile = await ensure(req.params.id);
    const area = findArea(tile.id)!;
    const issues = await zoneIssues(tile.id, tile.bbox);
    return {
      ...area,
      ...issues,
      issueTotal: issues.issues.reduce((t, i) => t + i.count, 0),
      before: queue.info(tile.id, []),
      scene: sceneIndex(tile),
    };
  });

  app.post('/estimate', async (req) => {
    const body = z.object({ areaId: z.string(), ops: z.array(ChangeOp).max(50) }).parse(req.body);
    await ensure(body.areaId);
    checkOps(body.areaId, body.ops);
    return estimate(body.ops, localTile(tileOr404(body.areaId)));
  });

  app.get<{ Querystring: { areaId?: string } }>('/drafts', async (req) => {
    const uid = await requireUser(req);
    return db.listDrafts(uid, req.query.areaId ?? null).map(toDto);
  });

  app.post('/drafts', async (req, reply) => {
    const uid = await requireUser(req);
    const input = DraftInput.parse(req.body);
    await ensure(input.areaId);
    checkOps(input.areaId, input.ops);
    const row = db.saveDraft({ id: randomUUID(), ownerId: uid, renderHash: null, ...input });
    queue.requestForDraft(row.id, row.areaId, row.ops);
    return reply.status(201).send(toDto(row));
  });

  app.get<{ Params: { id: string } }>('/drafts/:id', async (req) => toDto(ownDraft(req.params.id, await requireUser(req))));

  app.patch<{ Params: { id: string } }>('/drafts/:id', async (req) => {
    const uid = await requireUser(req);
    const d = ownDraft(req.params.id, uid);
    const patch = DraftPatch.parse(req.body);
    await ensure(d.areaId);
    if (patch.ops) checkOps(d.areaId, patch.ops);
    // Editing an AI suggestion makes it the person's own proposal; keep the label only if untouched.
    const row = db.saveDraft({ ...d, ...patch, source: patch.source ?? d.source });
    if (patch.ops) queue.requestForDraft(row.id, row.areaId, row.ops);
    return toDto(row);
  });

  app.delete<{ Params: { id: string } }>('/drafts/:id', async (req, reply) => {
    const d = ownDraft(req.params.id, await requireUser(req));
    db.deleteDraft(d.id);
    queue.forgetDraft(d.id);
    return reply.status(204).send();
  });

  /**
   * A person confirms their draft. Only now does anything leave the PC: renders go to
   * Supabase Storage and the proposal row is created. In local-only mode it's kept in SQLite.
   */
  app.post<{ Params: { id: string } }>('/drafts/:id/confirm', async (req) => {
    const uid = await requireUser(req);
    const d = ownDraft(req.params.id, uid);
    const { thumbnailPng } = z.object({ thumbnailPng: z.string().max(5_000_000).optional() }).parse(req.body ?? {});
    if (d.ops.length === 0) throw new HttpError(422, 'add at least one change before submitting');
    await ensure(d.areaId);
    checkOps(d.areaId, d.ops);

    // Usually already rendered in the background; if not, this jumps the queue.
    const after = await queue.renderNow(d.areaId, d.ops, d.id);
    if (after.status !== 'done') throw new HttpError(500, 'render failed', { after });
    const cost = estimate(d.ops, localTile(tileOr404(d.areaId)));

    let result: { proposalId: string; mode: 'supabase' | 'local-only'; afterUrls: string[]; thumbUrl: string | null };
    if (config.supabaseEnabled) {
      const afterUrls = await sb.uploadRender(d.areaId, after.hash);
      await sb.upsertArea(findArea(d.areaId)!); // proposals reference areas; worldwide zones are added as they're used
      const thumbUrl = thumbnailPng ? await sb.uploadThumbnail(d.areaId, after.hash, Buffer.from(thumbnailPng, 'base64')) : null;
      const { id } = await sb.insertProposal({
        area_id: d.areaId,
        author_id: uid,
        title: d.title,
        description: d.description,
        ops: d.ops,
        cost,
        source: d.source,
        before_url: null,
        after_url: afterUrls[0],
        thumb_url: thumbUrl,
      });
      result = { proposalId: id, mode: 'supabase', afterUrls, thumbUrl };
    } else {
      const id = randomUUID();
      db.insertLocalProposal(id, {
        id, area_id: d.areaId, author_id: uid, title: d.title, description: d.description, ops: d.ops, cost,
        source: d.source, status: 'submitted', before_url: null, after_url: after.lods[0], thumb_url: null,
        created_at: new Date().toISOString(),
      });
      result = { proposalId: id, mode: 'local-only', afterUrls: after.lods, thumbUrl: null };
    }
    db.deleteDraft(d.id);
    queue.forgetDraft(d.id);
    // Build the photo-real views now, in the background, so they're ready before anyone opens it.
    prerender?.enqueue({ proposalId: result.proposalId, areaId: d.areaId, ops: d.ops, afterUrl: result.afterUrls[0] });
    return result;
  });

  /** How far along a request's ahead-of-time photo-real views are. */
  app.get<{ Params: { id: string } }>('/proposals/:id/prerender', async (req) => prerender?.status(req.params.id) ?? { status: 'none' });

  /** The still pictures of a request that its petition can show (they arrive while it's prepared). */
  app.get<{ Params: { id: string } }>('/proposals/:id/snapshots', async (req) => snapshots?.get(req.params.id) ?? { status: 'none', shots: [] });

  /** Prepare (or re-prepare) a request's photo-real views, e.g. for requests made before this existed. */
  app.post<{ Params: { id: string } }>('/proposals/:id/prerender', async (req) => {
    await requireAdmin(req, 'Preparing photo-real views');
    if (!prerender) throw new HttpError(503, 'preparing photo-real views is not available on this server');
    const p = config.supabaseEnabled ? await sb.getProposal(req.params.id) : (db.getLocalProposal(req.params.id) as { id: string; area_id: string; ops: ChangeOp[]; after_url: string } | null);
    if (!p) throw new HttpError(404, 'request not found');
    prerender.enqueue({ proposalId: p.id, areaId: p.area_id, ops: p.ops, afterUrl: p.after_url });
    return prerender.status(p.id);
  });

  // ------------------------------------------------------------------ local-only mode
  // Until Supabase is connected, submitted requests, confirm/deny votes and the admin decision
  // live on the PC so the whole flow can be tested. Everyone is the same dev user, who is also
  // treated as the admin.
  const localOnly = () => {
    if (config.supabaseEnabled) throw new HttpError(404, 'local-only mode is off; use Supabase');
  };
  const withVotes = (p: Record<string, unknown>, uid: string | null) => ({
    ...p,
    ...db.localVoteCounts(p.id as string),
    my_vote: uid ? db.localMyVote(p.id as string, uid) : 0,
  });

  app.get<{ Querystring: { areaId?: string } }>('/local/proposals', async (req) => {
    localOnly();
    const uid = await userFrom(req.headers.authorization?.slice(7));
    return db.listLocalProposals(req.query.areaId ?? null).map((p) => withVotes(p, uid));
  });

  app.post<{ Params: { id: string } }>('/local/proposals/:id/vote', async (req) => {
    localOnly();
    const uid = await requireUser(req);
    const { value } = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).parse(req.body);
    const p = db.getLocalProposal(req.params.id);
    if (!p) throw new HttpError(404, 'request not found');
    db.setLocalVote(p.id as string, uid, value);
    return withVotes(p, uid);
  });


  /** A city admin's decision on a request. Only from the admin panel on this computer. */
  app.post<{ Params: { id: string } }>('/proposals/:id/status', async (req) => {
    const uid = await requireAdmin(req, 'Deciding on requests');
    const { status } = z.object({ status: z.enum(['submitted', 'under_review', 'accepted', 'rejected']) }).parse(req.body);
    if (config.supabaseEnabled) {
      await sb.setProposalStatus(req.params.id, status);
      return { id: req.params.id, status };
    }
    const p = db.getLocalProposal(req.params.id);
    if (!p) throw new HttpError(404, 'request not found');
    return withVotes(db.updateLocalProposal(p.id as string, { status }), uid);
  });

  app.post<{ Params: { id: string } }>('/areas/:id/suggest', async (req) => {
    await requireAdmin(req, 'AI ideas');
    if (!suggester) throw new HttpError(503, 'AI suggestions are not configured (set ANTHROPIC_API_KEY)');
    const tile = await ensure(req.params.id);
    return suggester.suggest(tile, (await zoneIssues(tile.id, tile.bbox)).issues);
  });

  // ------------------------------------------------------------------ live render progress
  app.get<{ Querystring: { token?: string } }>('/ws', { websocket: true }, async (socket, req) => {
    const uid = await userFrom(req.query.token);
    if (!uid) return socket.close(4401, 'sign in required');
    const listener = (e: import('@mamdani/shared').RenderEvent) => {
      // Background renders with no draft are public; draft progress only goes to the draft's owner.
      if (e.draftId && db.getDraft(e.draftId)?.ownerId !== uid) return;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e));
    };
    queue.on('render', listener);
    socket.on('close', () => queue.off('render', listener));
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
