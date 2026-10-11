import type { Area, AreaDetail, ChangeOp, CostEstimate, Draft, DraftInput, DraftPatch, Suggestion } from '@mamdani/shared';
import { SERVER_URL } from './config';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

type TokenFn = () => Promise<string | null>;

async function call<T>(token: TokenFn | null, path: string, init: RequestInit = {}): Promise<T> {
  if (!SERVER_URL) throw new ApiError(0, 'Server URL not set. Add EXPO_PUBLIC_SERVER_URL to adminpanel/.env');
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': '1', // ngrok's free tier otherwise may return an HTML interstitial
    ...(init.body ? { 'content-type': 'application/json' } : {}),
  };
  const t = token ? await token() : null;
  if (t) headers.authorization = `Bearer ${t}`;
  const res = await fetch(`${SERVER_URL}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `request failed (${res.status})`, body.details);
  return body as T;
}

export function api(token: TokenFn) {
  const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    health: () => call<{ ok: boolean; mode: string; suggestions: boolean }>(null, '/health'),
    areas: () => call<Area[]>(null, '/areas'),
    city: () => call<CityInfo>(null, '/city'),
    area: (id: string) => call<AreaDetail>(null, `/areas/${id}`),
    estimate: (areaId: string, ops: ChangeOp[]) => call<CostEstimate>(null, '/estimate', json('POST', { areaId, ops })),
    drafts: (areaId?: string) => call<Draft[]>(token, `/drafts${areaId ? `?areaId=${areaId}` : ''}`),
    draft: (id: string) => call<Draft>(token, `/drafts/${id}`),
    createDraft: (input: Partial<DraftInput> & { areaId: string; title: string }) => call<Draft>(token, '/drafts', json('POST', { ops: [], ...input })),
    updateDraft: (id: string, patch: DraftPatch) => call<Draft>(token, `/drafts/${id}`, json('PATCH', patch)),
    deleteDraft: (id: string) => call<void>(token, `/drafts/${id}`, json('DELETE')),
    confirmDraft: (id: string, thumbnailPng?: string) =>
      call<{ proposalId: string; mode: 'supabase' | 'local-only'; afterUrls: string[] }>(
        token, `/drafts/${id}/confirm`, json('POST', { thumbnailPng }),
      ),
    suggest: (areaId: string) => call<Suggestion[]>(token, `/areas/${areaId}/suggest`, json('POST')),
    // Local-only mode (no Supabase yet): requests, confirm/deny votes and decisions live on the PC.
    localProposals: (areaId?: string) => call<LocalProposal[]>(token, `/local/proposals${areaId ? `?areaId=${areaId}` : ''}`),
    localVote: (id: string, value: -1 | 0 | 1) => call<LocalProposal>(token, `/local/proposals/${id}/vote`, json('POST', { value })),
    // City admins only, from the admin panel on the server computer.
    setStatus: (id: string, status: LocalProposal['status']) => call<unknown>(token, `/proposals/${id}/status`, json('POST', { status })),
    processRequest: (id: string) => call<unknown>(token, `/proposals/${id}/process`, json('POST', {})),
  };
}

export type Api = ReturnType<typeof api>;

/** The low-detail 3D map of the whole pilot area (scene x = east m, z = -north m). */
export interface CityInfo {
  url: string;
  origin: [number, number];
  zones: { id: string; name: string; rect: [number, number, number, number] }[];
  labels: { name: string; at: [number, number] }[];
}

/** A requested change: the row shape shared by Supabase `proposals` and the server's local-only store. */
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
  before_url: string | null;
  after_url: string | null;
  processing_status?: 'queued' | 'running' | 'ready' | 'failed';
  processing_error?: string | null;
  thumb_url: string | null;
  confirm_count: number;
  deny_count: number;
  /** Your own vote (-1, 0, 1); only filled in by the local-only server. */
  my_vote?: number;
  created_at: string;
}
