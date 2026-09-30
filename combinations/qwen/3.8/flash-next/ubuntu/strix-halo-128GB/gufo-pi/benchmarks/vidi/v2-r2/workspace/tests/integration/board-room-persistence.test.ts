/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { env, SELF, runInDurableObject } from 'cloudflare:test';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { createSyncClient, openWebSocket, TestSyncClient } from './ws-client';
import { createSticky, getStickyText, snapshot } from '@shared/board-model';
import { newBoardId } from '@shared/board-id';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '@shared/protocol';
import { BoardStore } from '../../src/worker/board-store';

const waitFor = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The DO stub is typed loosely here so test-only hook methods can be called;
// vitest integration tests are excluded from `npm run typecheck`.
function stubFor(boardId: string): any {
  return env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
}

function makeNotes(doc: Y.Doc, n: number): void {
  for (let i = 0; i < n; i++) {
    const id = createSticky(doc, { x: i * 120, y: (i % 5) * 90 }, 'blue');
    getStickyText(doc, id)?.insert(0, `note ${i}`);
  }
}

function recordCloseCode(ws: WebSocket | null): () => number | null {
  let code: number | null = null;
  if (ws) ws.addEventListener('close', (e) => { code = e.code; });
  return () => code;
}

// Re-attach an EXISTING doc to a new socket (a page that kept its content and
// reconnects). Reuses the local content; the server's fetch-pushed SyncStep1 makes
// us send our SyncStep2 so unsaved changes are re-sent.
async function reconnectDoc(boardId: string, doc: Y.Doc): Promise<TestSyncClient> {
  const c = new TestSyncClient();
  c.doc = doc;
  c.startListening();
  const ws = await openWebSocket(SELF, boardId);
  c.connect(ws);
  await c.waitForSync();
  return c;
}

