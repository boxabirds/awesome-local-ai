// Integration tests for the persistent, hibernating BoardRoom (persist.room):
// against a real Durable Object with real sockets and SQLite storage.
// Covers TC-12..TC-18 and TC-26.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { MESSAGE_SYNC } from '../../src/shared/protocol';
import { BoardStore } from '../../src/worker/board-store';
import { createBoard, createNote, snapshotString, TestClient } from './helpers/ws-client';

const stubFor = (boardId: string): DurableObjectStub =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

/** Storage truth from inside the object: row count + reloaded snapshot. */
async function storageView(boardId: string): Promise<{ rows: number; board: string }> {
  return runInDurableObject(stubFor(boardId), (_obj, state) => {
    const store = new BoardStore(state.storage);
    const doc = new Y.Doc();
    store.load(doc);
    return {
      rows: state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').toArray()[0].c as number,
      board: JSON.stringify(snapshot(doc)),
    };
  });
}

/** Connect without the TestClient handshake wait: for rooms that will refuse. */
async function rawConnect(
  boardId: string,
  doc: Y.Doc,
): Promise<{ ws: WebSocket; closed: Promise<number> }> {
  const response = await SELF.fetch(`http://mocked-worker/api/rooms/${boardId}`, {
    headers: { upgrade: 'websocket', connection: 'Upgrade' },
  });
  const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) throw new Error(`no WebSocket in response (status ${response.status})`);
  ws.accept();
  const closed = new Promise<number>((resolve, reject) => {
    setTimeout(() => reject(new Error('socket did not close')), 10_000);
    ws.addEventListener('close', (event) => resolve((event as CloseEvent).code));
  });
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  try {
    ws.send(encoding.toUint8Array(enc));
  } catch {
    // The room may already have closed the pair; the promise still resolves.
  }
  return { ws, closed };
}

