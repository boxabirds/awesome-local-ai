// persist.room integration tests: the persistent BoardRoom contract —
// append-before-broadcast, LoadFailed close 4500, StorageFailed close 1011,
// hibernation via ctx.getWebSockets — with real Durable Object, sockets and
// SQLite in workerd. TC-12 to TC-18, TC-26.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { createEncoder, toUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky } from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  __testSetAppendFault,
  __testSetLoadReadFault,
} from '../../src/worker/board-store';
import { buildRetroBoard, notesOf } from '../fixtures/boards';
import { RoomClient, createNote } from './ws-client';

const room = (): string => newBoardId();

async function roomStub(boardId: string): Promise<BoardRoom> {
  return (await env.BOARD_ROOM.get(
    env.BOARD_ROOM.idFromName(boardId),
  )) as unknown as BoardRoom;
}

function notesJson(notes: readonly { id: string }[]): string {
  return notes
    .map((n) => JSON.stringify(n))
    .sort()
    .join('\n');
}

/** Waits for a note id to appear in a client's board. */
async function notesInclude(client: RoomClient, id: string): Promise<void> {
  await vi.waitFor(() => {
    expect(client.notes.map((n) => n.id)).toContain(id);
  });
}

async function sameNotes(a: RoomClient, b: RoomClient): Promise<void> {
  await vi.waitFor(() => {
    expect(notesJson(b.notes)).toBe(notesJson(a.notes));
  });
}

/** A room with 25 stored notes: client creates the retro board and the
 *  room has processed every update (storage reflects the full board). */
async function boardWithRetro(): Promise<{
  id: string;
  room: BoardRoom;
  a: RoomClient;
}> {
  const id = room();
  const a = await RoomClient.connect(id);
  await a.waitForSync();
  buildRetroBoard(a.doc);
  await vi.waitFor(() => expect(a.notes).toHaveLength(25));
  const r = await roomStub(id);
  // Wait until the room has applied every client update (its doc — and
  // therefore its storage log — holds the full board).
  await vi.waitFor(async () => {
    // The DO stub proxies the seam as an RPC promise at runtime.
    const s = (await r.testGetState()) as { notes: number };
    expect(s.notes).toBe(25);
  });
  return { id, room: r, a };
}

afterEach(() => {
  __testSetAppendFault(null);
  __testSetLoadReadFault(null);
});

