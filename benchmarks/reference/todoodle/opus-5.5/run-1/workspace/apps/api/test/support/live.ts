import { SELF } from 'cloudflare:test';
import { expect } from 'vitest';
import { ORIGIN, url } from './http.ts';
import type { Browser } from './workspaces.ts';

/** A connected live socket and every text frame it has received. */
export type LiveClient = {
  socket: WebSocket;
  frames: string[];
  /** Resolves with the frames once at least `count` have arrived (fails after `timeoutMs`). */
  waitForFrames(count: number, timeoutMs?: number): Promise<string[]>;
  close(): void;
};

export function upgradeHeaders(cookie: string | undefined, origin: string | null = ORIGIN): Headers {
  const headers = new Headers({ Upgrade: 'websocket' });
  if (origin !== null) headers.set('Origin', origin);
  if (cookie) headers.set('Cookie', cookie);
  return headers;
}

/** GET /api/w/:id/live as a browser with this cookie jar would send it. */
export function requestLive(id: string, cookie: string | undefined, init: { origin?: string | null; upgrade?: boolean } = {}) {
  const headers = init.upgrade === false ? new Headers(cookie ? { Cookie: cookie } : {}) : upgradeHeaders(cookie, init.origin);
  if (init.upgrade === false && init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
  return SELF.fetch(url(`/api/w/${id}/live`), { headers });
}

export async function connectLive(browser: Browser, id: string): Promise<LiveClient> {
  const res = await requestLive(id, browser.cookie);
  expect(res.status).toBe(101);
  const socket = res.webSocket;
  if (!socket) throw new Error('101 without webSocket');
  socket.accept();
  const frames: string[] = [];
  const waiters: Array<() => void> = [];
  socket.addEventListener('message', (event) => {
    frames.push(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer));
    for (const wake of waiters.splice(0)) wake();
  });
  return {
    socket,
    frames,
    async waitForFrames(count, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (frames.length < count) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`expected ${count} frames, got ${frames.length}`);
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, Math.min(remaining, 50));
        });
      }
      return frames;
    },
    close() {
      try {
        socket.close(1000, 'done');
      } catch {
        // already closed
      }
    },
  };
}

/** Waits `ms` and returns the frames seen (to assert that nothing arrived). */
export async function framesAfter(client: LiveClient, ms: number): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return client.frames;
}
