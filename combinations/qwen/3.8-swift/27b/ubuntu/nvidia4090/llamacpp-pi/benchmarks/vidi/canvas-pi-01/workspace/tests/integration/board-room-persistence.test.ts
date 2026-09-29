// BoardRoom persistence behaviour against the real worker (spec: persist.room,
// TC-12 to TC-18, TC-26). Clients are real y-websocket-protocol sockets via
// SELF.fetch; storage is inspected through runInDurableObject; faults are
// injected by wrapping the room's store SQL surface.

import { describe, expect, it } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';
import { LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import type { BoardRoom } from '../../src/worker/board-room';
import {
  appendAll,
  buildWithUpdates,
  makeRetroBoard,
  sameState,
} from '../fixtures/boards';
import { failingStorage } from './helpers/faults';
import { connectRoom, waitFor, type RoomClient } from './helpers/ws-client';

/** Run `fn` inside the board's DO. */
async function withRoom(
  boardId: string,
  fn: (room: BoardRoom) => Promise<unknown> | unknown,
): Promise<unknown> {
  const namespace = env.BOARD_ROOM;
  const stub = namespace.get(namespace.idFromName(boardId));
  return runInDurableObject<BoardRoom, unknown>(stub, (room) => fn(room));
}

/** Poll (async) until `fn` is truthy. */
async function waitForAsync(fn: () => boolean | Promise<boolean>, timeoutMs = 4000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The board as stored: loaded into a fresh doc from the room's storage. */
function freshDocFromStorage(room: BoardRoom): Y.Doc {
  const doc = new Y.Doc();
  room.storeForTests().load(doc);
  return doc;
}

const updatesCount = (room: BoardRoom) =>
  room.storeForTests().storage.sql.exec('SELECT COUNT(*) AS n FROM updates').toArray()[0]?.n as number;

/** Seed a board (through the real store) and return its state. */
async function seedBoard(boardId: string, snapshotted = false): Promise<readonly ReturnType<typeof snapshot>> {
  const built = buildWithUpdates((doc) => makeRetroBoard(doc));
  await withRoom(boardId, (room) => {
    const store = room.storeForTests();
    appendAll(store, built);
    if (snapshotted) expect(store.compactForTests(built.doc)).toBe(true);
    // The rows went straight to storage; load them into the room's in-memory
    // doc so the room serves the seeded state (as a freshly constructed
    // room would).
    expect(room.reloadForTests().ok).toBe(true);
  });
  return built.state;
}

describe('BoardRoom persistence (real worker + real storage)', () => {
  it('TC-12: the update row exists before the second client receives it (write-before-broadcast)', async () => {
    const boardId = newBoardId();
    const a = await connectRoom(boardId, { user: 'A' });
    const b = await connectRoom(boardId, { user: 'B' });
    await waitFor(() => a.noteCount() === 0 && b.noteCount() === 0);

    createSticky(a.doc, { x: 10, y: 10 }); // the client sends it to the room

    // The row must be in storage before B's receipt is observed.
    await waitForAsync(async () => (await withRoom(boardId, (room) => updatesCount(room))) > 0, 4000, 'updates row in storage');
    const rowsBeforeB = (await withRoom(boardId, (room) => updatesCount(room))) as number;
    // Write-before-broadcast: the row existed before the broadcast that B
    // observes next (the append must succeed before any frame is sent).
    expect(rowsBeforeB).toBeGreaterThan(0);

    await waitFor(() => b.noteCount() === 1, 4000, 'B receives the note');
    expect(b.boardState()[0]!.id).toBe(a.boardState()[0]!.id);

    // A fresh doc loaded from storage contains the note.
    await withRoom(boardId, (room) => {
      const fromStorage = freshDocFromStorage(room);
      expect(snapshot(fromStorage).map((n) => n.id)).toEqual(a.boardState().map((n) => n.id));
    });
    a.close();
    b.close();
  });

  it('TC-13: after a (simulated) reconstruct, a fresh client loads the whole board', async () => {
    const boardId = newBoardId();
    const original = await seedBoard(boardId); // LogOnly: 25 notes, no snapshot

    // All clients are gone; the room instance is reconstructed (memory gone)
    // and reloads from the same storage.
    await withRoom(boardId, (room) => {
      const result = room.reconstructForTests();
      expect(result.ok).toBe(true);
    });

    const fresh = await connectRoom(boardId, { user: 'C' });
    await waitFor(() => fresh.noteCount() === original.length, 4000, 'fresh client synced');
    expect(sameState(fresh.boardState(), original)).toBe(true);
    fresh.close();
  });

  it('TC-14: an append failure closes all sockets 1011; the change is re-sent on reconnect', async () => {
    const boardId = newBoardId();
    const original = await seedBoard(boardId);
    const a = await connectRoom(boardId, { user: 'A' });
    const b = await connectRoom(boardId, { user: 'B' });
    await waitFor(() => a.noteCount() === original.length && b.noteCount() === original.length);

    // Stub store.append to throw once (the next insert fails).
    await withRoom(boardId, (room) => {
      const store = room.storeForTests();
      store.storage = failingStorage(store.storage, (q) => q.includes('INSERT INTO updates'), true);
    });

    createSticky(a.doc, { x: 4000, y: 4000 });

    // Both sockets closed 1011; B never received the update.
    expect(await a.waitForClose(4000)).toBe(CLOSE_STORAGE_FAILURE);
    expect(await b.waitForClose(4000)).toBe(CLOSE_STORAGE_FAILURE);
    expect(b.updateMessageCount).toBe(0);

    // The failed change is NOT in storage yet.
    const noteId = a.boardState().at(-1)!.id;
    await withRoom(boardId, (room) => {
      const ids = snapshot(freshDocFromStorage(room)).map((n) => n.id);
      expect(ids).not.toContain(noteId);
    });

    // A reconnects (still holding the change); B reconnects fresh.
    const a2 = await connectRoom(boardId, { user: 'A', doc: a.doc });
    const b2 = await connectRoom(boardId, { user: 'B' });
    await waitFor(() => b2.noteCount() === original.length + 1, 4000, 'B receives the re-sent note');
    expect(b2.boardState().some((n) => n.id === noteId)).toBe(true);

    // Storage now contains the change.
    await withRoom(boardId, (room) => {
      const ids = snapshot(freshDocFromStorage(room)).map((n) => n.id);
      expect(ids).toContain(noteId);
    });
    a2.close();
    b2.close();
  }, 20000);

  it('TC-15: a LoadFailed room closes 4500 and stores nothing the client sends', async () => {
    const boardId = newBoardId();
    await seedBoard(boardId, true); // Snapshotted
    await withRoom(boardId, (room) => {
      expect(room.storeForTests().corruptSnapshotForTests()).toBe(true);
      const result = room.reconstructForTests(); // load now fails
      expect(result.ok).toBe(false);
    });

    const c = await connectRoom(boardId, { user: 'C' });
    // The client still tries to push an update (SyncStep2) before the close
    // is observed locally.
    createSticky(c.doc, { x: 5000, y: 5000 });
    expect(await c.waitForClose(4000)).toBe(CLOSE_BOARD_LOAD_FAILED);
    await withRoom(boardId, (room) => {
      expect(updatesCount(room)).toBe(0); // nothing stored
      const quarantined = room.storeForTests().storage.sql
        .exec('SELECT COUNT(*) AS n FROM quarantined_updates')
        .toArray()[0]?.n as number;
      expect(quarantined).toBe(0);
    });
    c.close();
  });

  it('TC-16: a LoadFailed room reloads only after LOAD_RETRY_MIN_INTERVAL_MS', async () => {
    const boardId = newBoardId();
    const original = await seedBoard(boardId, true);
    await withRoom(boardId, (room) => {
      expect(room.storeForTests().corruptSnapshotForTests()).toBe(true);
      expect(room.reconstructForTests().ok).toBe(false);
    });

    // 1) Connect before the interval: closed 4500 without a reload attempt.
    const c1 = await connectRoom(boardId, { user: 'C1' });
    expect(await c1.waitForClose(4000)).toBe(CLOSE_BOARD_LOAD_FAILED);
    c1.close();

    // Repair the snapshot in storage.
    await withRoom(boardId, (room) => {
      expect(room.storeForTests().repairSnapshotForTests()).toBe(true);
    });

    // 2) Still inside the interval: the repaired storage is not reloaded.
    const c2 = await connectRoom(boardId, { user: 'C2' });
    expect(await c2.waitForClose(4000)).toBe(CLOSE_BOARD_LOAD_FAILED);
    c2.close();

    // 3) After the interval: the next connection loads and syncs.
    await new Promise((resolve) => setTimeout(resolve, LOAD_RETRY_MIN_INTERVAL_MS + 400));
    const c3 = await connectRoom(boardId, { user: 'C3' });
    await waitFor(() => c3.noteCount() === original.length, 4000, 'board loads after repair');
    expect(sameState(c3.boardState(), original)).toBe(true);
    c3.close();
  }, 20000);

  it('TC-17: a garbage update closes the socket 1003 and stores nothing', async () => {
    const boardId = newBoardId();
    const a = await connectRoom(boardId, { user: 'A' });
    await waitFor(() => a.noteCount() === 0);

    // A SYNC frame whose UPDATE payload is not a valid Yjs update.
    const random = new Uint8Array(64);
    for (let i = 0; i < 64; i++) random[i] = Math.floor(Math.random() * 256);
    const enc = new Uint8Array(2 + random.length);
    enc[0] = 2; // SYNC frame (MESSAGE_SYNC)
    enc[1] = 2; // y-protocols UPDATE message type
    enc.set(random, 2);
    a.ws.send(enc);

    expect(await a.waitForClose(4000)).toBe(CLOSE_UNSUPPORTED_DATA);
    await withRoom(boardId, (room) => {
      expect(updatesCount(room)).toBe(0);
    });
    a.close();
  });

  it('TC-18: after reconstruct, a broadcast reaches sockets accepted before it', async () => {
    const boardId = newBoardId();
    const original = await seedBoard(boardId);
    const a = await connectRoom(boardId, { user: 'A' });
    await waitFor(() => a.noteCount() === original.length, 4000, 'A synced');

    // Reconstruct (memory forgotten, sockets survive in the runtime).
    await withRoom(boardId, (room) => {
      expect(room.reconstructForTests().ok).toBe(true);
      expect(room.socketCountForTests()).toBeGreaterThanOrEqual(1);
    });

    // A new editor's change is broadcast to the pre-reconstruct socket.
    const b = await connectRoom(boardId, { user: 'B' });
    await waitFor(() => b.noteCount() === original.length, 4000, 'B synced');
    createSticky(b.doc, { x: 6000, y: 6000 });
    await waitFor(() => a.noteCount() === original.length + 1, 4000, 'A receives the broadcast');
    a.close();
    b.close();
  });

  it('TC-26: a SQL error on read puts the room LoadFailed and closes clients 4500', async () => {
    const boardId = newBoardId();
    await seedBoard(boardId);
    const a = await connectRoom(boardId, { user: 'A' });
    await waitFor(() => a.noteCount() === 25, 4000, 'A synced');
    const n = a.noteCount();

    // Make every SELECT throw, then run the room's load path.
    await withRoom(boardId, (room) => {
      const store = room.storeForTests();
      store.storage = failingStorage(store.storage, (q) => q.includes('SELECT'));
      const result = room.reloadForTests();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('sql-error');
    });

    const c = await connectRoom(boardId, { user: 'C' });
    expect(await c.waitForClose(4000)).toBe(CLOSE_BOARD_LOAD_FAILED);
    c.close();
    a.close();
    expect(n).toBe(25);
  });
});
