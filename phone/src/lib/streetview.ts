import { streetViewQuery, type ChangeFocus, type ChangeOp } from '@mamdani/shared';
import { SERVER_URL, serverUrl } from './config';

/**
 * The laptop's Street View page (server/public/streetview.html) for one request, in the app's
 * own-controls mode (ui=0). The sign-in token goes after the #, which never reaches the server's
 * logs. Phones only see photo-real views prepared when the request came in.
 */
export function streetViewUrl(glb: string, focus: ChangeFocus, ops: ChangeOp[], desc: string, opts: { token: string | null; photo: boolean; mode: string }) {
  const q = streetViewQuery(serverUrl(glb), focus, ops, desc);
  q.set('ui', '0');
  q.set('mode', opts.mode);
  if (!opts.photo) q.set('photo', '0');
  return `${SERVER_URL}/streetview?${q}${opts.token ? `#token=${encodeURIComponent(opts.token)}` : ''}`;
}

/** The laptop's 3D model page (server/public/model.html). */
export function modelUrl(glb: string, at: [number, number] | null, quality: number, dark: boolean) {
  const q = new URLSearchParams({ glb: serverUrl(glb), quality: String(quality) });
  if (at) q.set('at', at.map((v) => v.toFixed(7)).join(','));
  if (dark) q.set('dark', '1');
  return `${SERVER_URL}/model?${q}`;
}

/** Messages the pages post back: {source: 'streetview' | 'model', status, message}. */
export function readPageMessage(data: unknown): { source: string; status: string; message?: string } | null {
  try {
    const m = typeof data === 'string' ? JSON.parse(data) : data;
    return m?.source ? m : null;
  } catch {
    return null;
  }
}
