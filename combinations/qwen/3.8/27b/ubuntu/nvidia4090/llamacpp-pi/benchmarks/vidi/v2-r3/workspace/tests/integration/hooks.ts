import type { ObjectSnapshot } from '../../src/shared/board-model';
import { BASE } from './ws-client';

/**
 * Client for the worker's /__test hook routes (story 4). All hook
 * operations run inside the board's Durable Object against real SQLite.
 */
/** Mirror of the worker's LoadResult + the objects of the loaded doc. */
export interface StoreLoad {
  result: { ok: boolean; quarantined?: number; reason?: string; error?: string };
  notes: ObjectSnapshot[];
}

export interface StoreStatus {
  /** Table names in the board's SQLite db (empty for an unknown board). */
  tables: string[];
  /** created_at storage_meta value, or null (never set for legacy boards). */
  createdAt: string | null;
  updates: { count: number; bytes: number };
  chunks: number;
  snapshotBytes: number;
  throughSeq: number;
  schemaVersion: string | null;
  quarantined: Array<{ seq: number; error: string }>;
}

export class HookError extends Error {
  constructor(public readonly body: unknown) {
    super(`hook failed: ${JSON.stringify(body)}`);
  }
}

async function call(
  boardId: string,
  op: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/__test/boards/${encodeURIComponent(boardId)}/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.ok === false) {
    throw new HookError(json);
  }
  return json;
}

export const b64 = (bytes: Uint8Array): string => {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};

export const unb64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Story 5: create a real board through the worker API and return its id. */
export async function createBoard(): Promise<string> {
  const res = await fetch(`${BASE}/api/boards`, { method: 'POST' });
  if (res.status !== 201) {
    throw new Error(`POST /api/boards -> ${res.status} ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/** Story 5, TC-12: worker-level create-board fault injection. */
export async function setCreateBoardFault(mode: 'throw' | 'exists' | 'clear'): Promise<void> {
  const res = await fetch(`${BASE}/__test/faults/create-board`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`setCreateBoardFault -> ${res.status}`);
}

export const hooks = {
  status: (boardId: string): Promise<StoreStatus> =>
    call(boardId, 'store-status') as unknown as Promise<StoreStatus>,
  migrate: (boardId: string) => call(boardId, 'store-migrate'),
  append: (boardId: string, data: Uint8Array) =>
    call(boardId, 'store-append', { data: b64(data) }),
  appendMany: (boardId: string, updates: Uint8Array[]) =>
    call(boardId, 'store-append-many', { updates: updates.map(b64) }),
  load: (boardId: string) => call(boardId, 'store-load') as unknown as Promise<StoreLoad>,
  compact: (
    boardId: string,
    opts: { force?: boolean; failAfterChunkDelete?: boolean } = {},
  ) => call(boardId, 'store-compact', opts),
  corruptLogRow: (boardId: string, seq: number, mode: 'truncated' | 'random') =>
    call(boardId, 'store-corrupt-log-row', { seq, mode }),
  corruptSnapshotChunk: (boardId: string, idx: number, mode: 'random' = 'random') =>
    call(boardId, 'store-corrupt-snapshot-chunk', { idx, mode }),
  repairSnapshotChunk: (boardId: string, idx: number) =>
    call(boardId, 'store-repair-snapshot-chunk', { idx }),
  roomReset: (boardId: string) => call(boardId, 'room-reset'),
  roomInject: (
    boardId: string,
    spec: { append?: 'once' | 'always'; load?: 'once' | 'always'; reset?: boolean },
  ) => call(boardId, 'room-inject', spec),
  boardInitialize: (boardId: string) => call(boardId, 'board-initialize'),
  roomCompactNow: (boardId: string) => call(boardId, 'room-compact-now'),
  corruptSnapshot: (boardId: string) => call(boardId, 'corrupt-snapshot'),
  repairSnapshot: (boardId: string) => call(boardId, 'repair-snapshot'),
};
