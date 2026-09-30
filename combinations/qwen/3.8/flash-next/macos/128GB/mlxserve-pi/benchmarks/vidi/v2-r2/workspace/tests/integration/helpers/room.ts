// Helpers for testing the *persistent room* rather than the store in isolation:
// everything here goes through a real BoardRoom Durable Object - its real
// storage, its real sockets and its real handlers - because the guarantees under
// test (written before broadcast, reloaded on wake, refused when unreadable) only
// exist in that combination.
//
// Two kinds of reach into the room are used, both narrow and named:
//   - the room's own documented test seams (`store`, `doc`, `loadNow`,
//     `diagnostics`, `loadFailedAt`), collected below as `RoomSurface`, and
//   - raw SQL through the object's `DurableObjectState`, which is how a row is
//     damaged the way disk damage looks: unreadable bytes in a real table.
//
// `onRoom` is the one place that reaches in: it runs its body inside the object,
// the same way the runtime does, and hands back plain values to assert on.

import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../../src/shared/board-id';
import type { StickyColor } from '../../../src/shared/config';
import {
  createSticky,
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../../src/shared/protocol';
import type { BoardRoom, RoomDiagnostics } from '../../../src/worker/board-room';
import type { RoomState } from '../../../src/worker/room-state';
import { BoardStore, type LoadResult } from '../../../src/worker/board-store';
import { TestClient } from './ws-client';

export type { RoomDiagnostics, RoomState };

/** The public surface of a room the tests are allowed to use. */
type RoomSurface = Pick<
  BoardRoom,
  'diagnostics' | 'doc' | 'store' | 'loadFailedAt' | 'loadNow' | 'webSocketMessage'
>;

function onRoom<R>(id: string, body: (room: RoomSurface, state: DurableObjectState) => R): Promise<R> {
  return runInDurableObject(
    stubFor(id) as never,
    (room: unknown, state: DurableObjectState) => body(room as RoomSurface, state),
  );
}

/** A board id of its own, so every test gets its own SQLite database. */
export function boardId(): string {
  return newBoardId();
}

export function stubFor(id: string): DurableObjectStub<BoardRoom> {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(id));
}

export function diagnostics(id: string): Promise<RoomDiagnostics> {
  return onRoom(id, (room) => room.diagnostics());
}

/** The room's own document, by content (the same read story 3's tests do). */
export function roomNotes(id: string): Promise<readonly StickySnapshot[] | null> {
  return onRoom(id, (room) => (room.doc === null ? null : snapshot(room.doc)));
}

/**
 * Load the stored board into a *fresh* document with a *fresh* store, leaving the
 * room's own document alone. This is the reopen the room itself would do on a
 * wake, which is what "it is really in storage" means.
 */
export function storedNotes(
  id: string,
): Promise<{ result: LoadResult; notes: readonly StickySnapshot[] }> {
  return onRoom(id, (_room, state) => {
    const store = new BoardStore(state.storage);
    const doc = new Y.Doc();
    const result = store.load(doc);
    return { result, notes: snapshot(doc) };
  });
}

export function tableCount(id: string, table: string): Promise<number> {
  return onRoom(id, (_room, state) => {
    for (const row of state.storage.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`)) {
      return Number(row.n);
    }
    return 0;
  });
}

/** Force a compaction now, so a snapshot exists without writing 500 rows. */
export function forceCompact(id: string): Promise<boolean> {
  return onRoom(id, (room) =>
    room.doc === null ? false : room.store.compactIfNeeded(room.doc, { force: true }),
  );
}

/** Unusable bytes of the same length, from a seeded generator. */
function unusableBytes(bytes: Uint8Array): Uint8Array {
  let state = 0x2545f491;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < out.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = (state >>> 8) & 0xff;
  }
  return out;
}

/** The tests' own copy table for damaged rows (nothing in production creates it). */
const DAMAGE_BACKUP = 'test_damage_backup';

/**
 * Overwrite snapshot chunk 0 with unusable bytes of the same length, keeping the
 * original in a side table so `repairSnapshot` can put it back. Reads the row out
 * in full first: a SQLite cursor has to be finished before a write runs.
 */
export function damageSnapshot(id: string): Promise<Uint8Array | null> {
  return onRoom(id, (_room, state) => {
    const sql = state.storage.sql;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS ${DAMAGE_BACKUP} (key TEXT PRIMARY KEY, data BLOB NOT NULL)`,
    );
    const row = [...sql.exec(`SELECT data FROM snapshot_chunks WHERE idx = 0`)][0];
    if (row === undefined) return null;
    const original = new Uint8Array(row.data as ArrayBuffer);
    sql.exec(`INSERT OR REPLACE INTO ${DAMAGE_BACKUP} (key, data) VALUES (?1, ?2)`, 'chunk0', original);
    sql.exec(`UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`, unusableBytes(original));
    return original;
  });
}

