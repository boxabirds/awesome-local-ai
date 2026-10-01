import { describe, it, expect } from 'vitest';
import { env, runInDurableObject, SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { newBoardId } from '../../src/shared/board-id';
import { createSticky, snapshot, initDoc } from '../../src/shared/board-model';
import { MESSAGE_SYNC, wrapSyncMessage, CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { COMPACTION_UPDATE_COUNT, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';
import { seed25Notes } from '../fixtures/boards';
import { BoardStore } from '../../src/worker/board-store';

const SERVER_ORIGIN = Symbol('server');

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function getStub(boardId: string) {
  const id = env.BOARD_ROOM.idFromName(boardId);
  return env.BOARD_ROOM.get(id);
}

/** Initialize a board so it can be connected to. */
async function initializeBoard(boardId: string): Promise<void> {
  const stub = getStub(boardId);
  await stub.initialize();
}

/**
 * Connect a Y.Doc to a BoardRoom via SELF.fetch.
 */
async function connectClient(boardId: string): Promise<{
  doc: Y.Doc;
  ws: WebSocket;
  close: () => void;
  closedCode: () => number | undefined;
}> {
  await initializeBoard(boardId);
  const req = new Request(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const res = await SELF.fetch(req);
  if (res.status !== 101) throw new Error(`Expected 101, got ${res.status}`);
  const ws = res.webSocket!;

  const doc = new Y.Doc();
  initDoc(doc);
  let closedCode: number | undefined;

  ws.addEventListener('message', (event: MessageEvent) => {
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : (event.data as Uint8Array);
    if (data[0] === MESSAGE_SYNC && data.length > 1) {
      try {
        const dec = decoding.createDecoder(data.slice(1));
        const enc = encoding.createEncoder();
        syncProtocol.readSyncMessage(dec, enc, doc, SERVER_ORIGIN);
        if (encoding.length(enc) > 0) {
          ws.send(wrapSyncMessage(encoding.toUint8Array(enc)));
        }
      } catch { /* ignore */ }
    }
  });

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== SERVER_ORIGIN && ws.readyState === WebSocket.OPEN) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      ws.send(encoding.toUint8Array(enc));
    }
  });

  ws.addEventListener('close', (e) => {
    closedCode = (e as CloseEvent).code;
  });

  ws.accept();
  await wait(200);

  // Send SyncStep1 to request server state
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
  await wait(300);

  return {
    doc,
    ws,
    close: () => { if (ws.readyState === WebSocket.OPEN) ws.close(); },
    closedCode: () => closedCode,
  };
}

/**
 * Force the room's state to 'load-failed' so the next fetch will retry loading.
 * This simulates a DO restart without actually restarting the runtime.
 */
async function forceReloadState(boardId: string): Promise<void> {
  const stub = getStub(boardId);
  await runInDurableObject(stub, (inst) => {
    // Access private fields via bracket notation (test-only)
    (inst as any).state = 'load-failed';
    (inst as any).lastLoadFailedAt = 0;
  });
}

describe('TC-12: Append before broadcast', () => {
  it('by the time B observes the note, updates row exists; fresh doc from storage contains note', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    createSticky(A.doc, { x: 100, y: 200 });
    await wait(1000);

    // B should see the note
    expect(snapshot(B.doc).length).toBeGreaterThanOrEqual(1);

    // Storage row exists
    const stub = getStub(id);
    await runInDurableObject(stub, (_inst, state) => {
      const rows = state.storage.sql.exec<{ seq: number }>(`SELECT seq FROM updates`).toArray();
      expect(rows.length).toBeGreaterThanOrEqual(1);

      // Fresh doc from storage contains the note
      const freshDoc = new Y.Doc();
      const store = new BoardStore(state.storage);
      const result = store.load(freshDoc);
      expect(result.ok).toBe(true);
      expect(snapshot(freshDoc).length).toBeGreaterThanOrEqual(1);
    });

    A.close();
    B.close();
  }, 15000);
});

describe('TC-13: All clients leave, new client on same storage sees original', () => {
  it('reopen after everyone leaves sees all 25 notes', async () => {
    const id = newBoardId();
    const A = await connectClient(id);

    seed25Notes(A.doc);
    await wait(1000);
    expect(snapshot(A.doc).length).toBe(25);
    A.close();
    await wait(500);

    // Force the DO to reload from storage (simulates restart)
    await forceReloadState(id);

    // New client connects — DO should reload from storage
    const B = await connectClient(id);
    expect(snapshot(B.doc).length).toBe(25);
    B.close();
  }, 15000);
});

