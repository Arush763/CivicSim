import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChangeOp } from '@mamdani/shared';
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

/** Receive submissions and processing progress while the laptop admin panel is open. */
export function useProposalUpdates(refresh: () => Promise<unknown>, proposalId?: string) {
  useEffect(() => {
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (!closed) void refresh(); }, 300);
    };
    const channel = supabase.channel(`requests-${proposalId ?? 'all'}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'proposals', ...(proposalId ? { filter: `id=eq.${proposalId}` } : {}),
    }, changed).subscribe();
    // Reconcile missed events/reconnects. One small request per minute while this screen is mounted.
    const fallback = setInterval(changed, 60_000);
    return () => { closed = true; clearTimeout(timer); clearInterval(fallback); void supabase?.removeChannel(channel); };
  }, [refresh, proposalId]);
}

const PROPOSAL_COLUMNS = '*, author:profiles!proposals_author_id_fkey(username, rank)';

// In local-only mode everyone is the same dev user.
const local = api(async () => 'dev-user');
const proposalRow = (p: Proposal): Proposal => {
  const parsed = ChangeOp.array().max(50).safeParse(p.ops);
  return { ...p, ops: parsed.success ? parsed.data : [], cost: p.cost && Array.isArray(p.cost.items) ? p.cost : null };
};

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
  return (data as Proposal[]).map(proposalRow);
}

export async function fetchProposal(id: string): Promise<Proposal | null> {
  if (!supabase) return (await fetchProposals()).find((p) => p.id === id) ?? null;
  const { data, error } = await supabase.from('proposals').select(PROPOSAL_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? proposalRow(data as Proposal) : null;
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

export async function fetchLeaderboard(): Promise<LeaderRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leaderboard').select('*').limit(50);
  if (error) throw error;
  return data as LeaderRow[];
}

/** Decisions go through the server, which only takes them from the admin panel on its own computer. */
export async function setProposalStatus(id: string, status: Proposal['status'], token: () => Promise<string | null>) {
  await api(token).setStatus(id, status);
}

/**
 * Admins make the final call on requests and are the only ones who get AI ideas. That happens in
 * the admin panel (this app in a browser on the server computer), which has no sign-in: whoever
 * uses it there is the admin. The phone app is for making requests only.
 */
export function useIsAdmin(): boolean {
  return Platform.OS === 'web';
}
