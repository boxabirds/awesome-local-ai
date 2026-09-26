import { request } from 'node:http';
import { INTEGRATION_PORT } from './server';

/**
 * Test-only HTTP hooks, reachable at `/__test/boards/:boardId/:op` on the
 * integration `wrangler dev` server (TEST_HOOKS=1, see global-setup). They are
 * the only way to reach into the Durable Object's SQLite from the test
 * process (the Cloudflare vitest pool's workerd stub drops DO WebSockets, so
 * everything goes through the production workerd + HTTP).
 */

export interface StorageInfo {
  tables: string[];
  storageSchemaVersion: string | null;
  snapshotThroughSeq: string | null;
  updates: number;
  updateBytes: number;
  chunks: number;
  snapshotBytes: number;
  quarantined: Array<{ seq: number; error: string }>;
  failureFlags: string[];
}

export interface LoadFreshResult {
  result: { ok: boolean; quarantined?: number; reason?: string; error?: string };
  notes: Array<Record<string, unknown>>;
}

export interface HookResult<T = unknown> {
  status: number;
  json: T & Record<string, unknown>;
  text: string;
}

function raw(path: string, method: string, body?: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const req = request(
      {
        host: '127.0.0.1',
        port: INTEGRATION_PORT,
        path,
        method,
        headers: data ? { 'content-type': 'application/json' } : {},
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(60_000, () => req.destroy(new Error('hook timeout')));
    if (data) req.write(data);
    req.end();
  });
}

/** POST (or GET) one test hook op for a board. */
export async function hook<T = Record<string, unknown>>(
  boardId: string,
  op: string,
  body?: unknown,
): Promise<HookResult<T>> {
  const method = body === undefined ? 'GET' : 'POST';
  const { status, body: text } = await raw(`/__test/boards/${boardId}/${op}`, method, body);
  let json: T & Record<string, unknown> = {} as T & Record<string, unknown>;
  try {
    json = JSON.parse(text) as T & Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status, json, text };
}

export const storageInfo = (boardId: string) =>
  hook<StorageInfo>(boardId, 'storage-info').then((r) => r.json);

export const loadFresh = (boardId: string) =>
  hook<LoadFreshResult>(boardId, 'load-fresh').then((r) => r.json);

/** Appends a batch of base64 updates (mirrors the room: apply + append + auto-compact). */
export const appendUpdates = (boardId: string, updates: string[]) =>
  hook<{ appended: number; compacted: number; storage: StorageInfo }>(boardId, 'room-append-updates', { updates }).then(
    (r) => r.json,
  );

export const compact = (boardId: string, force = false) =>
  hook<{ compacted: boolean; storage: StorageInfo }>(boardId, 'store-compact', { force }).then((r) => r.json);

export const corruptUpdateRow = (boardId: string, seq: number, mode: 'truncate' | 'random' = 'truncate') =>
  hook<{ ok: boolean; seq?: number; error?: string }>(boardId, 'corrupt-update-row', { seq, mode }).then((r) => ({
    status: r.status,
    ...r.json,
  }));

export const corruptSnapshot = (boardId: string, idx = 0) =>
  hook<{ ok: boolean; idx?: number; error?: string }>(boardId, 'corrupt-snapshot', { idx }).then((r) => ({
    status: r.status,
    ...r.json,
  }));

export const repair = (boardId: string) =>
  hook<{ repairedSnapshot: number; repairedUpdates: number }>(boardId, 'repair').then((r) => r.json);

export const setFailure = (boardId: string, target: 'append' | 'load-select' | 'compaction-after-chunk-delete') =>
  hook<{ armed?: string; error?: string }>(boardId, 'set-failure', { target }).then((r) => r.json);

export const roomState = (boardId: string) =>
  hook<{ state: string; lastLoadAttempt: number }>(boardId, 'room-state').then((r) => r.json);

export const simulateReconstruct = (boardId: string) =>
  hook<{ before: string; after: string }>(boardId, 'simulate-reconstruct').then((r) => r.json);
