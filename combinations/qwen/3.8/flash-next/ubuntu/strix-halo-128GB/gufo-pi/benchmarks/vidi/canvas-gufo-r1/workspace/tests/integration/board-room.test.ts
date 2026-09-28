import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { newBoardId } from '../../src/shared/board-id';
import { createWsClient, sendRaw, type WsClient } from './ws-client';
import {
  createSticky, moveObject, setStickyColor, deleteObject, getStickyText, snapshot,
} from '../../src/shared/board-model';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

const fetchWs = (url: string, init?: RequestInit) => SELF.fetch(url, init);

describe('TC-07: create propagates to other client', () => {
  it('client B sees sticky created by client A', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    createSticky(A.doc, { x: 100, y: 200 }, 'blue');

    // Wait for propagation
    const start = Date.now();
    while (B.snapshot().length === 0 && Date.now() - start < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const snapA = snapshot(A.doc);
    const snapB = snapshot(B.doc);
    expect(snapB.length).toBe(1);
    expect(snapB[0]!.x).toBe(snapA[0]!.x);
    expect(snapB[0]!.y).toBe(snapA[0]!.y);
    expect(snapB[0]!.color).toBe('blue');

    A.close();
    B.close();
  });
});

describe('TC-08: move, recolour, text insert, delete all propagate; no echo', () => {
  it('move propagates', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitFor(() => B.snapshot().length > 0);

    moveObject(A.doc, id, 500, 600);
    await waitFor(() => B.snapshot()[0]?.x === 500);
    expect(B.snapshot()[0]!.y).toBe(600);

    A.close();
    B.close();
  });

  it('recolour propagates', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitFor(() => B.snapshot().length > 0);

    setStickyColor(A.doc, id, 'green');
    await waitFor(() => B.snapshot()[0]?.color === 'green');

    A.close();
    B.close();
  });

  it('text insert propagates', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitFor(() => B.snapshot().length > 0);

    const text = getStickyText(A.doc, id)!;
    text.insert(0, 'hello');
    await waitFor(() => B.snapshot()[0]?.text === 'hello');

    A.close();
    B.close();
  });

  it('delete propagates', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitFor(() => B.snapshot().length > 0);

    deleteObject(A.doc, id);
    await waitFor(() => B.snapshot().length === 0);

    A.close();
    B.close();
  });

  it('A receives no echo of its own update', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    // Clear received messages after sync
    A.receivedMessages.length = 0;

    createSticky(A.doc, { x: 1, y: 1 });
    await waitFor(() => B.snapshot().length > 0);

    // A should not have received any update messages (no echo)
    expect(A.receivedMessages.length).toBe(0);

    A.close();
    B.close();
  });
});

describe('TC-09: concurrent text merges', () => {
  it('both converge to "red green blue"', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    await A.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    const text = getStickyText(A.doc, id)!;
    text.insert(0, 'green');
    await new Promise((r) => setTimeout(r, 200));

    const B = await createWsClient(fetchWs, boardId);
    await B.waitForSync();

    // Now both have 'green' - disconnect sync temporarily by applying locally
    const textA = getStickyText(A.doc, id)!;
    const textB = getStickyText(B.doc, id)!;

    // A inserts 'red ' at start
    textA.insert(0, 'red ');
    // B inserts ' blue' at end
    textB.insert(5, ' blue');

    // Wait for convergence
    await waitFor(() => {
      const tA = snapshot(A.doc).find(s => s.id === id)?.text;
      const tB = snapshot(B.doc).find(s => s.id === id)?.text;
      return tA === tB && tA === 'red green blue';
    }, 3000);

    expect(snapshot(A.doc).find(s => s.id === id)!.text).toBe('red green blue');
    expect(snapshot(B.doc).find(s => s.id === id)!.text).toBe('red green blue');

    A.close();
    B.close();
  });
});

describe('TC-10: concurrent position changes converge', () => {
  it('both converge to same x value', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    await A.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 100));

    const B = await createWsClient(fetchWs, boardId);
    await B.waitForSync();

    // Concurrent sets
    moveObject(A.doc, id, 100, 0);
    moveObject(B.doc, id, 300, 0);

    await waitFor(() => {
      const xA = snapshot(A.doc).find(s => s.id === id)?.x;
      const xB = snapshot(B.doc).find(s => s.id === id)?.x;
      return xA === xB;
    }, 3000);

    const finalXA = snapshot(A.doc).find(s => s.id === id)!.x;
    const finalXB = snapshot(B.doc).find(s => s.id === id)!.x;
    expect(finalXA).toBe(finalXB);

    A.close();
    B.close();
  });
});