describe('BoardRoom persistence', () => {
  it('TC-12: a note B receives is already stored; fresh doc from storage has it', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    const b = await createSyncClient(SELF, boardId);

    createSticky(a.doc, { x: 100, y: 100 }, 'blue');
    await waitFor(500);
    expect(snapshot(b.doc).length).toBe(1); // B observed the change -> server stored before broadcast

    await a.close();
    await b.close();

    const stored = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      const fresh = new Y.Doc();
      const res = store.load(fresh);
      const upRows = state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c;
      return { ok: res.ok, notes: snapshot(fresh).length, upRows };
    });
    expect(stored.ok).toBe(true);
    expect(stored.notes).toBe(1); // fresh doc from storage contains the note
    expect(stored.upRows).toBeGreaterThanOrEqual(1);
  });

  it('TC-13: after all disconnect, a reload + new client sees the original 25 notes', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    const b = await createSyncClient(SELF, boardId);
    makeNotes(a.doc, 25);
    await waitFor(600);
    const original = JSON.stringify(snapshot(a.doc));
    expect(snapshot(b.doc).length).toBe(25);

    await a.close();
    await b.close();

    await stub.__testReload(); // simulate a fresh room instance over the same storage
    const c = await createSyncClient(SELF, boardId);
    expect(JSON.stringify(snapshot(c.doc))).toBe(original);
    await c.close();
  });

  it('TC-14: failed write is not broadcast; reconnect re-saves and delivers it', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    const b = await createSyncClient(SELF, boardId);
    const aCode = recordCloseCode(a.ws);
    const bCode = recordCloseCode(b.ws);

    // Make the next append throw exactly once.
    await runInDurableObject(stub, (inst) => {
      const room = inst as any;
      const real = room.store.append.bind(room.store);
      let thrown = false;
      room.store.append = (u: Uint8Array) => {
        if (!thrown) {
          thrown = true;
          throw new Error('injected write failure');
        }
        return real(u);
      };
    });

    const id = createSticky(a.doc, { x: 7, y: 7 }, 'pink'); // triggers the throw
    void id;
    await waitFor(600);

    // Both sockets closed 1011; B never received the change.
    expect(aCode()).toBe(CLOSE_STORAGE_FAILURE);
    expect(bCode()).toBe(CLOSE_STORAGE_FAILURE);
    expect(snapshot(b.doc).length).toBe(0); // unsaved change was NOT broadcast
    expect(await stub.__testGetState()).toBe('storage-failed');

    // Reconnect A (which still holds the change). The throw-once is spent, so the
    // re-sent update is now saved and delivered.
    const a2 = await reconnectDoc(boardId, a.doc);
    await waitFor(600);

    const b2 = await createSyncClient(SELF, boardId);
    await waitFor(400);
    expect(snapshot(b2.doc).length).toBe(1); // B receives it after recovery

    const stored = await runInDurableObject(stub, (_inst, state) => {
      const store = new BoardStore(state.storage);
      const fresh = new Y.Doc();
      store.load(fresh);
      return snapshot(fresh).length;
    });
    expect(stored).toBe(1); // storage contains it
    await a2.close();
    await b2.close();
  });

  it('TC-15: damaged snapshot -> client closed 4500, nothing stored', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    makeNotes(a.doc, 25);
    await waitFor(600);
    await a.close();

    // Fabricate a snapshot header whose chunk 0 is unreadable, then reload -> load-failed.
    await runInDurableObject(stub, (inst, state) => {
      const maxSeq = state.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m;
      state.storage.sql
        .exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)`, String(maxSeq))
        .toArray();
      const corrupt = new Uint8Array(48);
      for (let i = 0; i < corrupt.length; i++) corrupt[i] = (Math.random() * 256) | 0;
      state.storage.sql.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (0, ?)', corrupt.buffer.slice(0)).toArray();
      (inst as any).attemptLoad();
    });

    const before = await runInDurableObject(stub, (_inst, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c,
    );

    // Connect -> closed 4500; no empty board served; no updates stored even though
    // the client pushes a SyncStep2 before the close is processed.
    const ws = await openWebSocket(SELF, boardId);
    const codeP = new Promise<number>((res) => ws.addEventListener('close', (e) => res(e.code)));
    const payload = new Y.Doc();
    createSticky(payload, { x: 12345, y: 12345 }, 'red');
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(enc, payload);
    try {
      ws.send(encoding.toUint8Array(enc));
    } catch {
      /* socket may already be closing */
    }
    const code = await codeP;
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await stub.__testGetState()).toBe('load-failed');

    await waitFor(300);
    const after = await runInDurableObject(stub, (_inst, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c,
    );
    expect(after).toBe(before); // no updates stored from the refused connection
  });

  it('TC-16: before interval -> 4500 with no reload; after repair + interval -> loads', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    makeNotes(a.doc, 25);
    await waitFor(600);
    await a.close();

    // Damage the snapshot and reload once -> load-failed.
    await runInDurableObject(stub, (inst, state) => {
      const maxSeq = state.storage.sql.exec('SELECT MAX(seq) AS m FROM updates').one().m;
      state.storage.sql
        .exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', ?)`, String(maxSeq))
        .toArray();
      const corrupt = new Uint8Array(48);
      for (let i = 0; i < corrupt.length; i++) corrupt[i] = (Math.random() * 256) | 0;
      state.storage.sql.exec('INSERT OR REPLACE INTO snapshot_chunks (idx, data) VALUES (0, ?)', corrupt.buffer.slice(0)).toArray();
      (inst as any).attemptLoad();
    });
    const loadCountAfterDamage = await stub.__testLoadCount();

    // Connect immediately (before LOAD_RETRY_MIN_INTERVAL_MS): closed 4500, no reload.
    const ws = await openWebSocket(SELF, boardId);
    const codeP = new Promise<number>((res) => ws.addEventListener('close', (e) => res(e.code)));
    const code = await codeP;
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(await stub.__testLoadCount()).toBe(loadCountAfterDamage); // no reload attempt

    // Repair storage: drop the fake snapshot so the log rebuilds the board.
    await runInDurableObject(stub, (_inst, state) => {
      state.storage.sql.exec('DELETE FROM snapshot_chunks').toArray();
      state.storage.sql
        .exec(`INSERT OR REPLACE INTO storage_meta (key, value) VALUES ('snapshot_through_seq', '0')`)
        .toArray();
    });
    // Pretend the retry interval has elapsed, then reconnect.
    await stub.__testSetLastLoadFailure(0);

    const c = await createSyncClient(SELF, boardId);
    expect(await stub.__testGetState()).toBe('ready');
    expect(snapshot(c.doc).length).toBe(25); // second attempt loaded and synced
    expect(await stub.__testLoadCount()).toBeGreaterThan(loadCountAfterDamage);
    await c.close();
  });

  it('TC-17: garbage update -> closed 1003; update row count unchanged', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    const b = await createSyncClient(SELF, boardId);
    const aCode = recordCloseCode(a.ws);

    const baseline = await runInDurableObject(stub, (_inst, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c,
    );

    // A sends a garbage sync payload (declares length but truncated).
    a.sendRaw(new Uint8Array([0, 0, 255, 255, 255]));
    await waitFor(500);

    expect(aCode()).toBe(CLOSE_UNSUPPORTED_DATA);
    const after = await runInDurableObject(stub, (_inst, state) =>
      state.storage.sql.exec('SELECT COUNT(*) AS c FROM updates').one().c,
    );
    expect(after).toBe(baseline); // rejected garbage was not stored
    await b.close();
  });

  it('TC-18: after reconstruct (reload), broadcast reaches sockets accepted before it', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    const b = await createSyncClient(SELF, boardId);

    // Simulate hibernate+wake: the room reloads while both sockets stay accepted.
    await stub.__testReload();
    await waitFor(200);

    createSticky(a.doc, { x: 300, y: 300 }, 'green');
    await waitFor(600);
    expect(snapshot(b.doc).length).toBe(1); // handler used ctx.getWebSockets() to reach B
    await a.close();
    await b.close();
  });

  it('TC-26: SQL error on read -> load ok:false sql-error; new sockets closed 4500', async () => {
    const boardId = newBoardId();
    const stub = stubFor(boardId);
    const a = await createSyncClient(SELF, boardId);
    makeNotes(a.doc, 25);
    await waitFor(600);
    await a.close();

    // Make the store's load throw (SQL error on read).
    await runInDurableObject(stub, (inst) => {
      (inst as any).store.load = () => {
        throw new Error('injected read failure');
      };
    });
    await stub.__testReload();

    expect(await stub.__testGetState()).toBe('load-failed');
    expect(await stub.__testLastLoadReason()).toBe('sql-error');

    const ws = await openWebSocket(SELF, boardId);
    const codeP = new Promise<number>((res) => ws.addEventListener('close', (e) => res(e.code)));
    const code = await codeP;
    expect(code).toBe(CLOSE_BOARD_LOAD_FAILED); // closed with 4500, not served empty
  });
});
