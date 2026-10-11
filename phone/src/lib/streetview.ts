import { streetViewQuery, type ChangeFocus, type ChangeOp } from '@mamdani/shared';
import { useEffect, useState } from 'react';
import { LAN_SERVER_URL, SERVER_URL, serverUrl } from './config';

let pageServer: { at: number; base: Promise<string> } | null = null;

/**
 * Where to load the laptop's pages from: straight from the laptop over Wi-Fi when the phone can
 * reach it (no ngrok in between, so photos arrive several times faster), else through ngrok.
 * Checked at most once a minute. Null while checking.
 */
export function usePageServer(): string | null {
  const [base, setBase] = useState<string | null>(LAN_SERVER_URL ? null : SERVER_URL);
  useEffect(() => {
    if (!LAN_SERVER_URL) return;
    if (!pageServer || Date.now() - pageServer.at > 60_000) {
      pageServer = {
        at: Date.now(),
        base: (async () => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), 1500);
          try {
            const res = await fetch(`${LAN_SERVER_URL}/health`, { signal: abort.signal });
            return res.ok ? LAN_SERVER_URL : SERVER_URL;
          } catch {
            return SERVER_URL;
          } finally {
            clearTimeout(timer);
          }
        })(),
      };
    }
    let live = true;
    void pageServer.base.then((b) => live && setBase(b));
    return () => {
      live = false;
    };
  }, []);
  return base;
}

/**
 * The laptop's Street View page (server/public/streetview.html) for one request, in the app's
 * own-controls mode (ui=0). The sign-in token goes after the #, which never reaches the server's
 * logs. Phones only see photo-real views prepared when the request came in.
 */
export function streetViewUrl(base: string, glb: string, focus: ChangeFocus, ops: ChangeOp[], desc: string, opts: { token: string | null; photo: boolean; mode: string }) {
  const q = streetViewQuery(serverUrl(glb), focus, ops, desc);
  q.set('ui', '0');
  q.set('mode', opts.mode);
  if (!opts.photo) q.set('photo', '0');
  return `${base}/streetview?${q}${opts.token ? `#token=${encodeURIComponent(opts.token)}` : ''}`;
}

/** The laptop's 3D model page (server/public/model.html). */
export function modelUrl(base: string, glb: string, at: [number, number] | null, quality: number, dark: boolean) {
  const q = new URLSearchParams({ glb: serverUrl(glb), quality: String(quality) });
  if (at) q.set('at', at.map((v) => v.toFixed(7)).join(','));
  if (dark) q.set('dark', '1');
  return `${base}/model?${q}`;
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
