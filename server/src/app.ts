import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { z, ZodError } from 'zod';
import { CHANGE_OP_LABELS, ChangeOp, DraftInput, DraftPatch, type AreaDetail, type ChangeOpType, type Draft } from '@mamdani/shared';
import { AiRenderError, aiRenderEnabled, ASPECTS, renderStreetView } from './ai/streetRender';
import { config } from './config';
import { estimate } from './cost/estimate';
import type { Db, DraftRow } from './db';
import { ensureTile, findArea, loadAreas, loadTile } from './data/tiles';
import { zoneIssues } from './data/zoneIssues';
import type { RenderQueue } from './queue/renderQueue';
import { cityInfo } from './scene/city';
import { localTile, sceneIndex } from './scene/local';
import { validateOpsForTile } from './scene/validate';
import * as sb from './supabase';
import type { Suggester } from './suggest/suggest';

export interface AppDeps {
  db: Db;
  queue: RenderQueue;
  suggester?: Suggester | null;
  logger?: boolean;
}

class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

const DEV_USER = 'dev-user';

export async function buildApp({ db, queue, suggester = null, logger = true }: AppDeps) {
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

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid request', details: err.issues });
    if (err instanceof AiRenderError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    app.log.error(err);
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
  });

  // ------------------------------------------------------------------ auth
  async function userFrom(token: string | undefined): Promise<string | null> {
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

  app.get('/areas', async () => loadAreas());

  /** Photo-real "after" of one Street View image (Gemini). The Street View page calls this when you stop moving. */
  app.get('/ai/status', async () => ({ enabled: aiRenderEnabled(), model: config.geminiImageModel }));
  app.post('/ai/render', { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    // Each render costs money, so only this server's own Street View page may ask for one.
    const from = req.headers.origin ?? req.headers.referer ?? '';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (!host || !from || new URL(from, 'http://x').host !== host) throw new HttpError(403, 'renders can only be requested from the Street View page');
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
      })
      .parse(req.body);
    return { url: await renderStreetView(body) };
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
    return result;
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

  app.post<{ Params: { id: string } }>('/local/proposals/:id/status', async (req) => {
    localOnly();
    const uid = await requireUser(req);
    const { status } = z.object({ status: z.enum(['submitted', 'under_review', 'accepted', 'rejected']) }).parse(req.body);
    const p = db.getLocalProposal(req.params.id);
    if (!p) throw new HttpError(404, 'request not found');
    return withVotes(db.updateLocalProposal(p.id as string, { status }), uid);
  });

  app.post<{ Params: { id: string } }>('/areas/:id/suggest', async (req) => {
    await requireUser(req);
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
