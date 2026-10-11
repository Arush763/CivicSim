import { streetViewQuery, type ChangeOp } from '@mamdani/shared';
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
 * The server's Street View page (server/public/streetview.html) for one request. No sign-in: the
 * server knows the admin panel by where it runs.
 */
export function streetViewUrl({ glb, focus, ops, desc }: Pick<StreetViewProps, 'glb' | 'focus' | 'ops' | 'desc'>): string {
  return `${SERVER_URL}/streetview?${streetViewQuery(serverUrl(glb), focus, ops, desc)}`;
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