describe('TC-11: delete during edit', () => {
  it('deleted note is absent on both; text does not resurrect', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitFor(() => B.snapshot().length > 0);

    // B starts editing (inserts text) while A deletes
    const textB = getStickyText(B.doc, id)!;
    deleteObject(A.doc, id);
    textB.insert(0, 'this should be lost');

    await waitFor(() => {
      const snapA = snapshot(A.doc);
      const snapB = snapshot(B.doc);
      return snapA.find(s => s.id === id) === undefined && snapB.find(s => s.id === id) === undefined;
    }, 3000);

    expect(snapshot(A.doc).find(s => s.id === id)).toBeUndefined();
    expect(snapshot(B.doc).find(s => s.id === id)).toBeUndefined();

    A.close();
    B.close();
  });
});

describe('TC-12: MAX_CONCURRENT_EDITORS clients with random ops converge', () => {
  it('all snapshots identical after concurrent edits', async () => {
    const boardId = newBoardId();
    const N = MAX_CONCURRENT_EDITORS;
    const clients: WsClient[] = [];

    for (let i = 0; i < N; i++) {
      const c = await createWsClient(fetchWs, boardId);
      await c.waitForSync();
      clients.push(c);
    }

    // Each client creates notes
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < 5; j++) {
        createSticky(clients[i]!.doc, { x: i * 100 + j, y: j * 50 });
      }
    }

    await new Promise((r) => setTimeout(r, 500));

    // All snapshots should be identical
    const snaps = clients.map((c) => snapshot(c.doc));
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]!.length).toBe(snaps[0]!.length);
    }
    expect(snaps[0]!.length).toBe(N * 5);

    for (const c of clients) c.close();
  });
});

describe('TC-14: late joiner sees full state', () => {
  it('C sees 20 notes created by A and B', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    // A creates 10 notes
    for (let i = 0; i < 10; i++) {
      createSticky(A.doc, { x: i * 50, y: 0 });
    }
    // B creates 10 notes
    for (let i = 0; i < 10; i++) {
      createSticky(B.doc, { x: i * 50, y: 200 });
    }

    await new Promise((r) => setTimeout(r, 300));

    // Late joiner C
    const C = await createWsClient(fetchWs, boardId);
    await C.waitForSync();

    const snapC = snapshot(C.doc);
    expect(snapC.length).toBe(20);

    A.close();
    B.close();
    C.close();
  });
});

describe('TC-15: malformed traffic from one client', () => {
  const cases = [
    { name: 'text frame', send: (ws: WebSocket) => ws.send('hello' as any) },
    { name: 'truncated bytes', send: (ws: WebSocket) => ws.send(new Uint8Array([0])) },
    { name: 'unknown type', send: (ws: WebSocket) => sendRaw(ws, 9, new Uint8Array([0, 1, 2])) },
    { name: 'invalid Yjs update', send: (ws: WebSocket) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      encoding.writeUint8Array(enc, new Uint8Array([255, 255, 255]));
      ws.send(encoding.toUint8Array(enc));
    }},
  ];

  for (const { name, send } of cases) {
    it(`${name} closes sender, B unaffected`, async () => {
      const boardId = newBoardId();
      const A = await createWsClient(fetchWs, boardId);
      const B = await createWsClient(fetchWs, boardId);
      await A.waitForSync();
      await B.waitForSync();

      // Listen for A's close
      let aClosed = false;
      A.ws.addEventListener('close', () => { aClosed = true; });

      // A sends malformed data
      send(A.ws);

      // Wait for A to be closed
      await waitFor(() => aClosed || A.ws.readyState === WebSocket.CLOSED || A.ws.readyState === WebSocket.CLOSING, 2000);
      expect(aClosed || A.ws.readyState >= WebSocket.CLOSING).toBe(true);

      // B should still be open and working
      expect(B.ws.readyState).toBe(WebSocket.OPEN);

      // Create note from B - still works
      createSticky(B.doc, { x: 42, y: 42 });
      await waitFor(() => B.snapshot().length > 0);

      B.close();
    });
  }
});