describe('Persistent BoardRoom', () => {
  it('TC-12: an update is in storage by the time another client observes it', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);
    const id = createNote(a, 300, 200);
    await b.waitFor(() => b.snapshot().some((note) => note.id === id), 10_000, 'note on B');
    const view = await storageView(boardId);
    expect(view.rows).toBeGreaterThan(0);
    expect(view.board).toContain(id);
    expect(snapshotString(b)).toContain(id);
    a.destroy();
    b.destroy();
  });

  it('TC-13: a board reloaded from storage after everyone left is byte-equal', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    createNote(a, 100, 100);
    createNote(a, 400, 250);
    await a.waitFor(() => a.snapshot().length === 2);
    const original = snapshotString(a);
    await expect
      .poll(async () => (await storageView(boardId)).board === original, { timeout: 10_000 })
      .toBe(true);
    a.destroy();
    await a.waitForClosed();
    const stored = await storageView(boardId);
    expect(stored.board).toBe(original);
    const c = await TestClient.connect(boardId);
    await c.waitFor(() => c.snapshot().length === 2, 10_000, 'reload two notes');
    expect(snapshotString(c)).toBe(original);
    c.destroy();
  });

  it('TC-14: a failed append closes everyone with 1011; the change survives and re-syncs after reconnect', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    const b = await TestClient.connect(boardId);

    // Inject: the next store.append throws once, then delegates normally.
    await runInDurableObject(stubFor(boardId), (obj) => {
      const room = obj as unknown as { store: BoardStore };
      const original = room.store.append.bind(room.store);
      let fired = false;
      room.store.append = (update: Uint8Array) => {
        if (!fired) {
          fired = true;
          throw new Error('injected storage failure');
        }
        original(update);
      };
    });

    const before = await storageView(boardId);
    const id = createNote(a, 700, 350);

    // Both sockets are closed with 1011; B never receives the note.
    const closeA = await a.waitForClose();
    const closeB = await b.waitForClose();
    expect(closeA).toBe(1011);
    expect(closeB).toBe(1011);
    expect(b.snapshot().some((note) => note.id === id)).toBe(false);
    const during = await storageView(boardId);
    expect(during.rows).toBe(before.rows); // nothing stored for the failed update

    // A still holds the change locally; on reconnect the room reloads and
    // A's SyncStep2 re-delivers the unsaved update, which is now stored.
    const a2 = await TestClient.connect(boardId, a.doc);
    await expect
      .poll(async () => (await storageView(boardId)).board.includes(id), { timeout: 10_000 })
      .toBe(true);
    const after = await storageView(boardId);
    expect(after.rows).toBeGreaterThan(during.rows);
    expect(after.board).toContain(id);

    const b2 = await TestClient.connect(boardId);
    await b2.waitFor(() => b2.snapshot().some((note) => note.id === id), 10_000, 'note on B2');
    a2.destroy();
    b2.destroy();
  });

  it('TC-15: a corrupted snapshot closes connections with 4500 and stores nothing they send', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    createNote(a, 150, 150);
    await a.waitFor(() => a.snapshot().length === 1);

    // Corrupt the snapshot (also compacts first, so damage hits chunk 0).
    const hook = await runInDurableObject(stubFor(boardId), (obj) =>
      (obj as unknown as { corruptSnapshot(): Promise<Response> }).corruptSnapshot(),
    );
    const hookBody = (await hook.json()) as { ok?: boolean; state: string };
    expect(hookBody.state).toBe('load-failed');

    // A new client arrives carrying its own note; it must be refused with
    // 4500 and its SyncStep2 must not reach storage.
    const freshDoc = new Y.Doc();
    createSticky(freshDoc, { x: 999, y: 999 });
    const rowsBefore = (await storageView(boardId)).rows;
    const { closed } = await rawConnect(boardId, freshDoc);
    expect(await closed).toBe(4500);
    const after = await storageView(boardId);
    expect(after.rows).toBe(rowsBefore);
    expect(after.board).not.toContain('999');
    a.destroy();
  });

  it('TC-16: before the retry interval a load-failed room refuses without touching storage; after repair it loads', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    createNote(a, 220, 220);
    await a.waitFor(() => a.snapshot().length === 1);
    const original = snapshotString(a);
    a.destroy();

    await runInDurableObject(stubFor(boardId), (obj) =>
      (obj as unknown as { corruptSnapshot(): Promise<Response> }).corruptSnapshot(),
    );

    // Count load attempts on the shared BoardStore class while refusing.
    const originalLoad = BoardStore.prototype.load;
    let loadCalls = 0;
    BoardStore.prototype.load = function (doc: Y.Doc) {
      loadCalls += 1;
      return originalLoad.call(this, doc);
    };
    try {
      const { closed } = await rawConnect(boardId, new Y.Doc());
      expect(await closed).toBe(4500);
      expect(loadCalls).toBe(0); // no reload attempt before the interval

      // Repair the storage, then wait past the retry interval (the repair
      // reload itself succeeds, proving recovery).
      await runInDurableObject(stubFor(boardId), (obj) =>
        (obj as unknown as { repairSnapshot(): Promise<Response> }).repairSnapshot(),
      );
      const stateAfterRepair = await runInDurableObject(stubFor(boardId), (obj) =>
        (obj as unknown as { state: string }).state,
      );
      expect(stateAfterRepair).toBe('ready');

      const { ws: ws2, closed: closed2 } = await rawConnect(boardId, new Y.Doc());
      // After repair the room is ready again: this socket must not be
      // refused. Give the handshake a moment, then close it ourselves.
      let refused = -1;
      closed2.then((code) => {
        refused = code;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(refused).toBe(-1);
      ws2.close();

      // And a full client loads the original board.
      const c = await TestClient.connect(boardId);
      await c.waitFor(() => c.snapshot().length === 1, 10_000, 'board after repair');
      expect(snapshotString(c)).toBe(original);
      c.destroy();
    } finally {
      BoardStore.prototype.load = originalLoad;
    }
  });

  it('TC-17: a garbage frame closes with 1003 and stores nothing', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    const before = await storageView(boardId);
    a.sendRaw(new Uint8Array([9, 255, 254, 253]));
    expect(await a.waitForClose()).toBe(1003);
    const after = await storageView(boardId);
    expect(after.rows).toBe(before.rows);
  });

  it('TC-18: handler-driven updates reach sockets accepted before reconstruction', async () => {
    const boardId = await createBoard();
    const a = await TestClient.connect(boardId);
    // Simulate a wake: mutate the room doc through a handler-style closure
    // (no client socket origin). Delivery must go through getWebSockets().
    const id = await runInDurableObject(stubFor(boardId), (obj) => {
      const room = obj as unknown as { docInstance: Y.Doc };
      return createSticky(room.docInstance, { x: 60, y: 70 }) as string;
    });
    await a.waitFor(() => a.snapshot().some((note) => note.id === id), 10_000, 'handler update');
    const stored = await storageView(boardId);
    expect(stored.board).toContain(id); // the handler path also stored
    a.destroy();
  });

  it('TC-26: a SQL error on load puts the room in load-failed and refuses clients with 4500', async () => {
    const boardId = await createBoard();
    const originalLoad = BoardStore.prototype.load;
    BoardStore.prototype.load = () => ({
      ok: false,
      reason: 'sql-error',
      error: 'injected sql failure',
    });
    try {
      // The room exists (created via RPC), so the refusal comes from the
      // failed load, not from the story 5 existence check.
      await runInDurableObject(stubFor(boardId), (obj) => {
        (obj as unknown as { loadBoard(): void }).loadBoard();
      });
      const { closed } = await rawConnect(boardId, new Y.Doc());
      expect(await closed).toBe(4500);
    } finally {
      BoardStore.prototype.load = originalLoad;
    }
    // Once storage works again, an explicit reload succeeds; a later
    // connection then loads cleanly (no retry-interval wait needed).
    await runInDurableObject(stubFor(boardId), (obj) => {
      (obj as unknown as { loadBoard(): void }).loadBoard();
    });
    const c = await TestClient.connect(boardId);
    expect(c.snapshot()).toEqual([]);
    c.destroy();
  });
});
