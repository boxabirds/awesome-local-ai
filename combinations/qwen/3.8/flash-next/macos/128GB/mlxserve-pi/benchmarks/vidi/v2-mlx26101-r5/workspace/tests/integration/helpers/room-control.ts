/**
 * Reaching into a live board room.
 *
 * The tests in the persistence suite are about what a room does when its storage misbehaves,
 * and a test cannot wait for a disk to fail. This module is the way in: it talks to *the same
 * room object* the sockets are connected to — `env.BOARD_ROOM.get(idFromName(boardId))` is
 * that object, not a copy of it, which the first test in `board-room-persistence.test.ts`
 * asserts rather than assumes — and it uses the room's own public surface:
 *
 * - `room.boardStore` to read and count rows, to load the board back into a document of the
 *   test's, and to aim a failure at one named statement;
 * - `room.roomState` to see which part of the lifecycle the room is in;
 * - `room.forgetBoard()` to put the room where an eviction puts it: no document in memory,
 *   storage and sockets untouched. A test cannot make workerd evict an object, and eviction is
 *   half of what story 4 is about;
 * - the room's `/__test/…` routes to damage and repair the snapshot, which is how the
 *   load-failure path is driven in a real browser too (see `src/worker/test-hooks.ts`).
 *
 * Those routes are compiled into the Worker but switched off unless the deployment sets
 * `TEST_HOOKS=1`, and this version of `@cloudflare/vitest-pool-workers` ignores per-file `env`
 * overrides, so the hooks are switched on here the way the test environment would switch them
 * on: by setting the variable on the room's own `env` before using them. Nothing in
 * `wrangler.jsonc` ever sets it, which is what the e2e suite checks against a production build.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';

import { isStickySnapshot, snapshot, type StickySnapshot } from '../../../src/shared/board-model';
import {
  joinChunks,
  type BoardStore,
  type FaultPoint,
  type LoadResult,
} from '../../../src/worker/board-store';
import type { BoardRoom } from '../../../src/worker/board-room';
import type { RoomState } from '../../../src/worker/room-state';
import type { Env } from '../../../src/worker/index';

/** The room namespace, as the deployed Worker declares it. */
const rooms = (env as unknown as Env).BOARD_ROOM;

/** A BLOB parameter wants an ArrayBuffer exactly as long as the bytes it is given. */
function asBlob(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/** A BLOB column as bytes, whether the driver handed back an ArrayBuffer or a view. */
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('expected a BLOB column');
}

/** What the test wants to know about one board's room, answered inside that room. */
export function inRoom<T>(
  boardId: string,
  statement: (room: BoardRoom, store: BoardStore) => T,
): Promise<T> {
  return runInDurableObject(rooms.get(rooms.idFromName(boardId)), (room) =>
    statement(room, room.boardStore),
  );
}

/** Makes sure the room exists, so a statement can be said to it before anybody connects. */
export async function openRoom(boardId: string): Promise<void> {
  await rooms.get(rooms.idFromName(boardId)).fetch(`https://board-room.internal/b/${boardId}`);
}

/** Which part of its lifecycle the room is in. */
export function roomStateOf(boardId: string): Promise<RoomState> {
  return inRoom(boardId, (room) => room.roomState);
}

/** How much of the board is snapshot, and how much is still log. */
export function snapshotInfo(boardId: string): Promise<{ chunks: number; throughSeq: number }> {
  return inRoom(boardId, (_room, store) => store.snapshotInfo());
}

/** The log rows still to be replayed, oldest first. */
export function logRows(boardId: string): Promise<{ seq: number; bytes: number }[]> {
  return inRoom(boardId, (_room, store) => {
    const rows: { seq: number; bytes: number }[] = [];
    for (const row of store.sql.exec<{ seq: number; bytes: number }>(
      'SELECT seq, bytes FROM updates ORDER BY seq',
    )) {
      rows.push({ seq: Number(row.seq), bytes: Number(row.bytes) });
    }
    return rows;
  });
}

/** How many changes could not be read and were set aside. */
export function quarantinedCount(boardId: string): Promise<number> {
  return inRoom(boardId, (_room, store) => store.quarantinedCount());
}

/** The damage the store is holding: which row, how big it was, and why it could not be read. */
export function quarantinedRecords(
  boardId: string,
): Promise<{ seq: number; bytes: number; error: string }[]> {
  return inRoom(boardId, (_room, store) => {
    const rows: { seq: number; bytes: number; error: string }[] = [];
    for (const row of store.sql.exec<{ seq: number; data: ArrayBuffer; error: string }>(
      'SELECT seq, data, error FROM quarantined_updates ORDER BY seq',
    )) {
      rows.push({ seq: Number(row.seq), bytes: new Uint8Array(row.data).length, error: row.error });
    }
    return rows;
  });
}