/** Put the saved chunk back, so the next load works again. */
export function repairSnapshot(id: string): Promise<boolean> {
  return onRoom(id, (_room, state) => {
    const sql = state.storage.sql;
    const saved = [...sql.exec(`SELECT data FROM ${DAMAGE_BACKUP} WHERE key = ?1`, 'chunk0')][0];
    if (saved === undefined) return false;
    sql.exec(
      `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
      new Uint8Array(saved.data as ArrayBuffer),
    );
    return true;
  });
}

/**
 * Make the next `INSERT INTO updates` fail once, at the SQL boundary, the way a
 * real write fails. The hook disarms itself before throwing, so the room can
 * recover afterwards without the test unwinding anything (TC-14).
 */
export function armWriteFailure(id: string): Promise<void> {
  return onRoom(id, (room) => {
    let armed = true;
    room.store.beforeStatement = (query: string): void => {
      if (armed && query.includes('INSERT INTO updates')) {
        armed = false;
        throw new Error('injected write failure');
      }
    };
  });
}

/**
 * Make the next read the *load* performs fail once (TC-26): the first statement a
 * load runs is the `storage_meta` lookup, so this is a genuine read error inside
 * `BoardStore.load` rather than a test throwing for its own reasons.
 */
export function armLoadReadFailure(id: string): Promise<void> {
  return onRoom(id, (room) => {
    let armed = true;
    room.store.beforeStatement = (query: string): void => {
      if (armed && query.includes('FROM storage_meta')) {
        armed = false;
        throw new Error('injected read failure');
      }
    };
  });
}

/** Move the load-failure moment into the past, as waiting for the retry would. */
export function rewindLoadFailure(id: string): Promise<void> {
  return onRoom(id, (room) => {
    room.loadFailedAt = 0;
  });
}

/** Force the room through its load path again (a wake does this). */
export function reloadRoom(id: string): Promise<RoomState> {
  return onRoom(id, (room) => room.loadNow());
}

export function roomSocketCount(id: string): Promise<number> {
  return onRoom(id, (_room, state) => state.getWebSockets().length);
}

/** One `[sync][update]` frame, exactly as a client sends it. */
export function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** A frame as the runtime would hand it to a handler: a plain ArrayBuffer. */
function frameBuffer(frame: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(frame.byteLength);
  new Uint8Array(buffer).set(frame);
  return buffer;
}

/**
 * Deliver a stranger document's whole state to one of the room's sockets *as the
 * runtime would*: straight into `webSocketMessage`, with a socket taken from
 * `ctx.getWebSockets()` - the only way to hand a message to a socket the object
 * accepted before it last reconstructed its memory (TC-18).
 *
 * The stranger document is built inside the object and the note it wrote comes
 * back, so the test knows what to look for; `delivered` is the index of the socket
 * it went through, which is the one that must not be echoed.
 */
export function deliverStrangerNote(
  id: string,
  color: StickyColor = 'pink',
): Promise<{ sockets: number; delivered: number; noteId: string }> {
  return onRoom(id, (room, state) => {
    const stranger = new Y.Doc();
    initDoc(stranger);
    const noteId = createSticky(stranger, { x: 40, y: 40 }, color);
    const sockets = state.getWebSockets();
    const ws = sockets[0];
    if (ws === undefined) return { sockets: sockets.length, delivered: -1, noteId };
    room.webSocketMessage(ws, frameBuffer(updateFrame(Y.encodeStateAsUpdate(stranger))));
    return { sockets: sockets.length, delivered: sockets.indexOf(ws), noteId };
  });
}

/** Two synced clients on a fresh board, with their logs cleared. */
export async function pairedClients(): Promise<{ id: string; a: TestClient; b: TestClient }> {
  const id = boardId();
  const a = await TestClient.connect(id);
  const b = await TestClient.connect(id);
  await Promise.all([a.waitForSync(), b.waitForSync()]);
  a.clearLog();
  b.clearLog();
  return { id, a, b };
}

export { TestClient };
