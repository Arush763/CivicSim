import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { api, type LocalProposal } from './api';
import { useAuth } from './auth';
import { supabase } from './supabase';

export type Proposal = LocalProposal & { author?: { username: string; rank: string } | null };

export interface Petition {
  id: string;
  proposal_id: string;
  goal: number;
  signature_count: number;
  status: 'open' | 'goal_reached' | 'closed';
  created_at: string;
  proposal?: { title: string; area_id: string } | null;
}

export interface LeaderRow {
  id: string;
  username: string;
  points: number;
  rank: string;
  position: number;
}

/** Small async-state hook with manual refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
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

const PROPOSAL_COLUMNS = '*, author:profiles(username, rank)';

// In local-only mode everyone is the same dev user.
const local = api(async () => 'dev-user');

export async function fetchProposals(opts: { areaId?: string; authorId?: string; sort?: 'new' | 'top' } = {}): Promise<Proposal[]> {
  if (!supabase) {
    // Local-only mode: requests submitted to the PC server.
    const rows = await local.localProposals(opts.areaId);
    return rows
      .filter((r) => !opts.authorId || r.author_id === opts.authorId)
      .sort((a, b) => (opts.sort === 'top' ? b.confirm_count - b.deny_count - (a.confirm_count - a.deny_count) : 0));
  }
  let q = supabase.from('proposals').select(PROPOSAL_COLUMNS).limit(100);
  if (opts.areaId) q = q.eq('area_id', opts.areaId);
  if (opts.authorId) q = q.eq('author_id', opts.authorId);
  q = opts.sort === 'top' ? q.order('score', { ascending: false }) : q.order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return data as Proposal[];
}

export async function fetchProposal(id: string): Promise<Proposal | null> {
  if (!supabase) return (await fetchProposals()).find((p) => p.id === id) ?? null;
  const { data, error } = await supabase.from('proposals').select(PROPOSAL_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Proposal | null;
}

export async function myVote(proposalId: string, userId: string): Promise<number> {
  if (!supabase) return (await local.localProposals()).find((p) => p.id === proposalId)?.my_vote ?? 0;
  const { data } = await supabase.from('proposal_votes').select('value').eq('proposal_id', proposalId).eq('user_id', userId).maybeSingle();
  return data?.value ?? 0;
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

export async function fetchPetitions(): Promise<Petition[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('petitions')
    .select('*, proposal:proposals(title, area_id)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as Petition[];
}

export async function petitionForProposal(proposalId: string): Promise<Petition | null> {
  if (!supabase) return null;
  const { data } = await supabase.from('petitions').select('*').eq('proposal_id', proposalId).maybeSingle();
  return data as Petition | null;
}

export async function startPetition(proposalId: string, userId: string, goal: number) {
  if (!supabase) throw new Error('Petitions need Supabase');
  const { error } = await supabase.from('petitions').insert({ proposal_id: proposalId, created_by: userId, goal });
  if (error) throw error;
}

export async function hasSigned(petitionId: string, userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.from('petition_signatures').select('user_id').eq('petition_id', petitionId).eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function sign(petitionId: string, userId: string) {
  if (!supabase) throw new Error('Petitions need Supabase');
  const { error } = await supabase.from('petition_signatures').insert({ petition_id: petitionId, user_id: userId });
  if (error) throw error;
}

export async function fetchLeaderboard(): Promise<LeaderRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leaderboard').select('*').limit(50);
  if (error) throw error;
  return data as LeaderRow[];
}

export async function fetchProfile(userId: string) {
  if (!supabase) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return data as { id: string; username: string; points: number; rank: string; role: 'resident' | 'admin' } | null;
}

/** Decisions go through the server, which only takes them from the admin panel on its own computer. */
export async function setProposalStatus(id: string, status: Proposal['status'], token: () => Promise<string | null>) {
  await api(token).setStatus(id, status);
}

/**
 * Admins make the final call on requests and are the only ones who get AI ideas. That happens in
 * the admin panel (this app in a browser on the server computer); the phone app is for making
 * requests only, so it never shows admin tools. In local-only mode the dev user is the admin.
 */
export function useAdminState(): 'checking' | 'admin' | 'not-admin' {
  const { userId, devMode } = useAuth();
  const panel = Platform.OS === 'web';
  const [state, setState] = useState<'checking' | 'admin' | 'not-admin'>(!panel ? 'not-admin' : devMode ? 'admin' : 'checking');
  useEffect(() => {
    if (!panel || devMode || !userId) {
      setState(panel && devMode ? 'admin' : 'not-admin');
      return;
    }
    let cancelled = false;
    setState('checking');
    void fetchProfile(userId)
      .then((p) => !cancelled && setState(p?.role === 'admin' ? 'admin' : 'not-admin'))
      .catch(() => !cancelled && setState('not-admin'));
    return () => {
      cancelled = true;
    };
  }, [userId, devMode, panel]);
  return state;
}

export function useIsAdmin(): boolean {
  return useAdminState() === 'admin';
}
