import { ChangeOp, zoneBbox } from '@mamdani/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type LocalProposal } from './api';
import { DEV_USER, useAuth } from './auth';
import { NEAR_KM } from './config';
import { supabase } from './supabase';

export interface Petition {
  id: string;
  goal: number;
  signature_count: number;
  status: 'open' | 'goal_reached' | 'closed';
  reason: string;
  snapshots: string[];
  created_at: string;
}

/** A request as the app shows it: the proposal, its author and petition, and where its zone is. */
export interface Proposal extends LocalProposal {
  processing_status?: 'queued' | 'running' | 'ready' | 'failed';
  processing_error?: string | null;
  author?: { username: string; rank: string } | null;
  petition?: Petition | null;
  snapshots?: { kind: string; label: string; url: string }[];
  photo_status?: string;
  score?: number;
  hot?: number;
  lng?: number | null;
  lat?: number | null;
  area_name?: string | null;
}

export type FeedSort = 'hot' | 'new' | 'top' | 'pet';
export interface Near {
  lng: number;
  lat: number;
  km?: number;
}

/** Reddit's "hot": net votes on a log scale plus a steady climb for newer posts (same as the database's hot_score). */
export function hotScore(score: number, createdAt: string) {
  return Math.sign(score) * Math.log10(Math.max(Math.abs(score), 1)) + (Date.parse(createdAt) / 1000 - 1134028003) / 45000;
}

export const netScore = (p: Pick<Proposal, 'confirm_count' | 'deny_count'>) => p.confirm_count - p.deny_count;

// In local-only mode everyone is the same dev user.
const local = api(async () => DEV_USER);
const proposalRow = (p: Proposal): Proposal => {
  const parsed = ChangeOp.array().max(50).safeParse(p.ops);
  return { ...p, ops: parsed.success ? parsed.data : [], cost: p.cost && Array.isArray(p.cost.items) ? p.cost : null };
};

/** Local-only rows, filled in like the Supabase feed view (zone centre, hot score). */
function localRow(p: LocalProposal): Proposal {
  const b = zoneBbox(p.area_id);
  const score = netScore(p);
  return { ...p, score, hot: hotScore(score, p.created_at), lng: b ? (b[0] + b[2]) / 2 : null, lat: b ? (b[1] + b[3]) / 2 : null, petition: null, author: null };
}

const isNear = (p: Proposal, near: Near) => {
  if (p.lat == null || p.lng == null) return false;
  const km = near.km ?? NEAR_KM;
  return Math.abs(p.lat - near.lat) * 111.195 <= km && Math.abs(p.lng - near.lng) * 111.195 * Math.cos((near.lat * Math.PI) / 180) <= km;
};

function sortRows(rows: Proposal[], sort: FeedSort) {
  const by = {
    hot: (a: Proposal, b: Proposal) => (b.hot ?? 0) - (a.hot ?? 0),
    new: (a: Proposal, b: Proposal) => Date.parse(b.created_at) - Date.parse(a.created_at),
    top: (a: Proposal, b: Proposal) => netScore(b) - netScore(a),
    pet: (a: Proposal, b: Proposal) => (b.hot ?? 0) - (a.hot ?? 0),
  }[sort];
  return rows.sort(by);
}

/** The Feed: requests near a place (or everywhere), sorted Hot / New / Top, or only those with petitions. */
export async function fetchFeed({ sort, near }: { sort: FeedSort; near?: Near | null }): Promise<Proposal[]> {
  if (!supabase) {
    let rows = (await local.localProposals()).map(localRow);
    if (near) rows = rows.filter((p) => isNear(p, near));
    if (sort === 'pet') rows = rows.filter((p) => p.petition);
    return sortRows(rows, sort);
  }
  let q = supabase.from('proposal_feed').select('*').limit(60);
  if (near) {
    const km = near.km ?? NEAR_KM;
    const dLat = km / 111.195;
    const dLng = km / (111.195 * Math.cos((near.lat * Math.PI) / 180));
    q = q.gte('lat', near.lat - dLat).lte('lat', near.lat + dLat).gte('lng', near.lng - dLng).lte('lng', near.lng + dLng);
  }
  if (sort === 'pet') q = q.not('petition', 'is', null);
  q = sort === 'new' ? q.order('created_at', { ascending: false }) : sort === 'top' ? q.order('score', { ascending: false }) : q.order('hot', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data as Proposal[]).map(proposalRow);
}

/** Every request (lightly), for tinting zones on the map. */
export async function fetchAllRequests(): Promise<Proposal[]> {
  if (!supabase) return (await local.localProposals()).map(localRow);
  const { data, error } = await supabase.from('proposal_feed').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return (data as Proposal[]).map(proposalRow);
}

export async function fetchZoneRequests(areaId: string): Promise<Proposal[]> {
  if (!supabase) return (await local.localProposals(areaId)).map(localRow);
  const { data, error } = await supabase.from('proposal_feed').select('*').eq('area_id', areaId).order('score', { ascending: false });
  if (error) throw error;
  return (data as Proposal[]).map(proposalRow);
}

export async function fetchProposal(id: string): Promise<Proposal | null> {
  if (!supabase) {
    const row = (await local.localProposals()).find((p) => p.id === id);
    return row ? localRow(row) : null;
  }
  const { data, error } = await supabase.from('proposal_feed').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? proposalRow(data as Proposal) : null;
}

