/// <reference types="@cloudflare/vitest-pool-workers" />
// Helpers for driving the persistent BoardRoom from integration tests: reach the
// room instance, read and repair its storage with direct store calls, inject the
// storage failures the design says are "injected by wrapping BoardStore methods
// to throw", and tell when a socket close has landed.
import * as Y from 'yjs';
import { env, runInDurableObject } from 'cloudflare:test';
import type { BoardRoom } from '../../../src/worker/board-room.ts';
import { chunkBytes } from '../../../src/worker/board-store.ts';
import type { RoomState } from '../../../src/worker/room-state.ts';
import { snapshot, type StickySnapshot } from '../../../src/shared/board-model.ts';
import type { RoomClient } from './ws-client.ts';

type RoomEnv = { BOARD_ROOM: DurableObjectNamespace<BoardRoom> };

function namespace(): DurableObjectNamespace<BoardRoom> {
  return (env as unknown as RoomEnv).BOARD_ROOM;
}

/** Run `fn` with the live room instance (creating it if it does not exist). */
export function inRoom<T>(boardId: string, fn: (room: BoardRoom) => T): Promise<T> {
  const ns = namespace();
  return runInDurableObject(ns.get(ns.idFromName(boardId)), fn);
}

/**
 * Direct store call against the room's own storage handle: the same SQLite the
 * room uses, so counts and repairs are the platform's, not a fake.
 */
export function query<T>(boardId: string, fn: (sql: BoardRoom['store']['storage']['sql']) => T): Promise<T> {
  return inRoom(boardId, (room) => fn(room.store.storage.sql));
}

export interface StorageCounts {
  updates: number;
  chunks: number;
  quarantined: number;
  meta: number;
}

export function counts(boardId: string): Promise<StorageCounts> {
  return query(boardId, (sql) => ({
    updates: scalar(sql, 'SELECT COUNT(*) AS n FROM updates'),
    chunks: scalar(sql, 'SELECT COUNT(*) AS n FROM snapshot_chunks'),
    quarantined: scalar(sql, 'SELECT COUNT(*) AS n FROM quarantined_updates'),
    meta: scalar(sql, 'SELECT COUNT(*) AS n FROM storage_meta'),
  }));
}

