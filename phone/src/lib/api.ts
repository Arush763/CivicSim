import type { Area, AreaDetail, ChangeOp, CostEstimate, Draft, DraftInput, DraftPatch, RenderJobInfo } from '@mamdani/shared';
import { SERVER_URL } from './config';
import { supabase } from './supabase';
import { cloudArea, cloudAreas, cloudDraft, cloudDrafts, cloudSnapshots, createCloudDraft, deleteCloudDraft, submitCloudDraft, updateCloudDraft } from './cloud';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

type TokenFn = () => Promise<string | null>;

async function call<T>(token: TokenFn | null, path: string, init: RequestInit = {}): Promise<T> {
  if (!SERVER_URL) throw new ApiError(0, 'The server address is not set. Add EXPO_PUBLIC_SERVER_URL to phone/.env.');
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': '1', // ngrok's free tier may otherwise answer with an HTML page
    ...(init.body ? { 'content-type': 'application/json' } : {}),
  };
  const t = token ? await token() : null;
  if (t) headers.authorization = `Bearer ${t}`;
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  } catch {
    throw new ApiError(0, 'Can’t reach the CivicSim server. Check that the laptop is on and connected.');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `request failed (${res.status})`, body.details);
  return body as T;
}

/** A new account, made by the laptop server so Supabase sends no confirmation email. */
export const createAccount = (a: { email: string; password: string; firstName: string; lastName: string }) =>
  call<{ ok: true }>(null, '/accounts', { method: 'POST', body: JSON.stringify(a) });

/** A requested change, as the server keeps it in local-only mode (same columns as Supabase `proposals`). */
export interface LocalProposal {
  id: string;
  area_id: string;
  author_id: string;
  title: string;
  description: string;
  ops: ChangeOp[];
  cost: CostEstimate | null;
  source: 'human' | 'ai_suggested';
  status: 'submitted' | 'under_review' | 'accepted' | 'rejected';
  after_url: string | null;
  thumb_url: string | null;
  confirm_count: number;
  deny_count: number;
  my_vote?: number;
  created_at: string;
}

export interface SnapshotSet {
  status: 'none' | 'running' | 'done' | 'failed';
  shots: { kind: string; label: string; url: string }[];
}

export interface PrerenderStatus {
  status: 'none' | 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  spots?: number;
}

/** The laptop server. Phones can make requests and vote; AI and decisions stay in the admin panel. */
export function api(token: TokenFn) {
  const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    areas: () => supabase ? cloudAreas() : call<Area[]>(null, '/areas'),
    area: (id: string) => supabase ? cloudArea(id) : call<AreaDetail>(null, `/areas/${id}`),
    estimate: (areaId: string, ops: ChangeOp[]) => call<CostEstimate>(null, '/estimate', json('POST', { areaId, ops })),
    drafts: (areaId?: string) => supabase ? cloudDrafts(areaId) : call<Draft[]>(token, `/drafts${areaId ? `?areaId=${encodeURIComponent(areaId)}` : ''}`),
    draft: (id: string) => supabase ? cloudDraft(id) : call<Draft>(token, `/drafts/${id}`),
    createDraft: (input: Partial<DraftInput> & { areaId: string; title: string }) => supabase ? createCloudDraft({ ops: [], ...input }) : call<Draft>(token, '/drafts', json('POST', { ops: [], ...input })),
    updateDraft: (id: string, patch: DraftPatch) => supabase ? updateCloudDraft(id, patch) : call<Draft>(token, `/drafts/${id}`, json('PATCH', patch)),
    deleteDraft: (id: string) => supabase ? deleteCloudDraft(id) : call<void>(token, `/drafts/${id}`, json('DELETE')),
    confirmDraft: (id: string) => supabase ? submitCloudDraft(id) : call<{ proposalId: string; mode: 'supabase' | 'local-only'; afterUrls: string[] }>(token, `/drafts/${id}/confirm`, json('POST', {})),
    snapshots: (proposalId: string) => supabase ? cloudSnapshots(proposalId) : call<SnapshotSet>(null, `/proposals/${proposalId}/snapshots`),
    prerender: (proposalId: string) => call<PrerenderStatus | null>(null, `/proposals/${proposalId}/prerender`),
    // Local-only mode (no Supabase yet): requests and votes live on the laptop.
    localProposals: (areaId?: string) => call<LocalProposal[]>(token, `/local/proposals${areaId ? `?areaId=${encodeURIComponent(areaId)}` : ''}`),
    localVote: (id: string, value: -1 | 0 | 1) => call<LocalProposal>(token, `/local/proposals/${id}/vote`, json('POST', { value })),
  };
}

export type Api = ReturnType<typeof api>;
export type { RenderJobInfo };
