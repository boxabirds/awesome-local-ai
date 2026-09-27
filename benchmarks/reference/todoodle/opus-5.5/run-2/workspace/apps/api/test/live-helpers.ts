import { SELF } from 'cloudflare:test';
import { ORIGIN } from './helpers';

export const LIVE_TIMEOUT_MS = 2_000;

/** A client socket from the live endpoint, collecting every frame it receives. */
export type LiveClient = {
  res: Response;
  socket: WebSocket;
  frames: string[];
  /** Resolves with the next frame after `seen` frames (rejects after the timeout). */
  nextFrame(seen?: number): Promise<string>;
  close(): void;
};

export function upgrade(workspaceId: string, opts: { cookie?: string | null; origin?: string | null; upgrade?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.upgrade !== false) headers.Upgrade = 'websocket';
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.Origin = origin;
  if (opts.cookie) headers.Cookie = opts.cookie;
  return SELF.fetch(`${ORIGIN}/api/w/${workspaceId}/live`, { headers });
}

export async function connectLive(workspaceId: string, cookie: string): Promise<LiveClient> {
  const res = await upgrade(workspaceId, { cookie });
  if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed: ${res.status}`);
  const socket = res.webSocket;
  const frames: string[] = [];
  const waiters: (() => void)[] = [];
  socket.addEventListener('message', (e) => {
    frames.push(typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer));
    waiters.splice(0).forEach((w) => w());
  });
  socket.accept();
  return {
    res,
    socket,
    frames,
    nextFrame(seen = frames.length) {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (frames.length > seen) {
            clearTimeout(timer);
            resolve(frames[seen]!);
            return true;
          }
          return false;
        };
        const timer = setTimeout(() => reject(new Error('no frame in time')), LIVE_TIMEOUT_MS);
        if (!check()) waiters.push(() => void check());
      });
    },
    close() {
      try {
        socket.close(1000, 'done');
      } catch {
        // Already closed.
      }
    },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