describe('persist.room', () => {
  it('TC-12: stored before broadcast — by the time B sees the note, the row exists', async () => {
    const id = room();
    const a = await RoomClient.connect(id);
    await a.waitForSync();
    const b = await RoomClient.connect(id);
    await b.waitForSync();

    const noteId = createNote(a, 50, 50);
    await notesInclude(b, noteId);

    const info = await (await roomStub(id)).testInspectStorage();
    expect(info.updates).toBeGreaterThanOrEqual(1);

    // A fresh doc loaded straight from storage contains the note.
    const loaded = await (await roomStub(id)).testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.notes.map((n) => n.id)).toContain(noteId);

    a.close();
    b.close();
  });

  it('TC-13: everyone leaves; a room woken over the same storage has the board', async () => {
    const { id, a } = await boardWithRetro();
    const original = notesOf(a.doc);

    // Everyone leaves and the object hibernates (memory forgotten).
    a.close();
    const r = await roomStub(id);
    await r.testHibernate();

    // A new client on the woken room gets the whole board from storage.
    const c = await RoomClient.connect(id);
    await c.waitForSync();
    await vi.waitFor(() => expect(c.notes).toHaveLength(25));
    expect(notesJson(c.notes)).toBe(notesJson(original));

    c.close();
  });

  it('TC-14: append fault -> 1011 to all; reconnecting A re-sends and B gets it', async () => {
    const id = room();
    const a = await RoomClient.connect(id);
    await a.waitForSync();
    const b = await RoomClient.connect(id);
    await b.waitForSync();
    expect(b.notes).toHaveLength(0);

    // The next append fails once; the room must close everyone with 1011
    // and store/broadcast nothing.
    __testSetAppendFault(() => {
      throw new Error('injected append failure');
    });
    const noteId = createSticky(a.doc, { x: 5, y: 5 });
    if (noteId === '') throw new Error('createSticky failed');

    const [closeA, closeB] = await Promise.all([
      a.waitForClose(),
      b.waitForClose(),
    ]);
    expect(closeA.code).toBe(CLOSE_STORAGE_FAILURE);
    expect(closeB.code).toBe(CLOSE_STORAGE_FAILURE);
    // B never received the update.
    expect(b.notes.map((n) => n.id)).not.toContain(noteId);

    // A reconnects still holding the change; the room (reloaded from
    // storage, which lacks the note) receives it via SyncStep2 and stores
    // it. B reconnects and gets it.
    const a2 = await RoomClient.connect(id, a.doc);
    await a2.waitForSync();
    const b2 = await RoomClient.connect(id);
    await b2.waitForSync();
    await notesInclude(b2, noteId);

    const info = await (await roomStub(id)).testInspectStorage();
    expect(info.updates).toBeGreaterThanOrEqual(1);

    a2.close();
    b2.close();
  });

  it('TC-15: load-failed room closes 4500 and stores nothing (negative)', async () => {
    const { id, room: r, a } = await boardWithRetro();
    a.close();

    // A snapshot must exist for the room to be in the Snapshotted state:
    // force the compaction the board would reach at COMPACTION_UPDATE_COUNT.
    expect(await r.testCompact()).toBe(true);
    await r.testHibernate();
    expect(await r.testCorruptSnapshot()).toBe(1);

    const c = await RoomClient.connect(id);
    const close = await c.waitForClose();
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Nothing from the closed client's sync was stored, and no row moved.
    const info = await r.testInspectStorage();
    expect(info.updates).toBe(0);
    expect(info.quarantined).toBe(0);
    const state = await r.testGetState();
    expect(state.lifecycle).toBe('load-failed');
  });

  it('TC-16: retry interval — 4500 before, loads after LOAD_RETRY_MIN_INTERVAL_MS', async () => {
    const { id, room: r, a } = await boardWithRetro();
    const original = notesOf(a.doc);
    a.close();

    expect(await r.testCompact()).toBe(true);
    await r.testHibernate();
    expect(await r.testCorruptSnapshot()).toBe(1);

    // First connection: wakes, fails to load, enters load-failed.
    const c1 = await RoomClient.connect(id);
    const close1 = await c1.waitForClose();
    expect(close1.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Immediately: still within the retry interval -> 4500, no reload.
    const c2 = await RoomClient.connect(id);
    const close2 = await c2.waitForClose();
    expect(close2.code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect((await r.testGetState()).lifecycle).toBe('load-failed');

    // Repair storage and advance the room's clock past the interval.
    expect(await r.testRepairSnapshot()).toBe(1);
    await r.testSetNowOffset(LOAD_RETRY_MIN_INTERVAL_MS + 1000);

    // Next connection retries the load and gets the board.
    const c3 = await RoomClient.connect(id);
    await c3.waitForSync();
    await vi.waitFor(() => expect(c3.notes).toHaveLength(25));
    expect(notesJson(c3.notes)).toBe(notesJson(original));
    expect((await r.testGetState()).lifecycle).toBe('ready');

    c3.close();
  });

  it('TC-17: garbage update -> 1003 to that socket only; row count unchanged (negative)', async () => {
    const { id, room: r, a } = await boardWithRetro();
    const b = await RoomClient.connect(id);
    await b.waitForSync();
    await sameNotes(a, b);
    const before = await r.testInspectStorage();

    const c = await RoomClient.connect(id);
    await c.waitForSync();
    const inner = createEncoder();
    writeVarUint(inner, sync.messageYjsUpdate);
    writeVarUint8Array(inner, new Uint8Array([1, 2, 3, 4]));
    c.sendSync(toUint8Array(inner));

    const close = await c.waitForClose();
    expect(close.code).toBe(CLOSE_UNSUPPORTED_DATA);

    const after = await r.testInspectStorage();
    expect(after.updates).toBe(before.updates);

    // A and B are unaffected.
    expect(a.isOpen).toBe(true);
    expect(b.isOpen).toBe(true);

    a.close();
    b.close();
  });

  it('TC-18: hibernated room serves pre-hibernation sockets after a message', async () => {
    const id = room();
    const a = await RoomClient.connect(id);
    await a.waitForSync();
    const b = await RoomClient.connect(id);
    await b.waitForSync();

    const n1 = createNote(a, 1, 1);
    await notesInclude(b, n1);

    // Hibernation: memory forgotten, sockets stay open.
    const r = await roomStub(id);
    await r.testHibernate();
    expect((await r.testGetState()).lifecycle).toBe('hibernated');

    // A's next message wakes the room; the update is stored and reaches B
    // via ctx.getWebSockets() — sockets accepted before the freeze.
    const n2 = createNote(a, 2, 2);
    await notesInclude(b, n2);

    const info = await r.testInspectStorage();
    expect(info.updates).toBeGreaterThanOrEqual(2);

    a.close();
    b.close();
  });

  it('TC-26: SQL read error during load -> load-failed, clients closed 4500', async () => {
    const id = room();
    __testSetLoadReadFault(() => {
      throw new Error('injected SQL read error');
    });

    const a = await RoomClient.connect(id);
    const close = await a.waitForClose();
    expect(close.code).toBe(CLOSE_BOARD_LOAD_FAILED);

    const r = await roomStub(id);
    const state = await r.testGetState();
    expect(state.lifecycle).toBe('load-failed');

    // The fault was one-shot: after the interval, the room recovers.
    await r.testSetNowOffset(LOAD_RETRY_MIN_INTERVAL_MS + 1000);
    const b = await RoomClient.connect(id);
    await b.waitForSync();
    expect(b.notes).toHaveLength(0);
    expect((await r.testGetState()).lifecycle).toBe('ready');

    b.close();
  });
});
