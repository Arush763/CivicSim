import { streetViewQuery, type ChangeOp } from '@mamdani/shared';
import { useMemo } from 'react';
import { useAuth } from './auth';
import { SERVER_URL, serverUrl } from './config';
import type { ChangeFocus } from './ops';

export type StreetViewStatus = 'loading' | 'ready' | 'nopano' | 'error';

export interface StreetViewProps {
  /** Highest-detail render of the request (lod0). */
  glb: string;
  /** Where the change is, and how to look at it. */
  focus: ChangeFocus;
  ops: ChangeOp[];
  /** The request in words, for the photo-real (AI) renders. */
  desc: string;
  onStatus?: (status: StreetViewStatus, message?: string) => void;
  style?: object;
}

/**
 * The server's Street View page (server/public/streetview.html) for one request. The sign-in
 * token goes after the #, which browsers never send to the server, so it stays out of logs.
 */
export function streetViewUrl({ glb, focus, ops, desc }: Pick<StreetViewProps, 'glb' | 'focus' | 'ops' | 'desc'>, token: string | null): string {
  const q = streetViewQuery(serverUrl(glb), focus, ops, desc);
  return `${SERVER_URL}/streetview?${q}${token ? `#token=${encodeURIComponent(token)}` : ''}`;
}

/**
 * The token for the Street View page. It's read when the person signs in or out, not on every
 * hourly refresh, so the page doesn't reload (and lose your view) when Supabase renews it.
 */
export function useStreetViewToken(): string | null {
  const { session } = useAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => session?.access_token ?? null, [session?.user.id]);
}

/** Status messages the page posts back to the app. */
export function readStatus(data: unknown): { status: StreetViewStatus; message?: string } | null {
  try {
    const m = typeof data === 'string' ? JSON.parse(data) : data;
    return m?.source === 'streetview' ? { status: m.status, message: m.message } : null;
  } catch {
    return null;
  }
}