/** The board as storage holds it, read into a document of the test's. */
export function readStoredBoard(
  boardId: string,
): Promise<{ result: LoadResult; notes: readonly StickySnapshot[] }> {
  return inRoom(boardId, (_room, store) => {
    const doc = new Y.Doc();
    const result = store.load(doc);
    // Notes, out of a board that story 7 made able to hold other kinds of object as well: what these
    // tests check about a board read back from storage is the notes on it.
    return { result, notes: result.ok ? snapshot(doc).filter(isStickySnapshot) : [] };
  });
}

/** One statement of the test's, run against this board's SQLite. */
export function inStorage<T>(boardId: string, statement: (sql: DurableObjectStorage['sql']) => T): Promise<T> {
  return inRoom(boardId, (_room, store) => statement(store.sql));
}

/**
 * Makes the room's next statement at `point` throw, once. The failure is raised outside
 * SQLite, so the transaction around it really does roll back; what the test is checking is
 * what the room makes of it.
 */
export function failNextStatement(boardId: string, point: FaultPoint): Promise<void> {
  return inRoom(boardId, (_room, store) => {
    const previous = store.inject;
    let armed = true;
    store.inject = (seen: FaultPoint): void => {
      previous(seen);
      if (armed && seen === point) {
        armed = false;
        throw new Error(`storage said no at ${point}`);
      }
    };
  });
}

/**
 * Records every statement point the store passes, so a test can say "no read was attempted"
 * instead of guessing from a close code. The array is the test's; the closure that fills it
 * lives in the room, in the same isolate.
 */
export function watchStatements(boardId: string, seen: FaultPoint[]): Promise<void> {
  return inRoom(boardId, (_room, store) => {
    const previous = store.inject;
    store.inject = (point: FaultPoint): void => {
      previous(point);
      seen.push(point);
    };
  });
}

/** Stops failing and stops watching. */
export function clearStatementFaults(boardId: string): Promise<void> {
  return inRoom(boardId, (_room, store) => {
    store.inject = () => {};
  });
}

/** How long this room waits between attempts to read a board it could not read. */
export function setLoadRetryInterval(boardId: string, intervalMs: number): Promise<void> {
  return inRoom(boardId, (room) => {
    room.retryIntervalMs = intervalMs;
  });
}

/** The room gives up the board it holds in memory; storage and sockets are untouched. */
export function forgetTheBoard(boardId: string): Promise<void> {
  return inRoom(boardId, (room) => {
    room.forgetBoard();
  });
}

/**
 * The notes the room is holding in memory, for a test that has to know what it is holding.
 * Notes rather than every object, since story 7: the board can hold other kinds of thing and
 * these tests are about notes.
 */
export function roomNotes(boardId: string): Promise<readonly StickySnapshot[] | null> {
  return inRoom(boardId, (room) =>
    room.boardDoc === null ? null : snapshot(room.boardDoc).filter(isStickySnapshot),
  );
}

/** Switches the room's storage hooks on, as the test environment does. */
export async function enableStorageHooks(boardId: string): Promise<void> {
  await openRoom(boardId);
  await inRoom(boardId, (room) => {
    // `env` is protected on a Durable Object, and this is the one thing the test environment
    // would normally set: see this file's header for why it is set here instead of a config.
    (room as unknown as { env: { TEST_HOOKS?: string } }).env.TEST_HOOKS = '1';
  });
}

/** What a hook call did. */
export interface HookResult {
  status: number;
  body: Record<string, unknown>;
}

async function callHook(boardId: string, action: string): Promise<HookResult> {
  const response = await rooms.get(rooms.idFromName(boardId)).fetch(
    new Request(`https://board-room.internal/__test/${action}`, { method: 'POST' }),
  );
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  return {
    status: response.status,
    body: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
  };
}

/** Damages the snapshot, and puts the room where a restart would have left it. */
export function corruptSnapshot(boardId: string): Promise<HookResult> {
  return callHook(boardId, 'corrupt-snapshot');
}

/** Puts the snapshot back. */
export function repairSnapshot(boardId: string): Promise<HookResult> {
  return callHook(boardId, 'repair');
}

/** The whole snapshot, as the database holds it. */
export function snapshotBytes(boardId: string): Promise<Uint8Array> {
  return inStorage(boardId, (sql) => {
    const chunks: Uint8Array[] = [];
    for (const row of sql.exec<{ data: ArrayBuffer }>('SELECT data FROM snapshot_chunks ORDER BY idx')) {
      chunks.push(bytesOf(row.data));
    }
    return joinChunks(chunks);
  });
}

/** Damages one log row in place, leaving it the size it was. */
export function scrambleLogRow(boardId: string, seq: number): Promise<number> {
  return inStorage(boardId, (sql) => {
    for (const row of sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates WHERE seq = ?', seq)) {
      const bytes = bytesOf(row.data);
      const damaged = new Uint8Array(bytes.length).fill(0xff);
      sql.exec(
        'UPDATE updates SET data = ?, bytes = ? WHERE seq = ?',
        asBlob(damaged),
        damaged.length,
        seq,
      );
      return bytes.length;
    }
    throw new Error(`there is no log row ${String(seq)}`);
  });
}