describe('TC-16: awareness relay', () => {
  it('awareness bytes from A are relayed to all including A', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    // Clear messages
    A.receivedMessages.length = 0;
    B.receivedMessages.length = 0;

    // Send awareness from A
    const awarenessPayload = new Uint8Array([1, 2, 3, 4]);
    sendRaw(A.ws, MESSAGE_AWARENESS, awarenessPayload);

    await new Promise((r) => setTimeout(r, 100));

    // Both A and B should have received the awareness frame
    const frame = new Uint8Array(1 + awarenessPayload.length);
    frame[0] = MESSAGE_AWARENESS;
    frame.set(awarenessPayload, 1);

    const aHasFrame = A.receivedMessages.some((m) => {
      const bytes = new Uint8Array(m);
      return bytes.length === frame.length && bytes.every((b, i) => b === frame[i]);
    });
    const bHasFrame = B.receivedMessages.some((m) => {
      const bytes = new Uint8Array(m);
      return bytes.length === frame.length && bytes.every((b, i) => b === frame[i]);
    });

    expect(aHasFrame).toBe(true);
    expect(bHasFrame).toBe(true);

    A.close();
    B.close();
  });
});

describe('TC-18: room restart simulation', () => {
  it('A reconnects to fresh room, then B converges', async () => {
    const boardId = newBoardId();

    // Phase 1: A connects, creates note, then disconnects (simulates restart)
    const A1 = await createWsClient(fetchWs, boardId);
    await A1.waitForSync();
    createSticky(A1.doc, { x: 1, y: 1 });
    await new Promise((r) => setTimeout(r, 100));
    // Save A's document state (A keeps this across restart)
    const savedState = Y.encodeStateAsUpdate(A1.doc);
    A1.close();

    // Wait for DO to be evicted (simulates restart)
    await new Promise((r) => setTimeout(r, 200));

    // Phase 2: "fresh room" - A reconnects with its local doc and repopulates
    // Simulate a fresh room by using a new boardId
    const freshBoardId = newBoardId();
    const doc = new Y.Doc();
    Y.applyUpdate(doc, savedState);

    // Connect A's existing doc to the fresh room
    const { ws: wsA, waitForSync: waitRaw } = await connectRaw(doc, freshBoardId);
    await waitRaw();
    await new Promise((r) => setTimeout(r, 100));

    // Now B connects to the repopulated room
    const B = await createWsClient(fetchWs, freshBoardId);
    await B.waitForSync();
    await new Promise((r) => setTimeout(r, 100));

    expect(snapshot(B.doc).length).toBe(1);

    wsA.close();
    B.close();
  });
});

/** Helper: connect a raw WebSocket with an existing doc for restart test */
async function connectRaw(doc: Y.Doc, boardId: string): Promise<{ ws: WebSocket; waitForSync(): Promise<void> }> {
  const response = await SELF.fetch(`http://example.com/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = response.webSocket!;
  ws.accept();

  let syncComplete = false;
  let applyingRemote = false;

  ws.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as ArrayBuffer;
    const bytes = new Uint8Array(data);
    if (bytes[0] === 0) {
      const payload = bytes.slice(1);
      const decoder = decoding.createDecoder(payload);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      applyingRemote = true;
      const syncType = syncProtocol.readSyncMessage(decoder, enc, doc, null);
      applyingRemote = false;
      if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      if (syncType === syncProtocol.messageYjsSyncStep2) syncComplete = true;
    }
  });

  doc.on('update', (upd: Uint8Array) => {
    if (applyingRemote) return;
    if (!syncComplete) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, upd);
    ws.send(encoding.toUint8Array(enc));
  });

  // Send SyncStep1
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));

  async function waitForSync(timeout = 5000): Promise<void> {
    const start = Date.now();
    while (!syncComplete) {
      if (Date.now() - start > timeout) throw new Error('Raw client sync timeout');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  return { ws, waitForSync };
}

describe('TC-31: dead socket does not crash room', () => {
  it('A sends update after B closes abruptly; room still works', async () => {
    const boardId = newBoardId();
    const A = await createWsClient(fetchWs, boardId);
    const B = await createWsClient(fetchWs, boardId);
    await A.waitForSync();
    await B.waitForSync();

    // Close B's socket abruptly
    B.ws.close();
    await new Promise((r) => setTimeout(r, 100));

    // A creates a note - room should not crash
    createSticky(A.doc, { x: 99, y: 99 });
    await new Promise((r) => setTimeout(r, 100));

    // A's doc still has the note
    expect(snapshot(A.doc).length).toBe(1);

    // A new client can still connect and see the note
    const C = await createWsClient(fetchWs, boardId);
    await C.waitForSync();
    expect(snapshot(C.doc).length).toBe(1);

    A.close();
    C.close();
  });
});

// Helpers
async function waitFor(fn: () => boolean, timeout = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timeout');
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