/** Your votes on these requests (-1, 0, 1). */
export async function fetchMyVotes(rows: Proposal[], userId: string | null): Promise<Record<string, number>> {
  if (!supabase) return Object.fromEntries(rows.map((r) => [r.id, r.my_vote ?? 0]));
  if (!userId || !rows.length) return {};
  const { data, error } = await supabase.from('proposal_votes').select('proposal_id, value').eq('user_id', userId).in('proposal_id', rows.map((r) => r.id));
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((v) => [v.proposal_id as string, v.value as number]));
}

export async function setVote(proposalId: string, userId: string, value: -1 | 0 | 1) {
  if (!supabase) {
    await local.localVote(proposalId, value);
    return;
  }
  const q = value === 0
    ? supabase.from('proposal_votes').delete().eq('proposal_id', proposalId).eq('user_id', userId)
    : supabase.from('proposal_votes').upsert({ proposal_id: proposalId, user_id: userId, value });
  const { error } = await q;
  if (error) throw error;
}

/**
 * Up/down votes on a list of requests, shown at once and saved in the background. Counts are
 * adjusted from the numbers the list was loaded with, so they stay right without a reload.
 */
export function useVoting(rows: Proposal[] | null) {
  const { userId } = useAuth();
  const [loaded, setLoaded] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Record<string, number>>({});
  const key = (rows ?? []).map((r) => r.id).join(',');
  useEffect(() => {
    if (!rows?.length) return;
    let cancelled = false;
    fetchMyVotes(rows, userId)
      .then((v) => {
        if (cancelled) return;
        setLoaded(v);
        setMine(v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, userId]);

  return useMemo(
    () => ({
      my: (id: string) => mine[id] ?? 0,
      ups: (p: Proposal) => p.confirm_count - ((loaded[p.id] ?? 0) === 1 ? 1 : 0) + ((mine[p.id] ?? 0) === 1 ? 1 : 0),
      downs: (p: Proposal) => p.deny_count - ((loaded[p.id] ?? 0) === -1 ? 1 : 0) + ((mine[p.id] ?? 0) === -1 ? 1 : 0),
      /** Tap up (1) or down (-1); tapping your current vote again takes it back. */
      vote: (id: string, dir: 1 | -1) => {
        if (!userId) return;
        const next = ((mine[id] ?? 0) === dir ? 0 : dir) as -1 | 0 | 1;
        const before = mine[id] ?? 0;
        setMine((m) => ({ ...m, [id]: next }));
        setVote(id, userId, next).catch(() => setMine((m) => ({ ...m, [id]: before })));
      },
    }),
    [mine, loaded, userId],
  );
}

// ------------------------------------------------------------------ petitions (Supabase)
export async function startPetition(proposalId: string, userId: string, goal: number, reason: string, snapshots: string[]) {
  if (!supabase) throw new Error('Petitions need Supabase to be connected.');
  const { error } = await supabase.from('petitions').insert({ proposal_id: proposalId, created_by: userId, goal, reason, snapshots });
  if (error) throw error;
}

export async function hasSigned(petitionId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from('petition_signatures').select('user_id').eq('petition_id', petitionId).eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function sign(petitionId: string, userId: string) {
  if (!supabase) throw new Error('Petitions need Supabase to be connected.');
  const { error } = await supabase.from('petition_signatures').insert({ petition_id: petitionId, user_id: userId });
  if (error) throw error;
}

// ------------------------------------------------------------------ people and ranks (Supabase)
export interface Profile {
  id: string;
  username: string;
  points: number;
  rank: string;
  notify_updates: boolean;
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('id, username, points, rank, notify_updates').eq('id', userId).maybeSingle();
  return data as Profile | null;
}

export async function updateProfile(userId: string, patch: Partial<Pick<Profile, 'username' | 'notify_updates'>>) {
  if (!supabase) return;
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}

export async function fetchMyStats(): Promise<{ requests: number; upvotes: number; signed: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('my_stats');
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as { requests: number; upvotes: number; signed: number } | undefined;
  return r ? { requests: Number(r.requests), upvotes: Number(r.upvotes), signed: Number(r.signed) } : null;
}

export interface LeaderRow {
  id: string;
  username: string;
  rank: string;
  points: number;
  position: number;
}

export type BoardScope = 'near' | 'world' | 'month';

export async function fetchLeaderboard(scope: BoardScope, near: Near | null): Promise<LeaderRow[]> {
  if (!supabase) return [];
  const res =
    scope === 'world'
      ? await supabase.from('leaderboard').select('id, username, rank, points, position').limit(50)
      : scope === 'month'
        ? await supabase.rpc('leaderboard_month')
        : near
          ? await supabase.rpc('leaderboard_near', { lng: near.lng, lat: near.lat, km: near.km ?? NEAR_KM })
          : { data: [], error: null };
  if (res.error) throw res.error;
  return ((res.data ?? []) as LeaderRow[]).map((r) => ({ ...r, points: Number(r.points), position: Number(r.position) }));
}

/** Where you stand worldwide (for when you're not in the top 50). */
export async function fetchMyPosition(userId: string): Promise<LeaderRow | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('leaderboard').select('id, username, rank, points, position').eq('id', userId).maybeSingle();
  return data ? { ...(data as LeaderRow), position: Number((data as LeaderRow).position) } : null;
}

// ------------------------------------------------------------------ hooks
/** Small async-state hook with manual refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useRef(true);
  useEffect(() => () => {
    live.current = false;
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const v = await run();
      if (!live.current) return;
      setData(v);
      setError(null);
    } catch (e) {
      if (live.current) setError(e as Error);
    } finally {
      if (live.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}

export function useApi() {
  const { token } = useAuth();
  return useMemo(() => api(token), [token]);
}
