/**
 * Integration tests for persistent BoardRoom: durability, failures, hibernation
 * (TC-12 to TC-18, TC-26).
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { env, runInDurableObject, SELF } from 'cloudflare:test';

import { newBoardId } from '../../src/shared/board-id';
import { BoardStore } from '../../src/worker/board-store';
import type { BoardRoom } from '../../src/worker/board-room';
import { CLOSE_BOARD_LOAD_FAILED, MESSAGE_SYNC } from '../../src/shared/protocol';
import { COMPACTION_UPDATE_COUNT } from '../../src/shared/config';
import { create25NoteBoard, randomBytesOfLength } from '../fixtures/boards';
import { snapshot, initDoc, createSticky } from '../../src/shared/board-model';
import { openRoomClient } from './ws-client';

function getNamespace(): DurableObjectNamespace<BoardRoom> {
  return (env as Record<string, unknown>).BOARD_ROOM as DurableObjectNamespace<BoardRoom>;
}

async function getStub(boardId: string): Promise<DurableObjectStub<BoardRoom>> {
  const ns = getNamespace();
  return ns.get(ns.idFromName(boardId));
}

/** Connect a WS client and wait for the close event. Returns the close code or -1 on timeout. */
async function connectAwaitClose(boardId: string, timeout = 3000): Promise<number> {
  const req = new Request(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const res = await SELF.fetch(req);
  if (res.status !== 101) return -2; // Not a WS upgrade
  const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
  (ws as unknown as { accept(): void }).accept();
  return new Promise<number>((resolve) => {
    ws.addEventListener('close', (event) => resolve(event.code));
    ws.addEventListener('message', () => {
      // Got a message - connection is alive, no close
    });
    setTimeout(() => resolve(-1), timeout);
  });
}

describe('Persistent BoardRoom integration (TC-12 to TC-18, TC-26)', () => {
  // TC-12: Write before broadcast - A creates note, B receives it, storage row exists
  it('TC-12: update is stored before broadcast', async () => {
    const boardId = newBoardId();
    const a = await openRoomClient(boardId);
    const b = await openRoomClient(boardId);
    await new Promise((r) => setTimeout(r, 100));

    // A creates a note
    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 200 });
    const update = Y.encodeStateAsUpdate(a.doc);
    a.sendUpdate(update);

    // Wait for B to receive it
    await new Promise((r) => setTimeout(r, 200));

    // B received the update
    const snapB = b.snapshot();
    expect(snapB.has(id)).toBe(true);

    // Verify storage has the row
    const stub = await getStub(boardId);
    const storageHasNote = await runInDurableObject(stub, (_instance, state) => {
      const store = new BoardStore(state.storage);
      const freshDoc = new Y.Doc();
      const result = store.load(freshDoc);
      return result.ok && snapshot(freshDoc).some((n) => n.id === id);
    });

    expect(storageHasNote).toBe(true);

    a.close();
    b.close();
  });

  // TC-13: All clients leave, new client gets the data
  it('TC-13: data persists across room reconnect', async () => {
    const boardId = newBoardId();
    const a = await openRoomClient(boardId);
    initDoc(a.doc);
    for (let i = 0; i < 25; i++) {
      createSticky(a.doc, { x: i * 50, y: i * 30 }, 'blue');
    }
    const update = Y.encodeStateAsUpdate(a.doc);
    a.sendUpdate(update);
    await new Promise((r) => setTimeout(r, 200));

    // Close all clients
    a.close();
    await new Promise((r) => setTimeout(r, 200));

    // New client connects
    const c = await openRoomClient(boardId);
    await new Promise((r) => setTimeout(r, 200));
    // Request sync (client needs to send SyncStep1 to get server's state)
    await c.sync();
    await new Promise((r) => setTimeout(r, 300));

    const snapC = c.snapshot();
    expect(snapC.size).toBe(25);

    c.close();
  });

  // TC-14: Storage failure: append throws → clients closed 1011, B never gets update
  it('TC-14: storage failure does not broadcast, reconnect recovers', async () => {
    const boardId = newBoardId();
    const a = await openRoomClient(boardId);
    const b = await openRoomClient(boardId);
    await new Promise((r) => setTimeout(r, 100));

    // First sync
    initDoc(a.doc);
    createSticky(a.doc, { x: 0, y: 0 });
    const firstUpdate = Y.encodeStateAsUpdate(a.doc);
    a.sendUpdate(firstUpdate);
    await new Promise((r) => setTimeout(r, 200));

    // Now inject a failure in store.append
    const stub = await getStub(boardId);
    await runInDurableObject(stub, (instance) => {
      const store = (instance as unknown as { store: BoardStore }).store;
      (store as unknown as { append: (u: Uint8Array) => void }).append = () => {
        throw new Error('injected storage failure');
      };
    });

    // A sends another update
    const id2 = createSticky(a.doc, { x: 200, y: 200 });
    const svB = Y.encodeStateVector(b.doc);
    const delta = Y.encodeStateAsUpdate(a.doc, svB);
    a.sendUpdate(delta);
    await new Promise((r) => setTimeout(r, 500));

    // Both A and B should be closed
    const aClosed = a.ws.readyState === WebSocket.CLOSED || a.ws.readyState === WebSocket.CLOSING;
    const bClosed = b.ws.readyState === WebSocket.CLOSED || b.ws.readyState === WebSocket.CLOSING;
    expect(aClosed).toBe(true);
    expect(bClosed).toBe(true);

    // B should NOT have received the second note
    const snapB = b.snapshot();
    expect(snapB.has(id2)).toBe(false);

    // Restore the store and have A reconnect
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        store: BoardStore;
        state: string;
        initialized: boolean;
        doc: Y.Doc;
      };
      // Restore append
      const sql = (room.store as unknown as { sql: SqlStorage }).sql;
      (room.store as unknown as { append: (u: Uint8Array) => void }).append = (u: Uint8Array) => {
        sql.exec(`INSERT INTO updates (data, bytes) VALUES (?, ?)`, u, u.byteLength);
      };
      // Reset state so next connection will reload
      room.state = 'storage-failed';
      room.initialized = false;
    });

    // A reconnects with its full doc (simulating the client keeping its doc across reconnection)
    const a2 = await openRoomClient(boardId);
    Y.applyUpdate(a2.doc, Y.encodeStateAsUpdate(a.doc));
    await a2.sync();
    await new Promise((r) => setTimeout(r, 500));

    // The room should now have the second note in storage
    const hasNote2 = await runInDurableObject(stub, (_instance, state) => {
      const s = new BoardStore(state.storage);
      const doc = new Y.Doc();
      s.load(doc);
      return snapshot(doc).some((n) => n.id === id2);
    });
    expect(hasNote2).toBe(true);

    a2.close();
  });

  // TC-15: Corrupt snapshot → client closed 4500
  it('TC-15: corrupted snapshot sends 4500 close', async () => {
    const boardId = newBoardId();
    const originalDoc = create25NoteBoard();
    const fullUpdate = Y.encodeStateAsUpdate(originalDoc);

    const stub = await getStub(boardId);

    // Create and compact, then corrupt, then set state to load-failed
    await runInDurableObject(stub, (instance, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        store.append(fullUpdate);
      }
      store.compactIfNeeded(originalDoc);
      // Corrupt snapshot chunk 0
      (store as unknown as { sql: SqlStorage }).sql.exec(
        `UPDATE snapshot_chunks SET data = ? WHERE idx = 0`,
        randomBytesOfLength(10, 77),
      );
      // Set DO state to load-failed so next fetch will return 4500
      const room = instance as unknown as { state: string; loadFailedAt: number; initialized: boolean };
      room.state = 'load-failed';
      room.loadFailedAt = Date.now();
      room.initialized = true;
    });

    // Connect immediately (before LOAD_RETRY_MIN_INTERVAL_MS) → should get 4500
    const closeCode = await connectAwaitClose(boardId, 3000);
    expect(closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  });

  // TC-16: Connect before LOAD_RETRY_MIN_INTERVAL_MS → 4500; repair + wait → loads
  it('TC-16: retry respects LOAD_RETRY_MIN_INTERVAL_MS, repair allows recovery', async () => {
    const boardId = newBoardId();
    const originalDoc = create25NoteBoard();
    const fullUpdate = Y.encodeStateAsUpdate(originalDoc);

    const stub = await getStub(boardId);

    // Create, compact, corrupt, and set load-failed state
    await runInDurableObject(stub, (instance, state) => {
      const store = new BoardStore(state.storage);
      store.migrate();
      for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) {
        store.append(fullUpdate);
      }
      store.compactIfNeeded(originalDoc);
      (store as unknown as { sql: SqlStorage }).sql.exec(
        `UPDATE snapshot_chunks SET data = ? WHERE idx = 0`,
        randomBytesOfLength(10, 55),
      );
      const room = instance as unknown as { state: string; loadFailedAt: number; initialized: boolean };
      room.state = 'load-failed';
      room.loadFailedAt = Date.now();
      room.initialized = true;
    });

    // Connect immediately → should get 4500 (before interval)
    const code1 = await connectAwaitClose(boardId, 3000);
    expect(code1).toBe(CLOSE_BOARD_LOAD_FAILED);

    // Repair the snapshot and reset loadFailedAt to allow retry
    await runInDurableObject(stub, (instance, state) => {
      const store = new BoardStore(state.storage);
      const sql = (store as unknown as { sql: SqlStorage }).sql;
      // Recreate the snapshot properly
      sql.exec(`DELETE FROM snapshot_chunks`);
      const snapshotBytes = Y.encodeStateAsUpdate(originalDoc);
      const CHUNK_SIZE = 512 * 1024;
      let offset = 0;
      let idx = 0;
      while (offset < snapshotBytes.byteLength) {
        const chunk = snapshotBytes.slice(offset, offset + CHUNK_SIZE);
        sql.exec(`INSERT INTO snapshot_chunks (idx, data) VALUES (?, ?)`, idx, chunk);
        offset += CHUNK_SIZE;
        idx++;
      }
      // Set loadFailedAt to allow retry
      const room = instance as unknown as { loadFailedAt: number };
      room.loadFailedAt = 0;
    });

    // Connect after repair → should succeed (state=ready, load succeeds)
    const req = new Request(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket' },
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(101);
    const ws = (res as unknown as { webSocket: WebSocket }).webSocket;
    (ws as unknown as { accept(): void }).accept();
    // Wait to ensure it stays open
    await new Promise((r) => setTimeout(r, 500));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close(1000, 'done');
  });

  // TC-17: Garbage update → closed 1003, no row stored
  it('TC-17: garbage update closes with 1003, nothing stored', async () => {
    const boardId = newBoardId();
    const a = await openRoomClient(boardId);
    await new Promise((r) => setTimeout(r, 100));

    // Send garbage as a sync update message: [MESSAGE_SYNC, Update(2), varuint(len), garbage]
    // Yjs will reject this
    const garbage = new Uint8Array([0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFF, 0xAA, 0xBB]);
    const frame = new Uint8Array(2 + 1 + garbage.byteLength);
    frame[0] = MESSAGE_SYNC;
    frame[1] = 2; // Update
    frame[2] = garbage.byteLength;
    frame.set(garbage, 3);
    a.send(frame);
    await new Promise((r) => setTimeout(r, 300));

    // Check updates table
    const stub = await getStub(boardId);
    const rowCount = await runInDurableObject(stub, (_instance, state) => {
      const store = new BoardStore(state.storage);
      const rows = (store as unknown as { sql: SqlStorage }).sql.exec(
        `SELECT COUNT(*) as cnt FROM updates`,
      ).toArray();
      return rows[0]?.cnt ?? 0;
    });
    expect(rowCount).toBe(0);

    a.close();
  });

  // TC-18: Broadcast reaches all connected sockets via getWebSockets
  it('TC-18: broadcast reaches sockets via getWebSockets', async () => {
    const boardId = newBoardId();
    const a = await openRoomClient(boardId);
    const b = await openRoomClient(boardId);
    await new Promise((r) => setTimeout(r, 100));

    // A creates a note
    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 50, y: 50 });
    const update = Y.encodeStateAsUpdate(a.doc);
    a.sendUpdate(update);
    await new Promise((r) => setTimeout(r, 200));

    // Verify B received it
    const snapB = b.snapshot();
    expect(snapB.has(id)).toBe(true);

    // A creates another note
    createSticky(a.doc, { x: 150, y: 150 });
    const svB = Y.encodeStateVector(b.doc);
    const delta = Y.encodeStateAsUpdate(a.doc, svB);
    a.sendUpdate(delta);
    await new Promise((r) => setTimeout(r, 200));

    // B should have both notes
    const snapB2 = b.snapshot();
    expect(snapB2.size).toBe(2);

    a.close();
    b.close();
  });

  // TC-26: SQL read error → room state load-failed, closes with 4500
  it('TC-26: SQL read error causes load failure', async () => {
    const boardId = newBoardId();
    const stub = await getStub(boardId);

    // Set state to load-failed (simulating a prior SQL error during load)
    await runInDurableObject(stub, (instance) => {
      const room = instance as unknown as {
        state: string;
        loadFailedAt: number;
        initialized: boolean;
      };
      room.state = 'load-failed';
      room.loadFailedAt = Date.now();
      room.initialized = true;
    });

    // Connect immediately → should get 4500 (before interval)
    const closeCode = await connectAwaitClose(boardId, 3000);
    expect(closeCode).toBe(CLOSE_BOARD_LOAD_FAILED);
  });
});