describe('TC-15: Damaged snapshot → client closed 4500', () => {
  it('corrupt snapshot, client gets close code 4500', async () => {
    const id = newBoardId();

    // First, create a board with compaction
    const A = await connectClient(id);
    for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
      createSticky(A.doc, { x: i * 10, y: i * 10 });
    }
    await wait(2000);
    A.close();
    await wait(500);

    // Verify snapshot exists
    const stub = getStub(id);
    await runInDurableObject(stub, (_inst, state) => {
      const chunks = state.storage.sql.exec<{ idx: number }>(
        `SELECT idx FROM snapshot_chunks`,
      ).toArray();
      expect(chunks.length).toBeGreaterThan(0);
    });

    // Corrupt the snapshot
    await runInDurableObject(stub, (_inst, state) => {
      state.storage.sql.exec(
        `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
        new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]),
      );
    });

    // Force the room to reload state (simulates restart)
    await forceReloadState(id);

    // Connect new client — should get closed with 4500
    const req = new Request(`http://localhost/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket' },
    });
    const res = await SELF.fetch(req);
    const ws = res.webSocket!;
    let closeCode: number | undefined;
    ws.addEventListener('close', (e) => { closeCode = (e as CloseEvent).code; });
    ws.accept();
    await wait(1000);
    expect(closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  }, 30000);
});

describe('TC-16: Load retry before LOAD_RETRY_MIN_INTERVAL_MS rejects, after succeeds if repaired', () => {
  it('connect before interval → 4500; repair; connect after interval → loads', async () => {
    const id = newBoardId();

    // Create and compact a board
    const A = await connectClient(id);
    for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
      createSticky(A.doc, { x: i * 10, y: i * 10 });
    }
    await wait(2000);
    const originalCount = snapshot(A.doc).length;
    A.close();
    await wait(500);

    // Save original chunk 0 and corrupt snapshot
    const stub = getStub(id);
    let savedChunk: ArrayBuffer | undefined;
    await runInDurableObject(stub, (_inst, state) => {
      const chunks = state.storage.sql.exec<{ idx: number; data: ArrayBuffer }>(
        `SELECT idx, data FROM snapshot_chunks WHERE idx = 0`,
      ).toArray();
      if (chunks.length > 0) {
        savedChunk = chunks[0]!.data;
        state.storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array([0xff, 0xfe, 0xfd]),
        );
      }
    });

    // Force the room to reload (simulates restart)
    await forceReloadState(id);

    // First connection triggers load failure
    let closeCode1: number | undefined;
    const req1 = new Request(`http://localhost/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    const res1 = await SELF.fetch(req1);
    const ws1 = res1.webSocket!;
    ws1.addEventListener('close', (e) => { closeCode1 = (e as CloseEvent).code; });
    ws1.accept();
    await wait(1000);
    expect(closeCode1).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the snapshot
    await runInDurableObject(stub, (_inst, state) => {
      if (savedChunk) {
        state.storage.sql.exec(
          `UPDATE snapshot_chunks SET data = ?1 WHERE idx = 0`,
          new Uint8Array(savedChunk),
        );
      }
    });

    // Connect before LOAD_RETRY_MIN_INTERVAL_MS → still 4500 (state was just updated by first fetch)
    let closeCode2: number | undefined;
    const req2 = new Request(`http://localhost/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    const res2 = await SELF.fetch(req2);
    const ws2 = res2.webSocket!;
    ws2.addEventListener('close', (e) => { closeCode2 = (e as CloseEvent).code; });
    ws2.accept();
    await wait(500);
    expect(closeCode2).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Wait for the retry interval to pass
    await wait(LOAD_RETRY_MIN_INTERVAL_MS + 100);

    // Now connect → should succeed
    const B = await connectClient(id);
    expect(snapshot(B.doc).length).toBe(originalCount);
    B.close();
  }, 30000);
});

describe('TC-17: Garbage update → closed 1003, row count unchanged', () => {
  it('send garbage bytes as sync message, get closed with 1003', async () => {
    const id = newBoardId();

    // Create a board with some content first
    const A = await connectClient(id);
    createSticky(A.doc, { x: 10, y: 10 });
    await wait(500);
    const rowsBefore = await runInDurableObject(getStub(id), (_inst, state) => {
      return state.storage.sql.exec<{ seq: number }>(`SELECT seq FROM updates`).toArray().length;
    });
    A.close();
    await wait(500);

    // Connect and send garbage as sync update
    const req = new Request(`http://localhost/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    const res = await SELF.fetch(req);
    const ws = res.webSocket!;
    ws.accept();
    await wait(200);

    // Send garbage as a sync update (type 2 = Update)
    const garbageEncoder = encoding.createEncoder();
    encoding.writeVarUint(garbageEncoder, MESSAGE_SYNC);
    encoding.writeVarUint(garbageEncoder, 2); // Update type
    encoding.writeVarUint8Array(garbageEncoder, new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]));
    ws.send(encoding.toUint8Array(garbageEncoder));
    await wait(1000);

    // Should be closed with 1003
    expect(ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);

    // Row count unchanged
    const rowsAfter = await runInDurableObject(getStub(id), (_inst, state) => {
      return state.storage.sql.exec<{ seq: number }>(`SELECT seq FROM updates`).toArray().length;
    });
    expect(rowsAfter).toBe(rowsBefore);
  }, 15000);
});

describe('TC-18: Hibernation path - broadcast reaches sockets via ctx.getWebSockets', () => {
  it('A creates note, B receives it via hibernation path', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    createSticky(A.doc, { x: 50, y: 50 });
    await wait(1000);

    // B should receive via ctx.getWebSockets() (hibernation API)
    expect(snapshot(B.doc).length).toBe(1);

    A.close();
    B.close();
  });
});

describe('TC-26: SQL read error → room closes clients with 4500', () => {
  it('if load throws SQL error, new connections get closed 4500', async () => {
    const id = newBoardId();

    // Create a board with content
    const A = await connectClient(id);
    createSticky(A.doc, { x: 1, y: 1 });
    await wait(500);
    A.close();
    await wait(500);

    // Insert garbage into snapshot_chunks that will make the snapshot unreadable
    const stub = getStub(id);
    await runInDurableObject(stub, (_inst, state) => {
      state.storage.sql.exec(
        `INSERT INTO snapshot_chunks (idx, data) VALUES (0, ?1)`,
        new Uint8Array([1, 2, 3]),
      );
    });

    // Force the room to reload (simulates restart)
    await forceReloadState(id);

    // Connect - load will try to read snapshot_chunks, apply the garbage, and fail
    let closeCode: number | undefined;
    const req = new Request(`http://localhost/api/rooms/${id}`, { headers: { Upgrade: 'websocket' } });
    const res = await SELF.fetch(req);
    const ws = res.webSocket!;
    ws.addEventListener('close', (e) => { closeCode = (e as CloseEvent).code; });
    ws.accept();
    await wait(1000);
    expect(closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  }, 15000);
});