function scalar(sql: BoardRoom['store']['storage']['sql'], query: string): number {
  const row = sql.exec(query).toArray()[0] as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** The room's lifecycle state, as the room itself reports it. */
export function roomState(boardId: string): Promise<RoomState> {
  return inRoom(boardId, (room) => room.roomState);
}

/** How many times the room has read storage into a document. */
export function loadAttempts(boardId: string): Promise<number> {
  return inRoom(boardId, (room) => room.loadAttempts);
}

/** The board as SQLite currently holds it, read into a throwaway document. */
export function storedBoard(boardId: string): Promise<readonly StickySnapshot[]> {
  return inRoom(boardId, (room) => {
    const doc = new Y.Doc();
    room.store.load(doc);
    return snapshot(doc);
  });
}

/**
 * Every non-internal table SQLite knows about, for the "probing a link writes
 * nothing" assertions (TC-06, TC-09).
 */
export function tables(boardId: string): Promise<string[]> {
  return query(boardId, (sql) =>
    sql
      .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .toArray()
      .map((row) => String((row as { name: string }).name))
      .sort(),
  );
}

/** The board's `created_at` stamp, or null when it has none (TC-05, TC-11, TC-15). */
export function createdAt(boardId: string): Promise<number | null> {
  return inRoom(boardId, (room) => room.store.createdAt());
}

/**
 * Make the next `migrate()` on this board's store throw, to exercise the
 * "creating the board's storage failed" path (TC-12). Wrapping the store method
 * on the live object is the design's injection style ("storage failures are
 * injected by wrapping BoardStore methods to throw"); the exception surfaces to
 * the caller through the `initialize()` RPC.
 */
export function failMigrate(boardId: string, times = 1): Promise<void> {
  return inRoom(boardId, (room) => {
    const store = room.store as {
      migrate: () => void;
      __realMigrate?: () => void;
    };
    if (!store.__realMigrate) store.__realMigrate = store.migrate.bind(store);
    let left = times;
    store.migrate = () => {
      if (left > 0) {
        left--;
        throw new Error('injected initialize failure');
      }
      store.__realMigrate!();
    };
  });
}

/**
 * Replace the log with a snapshot of `doc` (a `Snapshotted` storage state), using
 * the store's own chunking. Then the room's counters are refreshed from storage
 * so the room agrees with what was just written.
 */
export function seedSnapshot(boardId: string, doc: Y.Doc, through: number): Promise<number> {
  return inRoom(boardId, (room) => {
    const sql = room.store.storage.sql;
    const bytes = Y.encodeStateAsUpdate(doc);
    const chunks = chunkBytes(bytes);
    sql.exec('DELETE FROM snapshot_chunks');
    chunks.forEach((chunk, idx) => {
      sql.exec('INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)', idx, chunk);
    });
    sql.exec('DELETE FROM updates');
    sql.exec('DELETE FROM quarantined_updates');
    sql.exec(
      'INSERT INTO storage_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      'snapshot_through_seq',
      String(through),
    );
    // Re-read so the store's in-memory counters match the seeded state.
    room.store.load(new Y.Doc());
    return chunks.length;
  });
}

export const CORRUPT_CHUNK_INDEX = 0;

/**
 * Overwrite snapshot chunk 0 with bytes that are not a Yjs update — exactly what
 * a damaged blob on disk looks like to `Y.applyUpdate`. Returns the original
 * bytes so the test can put them back.
 */
export function corruptChunk(boardId: string, idx = CORRUPT_CHUNK_INDEX): Promise<Uint8Array> {
  return query(boardId, (sql) => {
    const row = sql
      .exec('SELECT data FROM snapshot_chunks WHERE idx = ?', idx)
      .toArray()[0] as { data: ArrayBuffer } | undefined;
    if (!row) throw new Error(`no snapshot chunk at idx ${idx}`);
    const original = new Uint8Array(row.data);
    const damaged = new Uint8Array(original.length);
    for (let i = 0; i < damaged.length; i++) damaged[i] = (original[i]! * 7 + i) % 251;
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', damaged, idx);
    return original;
  });
}

/** Put a chunk's original bytes back, as the e2e repair hook does. */
export function repairChunk(
  boardId: string,
  bytes: Uint8Array,
  idx = CORRUPT_CHUNK_INDEX,
): Promise<void> {
  return query(boardId, (sql) => {
    sql.exec('UPDATE snapshot_chunks SET data = ? WHERE idx = ?', bytes, idx);
  });
}

/**
 * Make the next `n` writes to storage fail, by wrapping the room's own store
 * method (design "Mock vs real": storage failures are injected, SQLite is real).
 * Wrapping happens on the live object, so the room's code path is untouched.
 */
export function failAppends(boardId: string, times = 1): Promise<void> {
  return inRoom(boardId, (room) => {
    const store = room.store as { append: (u: Uint8Array) => void; __real?: (u: Uint8Array) => void };
    if (!store.__real) store.__real = store.append.bind(store);
    let left = times;
    store.append = (update: Uint8Array) => {
      if (left > 0) {
        left--;
        throw new Error('injected storage write failure');
      }
      store.__real!(update);
    };
  });
}

/** Make loads from storage throw, to exercise the SQL read-error path. */
export function failLoads(boardId: string, times = 1): Promise<void> {
  return inRoom(boardId, (room) => {
    const store = room.store as {
      load: (d: Y.Doc) => ReturnType<BoardRoom['store']['load']>;
      __realLoad?: (d: Y.Doc) => ReturnType<BoardRoom['store']['load']>;
    };
    if (!store.__realLoad) store.__realLoad = store.load.bind(store);
    let left = times;
    store.load = (doc: Y.Doc) => {
      if (left > 0) {
        left--;
        throw new Error('injected SQL read failure');
      }
      return store.__realLoad!(doc);
    };
  });
}

/** Stop injecting failures; the store behaves natively again. */
export function restoreStore(
  boardId: string,
  which: 'append' | 'load' = 'append',
): Promise<void> {
  return inRoom(boardId, (room) => {
    const store = room.store as unknown as Record<string, unknown>;
    if (which === 'append') {
      const s = store as { __real?: (u: Uint8Array) => void };
      if (s.__real) store.append = s.__real;
    } else {
      const s = store as { __realLoad?: (d: Y.Doc) => ReturnType<BoardRoom['store']['load']> };
      if (s.__realLoad) store.load = s.__realLoad;
    }
  });
}

/** Every log row's size, in seq order — for "row count unchanged" assertions. */
export function logSizes(boardId: string): Promise<number[]> {
  return query(boardId, (sql) =>
    sql
      .exec('SELECT bytes FROM updates ORDER BY seq')
      .toArray()
      .map((r) => Number((r as { bytes: number }).bytes)),
  );
}

// ------------------------------------------------------------------ sockets

/** Resolve once `ws` has been closed by the room (or the timeout is hit). */
export function closed(ws: RoomClient, timeoutMs = 2000): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const check = setInterval(() => {
      if (ws.closed) {
        clearTimeout(timer);
        clearInterval(check);
        resolve(ws.closeCode);
      }
    }, 5);
  });
}

/** Resolve once every listed client reports its socket is closed. */
export async function allClosed(clients: readonly RoomClient[]): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (const c of clients) out.push(await closed(c));
  return out;
}
