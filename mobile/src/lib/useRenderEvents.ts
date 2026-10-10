import { useEffect, useRef } from 'react';
import type { RenderEvent } from '@mamdani/shared';
import { useAuth } from './auth';
import { SERVER_URL } from './config';

/** Subscribe to live render progress from the PC server. Reconnects with backoff. */
export function useRenderEvents(onEvent: (e: RenderEvent) => void) {
  const { token } = useAuth();
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!SERVER_URL) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      const t = (await token()) ?? '';
      if (closed) return;
      ws = new WebSocket(`${SERVER_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(t)}`);
      ws.onopen = () => (retry = 0);
      ws.onmessage = (m) => {
        try {
          handler.current(JSON.parse(String(m.data)));
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        timer = setTimeout(connect, Math.min(15_000, 500 * 2 ** retry++));
      };
    };
    void connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [token]);
}
