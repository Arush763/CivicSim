import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import type { ChangeOp, ProposalSource } from '@mamdani/shared';
import { config } from './config';

// node:sqlite is built in (Node 22.5+), so there is no native module to compile. Loaded via
// require because Vite (used by vitest) doesn't know it's a builtin yet and mangles the import.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as { DatabaseSync: typeof DatabaseSyncT };

export interface DraftRow {
  id: string;
  areaId: string;
  ownerId: string;
  title: string;
  description: string;
  ops: ChangeOp[];
  source: ProposalSource;
  renderHash: string | null;
  updatedAt: string;
}

export interface JobRow {
  hash: string;
  areaId: string;
  ops: ChangeOp[];
  status: string;
  error: string | null;
}

export function openDb(file = path.join(config.dataDir, 'server.sqlite')) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists drafts (
      id text primary key,
      area_id text not null,
      owner_id text not null,
      title text not null,
      description text not null default '',
      ops text not null,
      source text not null,
      render_hash text,
      updated_at text not null
    );
    create index if not exists drafts_owner on drafts(owner_id, updated_at);
    create table if not exists render_jobs (
      hash text primary key,
      area_id text not null,
      ops text not null,
      status text not null,
      error text,
      updated_at text not null
    );
    -- Proposals confirmed while Supabase isn't configured (local-only dev mode).
    create table if not exists local_proposals (
      id text primary key,
      body text not null,
      created_at text not null
    );
    create table if not exists local_votes (
      proposal_id text not null,
      user_id text not null,
      value integer not null check (value in (-1, 1)),
      primary key (proposal_id, user_id)
    );
    -- Photo-real renders that reached Gemini, per day and person, so the daily limit survives restarts.
    create table if not exists ai_renders (
      day text not null,
      user_id text not null,
      count integer not null,
      primary key (day, user_id)
    );
    -- Photo-real views prepared ahead of time for each request (the images themselves are in cache/ai).
    create table if not exists prerenders (
      proposal_id text primary key,
      area_id text not null,
      status text not null,
      spots integer not null default 0,
      edited integer not null default 0,
      failures integer not null default 0,
      error text,
      updated_at text not null
    );
  `);

  const toDraft = (r: Record<string, unknown>): DraftRow => ({
    id: r.id as string,
    areaId: r.area_id as string,
    ownerId: r.owner_id as string,
    title: r.title as string,
    description: r.description as string,
    ops: JSON.parse(r.ops as string),
    source: r.source as ProposalSource,
    renderHash: (r.render_hash as string) ?? null,
    updatedAt: r.updated_at as string,
  });

  const q = {
    getDraft: db.prepare('select * from drafts where id = ?'),
    listDrafts: db.prepare('select * from drafts where owner_id = ? and (? is null or area_id = ?) order by updated_at desc'),
    upsertDraft: db.prepare(`
      insert into drafts (id, area_id, owner_id, title, description, ops, source, render_hash, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set title = excluded.title, description = excluded.description, ops = excluded.ops,
        source = excluded.source, render_hash = excluded.render_hash, updated_at = excluded.updated_at`),
    deleteDraft: db.prepare('delete from drafts where id = ?'),
    getJob: db.prepare('select * from render_jobs where hash = ?'),
    upsertJob: db.prepare(`
      insert into render_jobs (hash, area_id, ops, status, error, updated_at) values (?, ?, ?, ?, ?, ?)
      on conflict(hash) do update set status = excluded.status, error = excluded.error, updated_at = excluded.updated_at`),
    unfinishedJobs: db.prepare(`select * from render_jobs where status in ('queued', 'building', 'lod_ready')`),
    insertLocalProposal: db.prepare('insert into local_proposals (id, body, created_at) values (?, ?, ?)'),
    getLocalProposal: db.prepare('select body from local_proposals where id = ?'),
    updateLocalProposal: db.prepare('update local_proposals set body = ? where id = ?'),
    voteCounts: db.prepare(`select coalesce(sum(value = 1), 0) as confirms, coalesce(sum(value = -1), 0) as denies from local_votes where proposal_id = ?`),
    myVote: db.prepare('select value from local_votes where proposal_id = ? and user_id = ?'),
    upsertVote: db.prepare('insert into local_votes (proposal_id, user_id, value) values (?, ?, ?) on conflict(proposal_id, user_id) do update set value = excluded.value'),
    deleteVote: db.prepare('delete from local_votes where proposal_id = ? and user_id = ?'),
    aiRendersOn: db.prepare('select coalesce(sum(count), 0) as n from ai_renders where day = ?'),
    getPrerender: db.prepare('select * from prerenders where proposal_id = ?'),
    upsertPrerender: db.prepare(`
      insert into prerenders (proposal_id, area_id, status, spots, edited, failures, error, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(proposal_id) do update set status = excluded.status, spots = excluded.spots, edited = excluded.edited,
        failures = excluded.failures, error = excluded.error, updated_at = excluded.updated_at`),
    addAiRender: db.prepare('insert into ai_renders (day, user_id, count) values (?, ?, 1) on conflict(day, user_id) do update set count = count + 1'),
    listLocalProposals: db.prepare('select body from local_proposals where (? is null or json_extract(body, \'$.area_id\') = ?) order by created_at desc'),
  };

  const now = () => new Date().toISOString();

  return {
    raw: db,
    getDraft(id: string): DraftRow | null {
      const r = q.getDraft.get(id) as Record<string, unknown> | undefined;
      return r ? toDraft(r) : null;
    },
    listDrafts(ownerId: string, areaId: string | null): DraftRow[] {
      return (q.listDrafts.all(ownerId, areaId, areaId) as Record<string, unknown>[]).map(toDraft);
    },
    saveDraft(d: Omit<DraftRow, 'updatedAt'>): DraftRow {
      const updatedAt = now();
      q.upsertDraft.run(d.id, d.areaId, d.ownerId, d.title, d.description, JSON.stringify(d.ops), d.source, d.renderHash, updatedAt);
      return { ...d, updatedAt };
    },
    deleteDraft(id: string) {
      q.deleteDraft.run(id);
    },
    getJob(hash: string): JobRow | null {
      const r = q.getJob.get(hash) as Record<string, unknown> | undefined;
      return r ? { hash: r.hash as string, areaId: r.area_id as string, ops: JSON.parse(r.ops as string), status: r.status as string, error: (r.error as string) ?? null } : null;
    },
    setJob(hash: string, areaId: string, ops: ChangeOp[], status: string, error: string | null = null) {
      q.upsertJob.run(hash, areaId, JSON.stringify(ops), status, error, now());
    },
    unfinishedJobs(): JobRow[] {
      return (q.unfinishedJobs.all() as Record<string, unknown>[]).map((r) => ({
        hash: r.hash as string, areaId: r.area_id as string, ops: JSON.parse(r.ops as string), status: r.status as string, error: null,
      }));
    },
    insertLocalProposal(id: string, body: Record<string, unknown>) {
      q.insertLocalProposal.run(id, JSON.stringify(body), now());
    },
    listLocalProposals(areaId: string | null): Record<string, unknown>[] {
      return (q.listLocalProposals.all(areaId, areaId) as { body: string }[]).map((r) => JSON.parse(r.body));
    },
    getLocalProposal(id: string): Record<string, unknown> | null {
      const r = q.getLocalProposal.get(id) as { body: string } | undefined;
      return r ? JSON.parse(r.body) : null;
    },
    updateLocalProposal(id: string, patch: Record<string, unknown>): Record<string, unknown> {
      const body = { ...(JSON.parse((q.getLocalProposal.get(id) as { body: string }).body) as Record<string, unknown>), ...patch };
      q.updateLocalProposal.run(JSON.stringify(body), id);
      return body;
    },
    localVoteCounts(proposalId: string): { confirm_count: number; deny_count: number } {
      const r = q.voteCounts.get(proposalId) as { confirms: number; denies: number };
      return { confirm_count: Number(r.confirms), deny_count: Number(r.denies) };
    },
    localMyVote(proposalId: string, userId: string): number {
      return (q.myVote.get(proposalId, userId) as { value: number } | undefined)?.value ?? 0;
    },
    setLocalVote(proposalId: string, userId: string, value: -1 | 0 | 1) {
      if (value === 0) q.deleteVote.run(proposalId, userId);
      else q.upsertVote.run(proposalId, userId, value);
    },
    /** Photo-real renders started on a day (YYYY-MM-DD, UTC), by everyone. */
    aiRendersOn(day: string): number {
      return Number((q.aiRendersOn.get(day) as { n: number }).n);
    },
    addAiRender(day: string, userId: string) {
      q.addAiRender.run(day, userId);
    },
    getPrerender(proposalId: string): PrerenderRow | null {
      const r = q.getPrerender.get(proposalId) as Record<string, unknown> | undefined;
      return r
        ? { proposalId: r.proposal_id as string, areaId: r.area_id as string, status: r.status as PrerenderRow['status'], spots: Number(r.spots),
            edited: Number(r.edited), failures: Number(r.failures), error: (r.error as string) ?? null, updatedAt: r.updated_at as string }
        : null;
    },
    setPrerender(p: Omit<PrerenderRow, 'updatedAt'>) {
      q.upsertPrerender.run(p.proposalId, p.areaId, p.status, p.spots, p.edited, p.failures, p.error, new Date().toISOString());
    },
  };
}

export type Db = ReturnType<typeof openDb>;

export interface PrerenderRow {
  proposalId: string;
  areaId: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  /** Street View spots prepared, and how many directions were edited across them. */
  spots: number;
  edited: number;
  failures: number;
  error: string | null;
  updatedAt: string;
}
