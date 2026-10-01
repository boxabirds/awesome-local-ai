import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createSticky, snapshot, moveObject, setStickyColor, deleteObject } from '../../src/shared/board-model';
import { MESSAGE_SYNC, wrapSyncMessage, encodeAwarenessMessage } from '../../src/shared/protocol';

const SERVER_ORIGIN = Symbol('server');

const getObjMap = (doc: Y.Doc, id: string): Y.Map<unknown> =>
  (doc.getMap('objects') as Y.Map<Y.Map<unknown>>).get(id)!;

const getText = (doc: Y.Doc, id: string): Y.Text =>
  getObjMap(doc, id).get('text') as Y.Text;

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Connect a Y.Doc to a BoardRoom via the test harness.
 *
 * Pattern: attach listeners BEFORE accept, then send SyncStep1 after a brief wait.
 * Returns an object with the doc, the raw ws, and helpers.
 */
async function connectClient(boardId: string): Promise<{
  doc: Y.Doc;
  ws: WebSocket;
  msgCount: () => number;
  close: () => void;
}> {
  const req = new Request(`http://localhost/api/rooms/${boardId}`, {
    headers: { Upgrade: 'websocket' },
  });
  const res = await SELF.fetch(req);
  if (res.status !== 101) throw new Error(`Expected 101, got ${res.status}`);
  const ws = res.webSocket!;

  const doc = new Y.Doc();
  let msgCount = 0;

  // Attach message listener BEFORE accept
  ws.addEventListener('message', (event: MessageEvent) => {
    msgCount++;
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

  // Attach update handler BEFORE accept
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== SERVER_ORIGIN && ws.readyState === WebSocket.OPEN) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      ws.send(encoding.toUint8Array(enc));
    }
  });

  ws.accept();
  await wait(100);

  // Send SyncStep1 to request server state
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  ws.send(encoding.toUint8Array(enc));
  await wait(200);

  return { doc, ws, msgCount: () => msgCount, close: () => { if (ws.readyState === WebSocket.OPEN) ws.close(); } };
}

describe('Worker routing (TC-04 to TC-06)', () => {
  it('TC-04: GET /api/rooms/bad!id with Upgrade returns 400', async () => {
    const req = new Request('http://localhost/api/rooms/bad!id', { headers: { Upgrade: 'websocket' } });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
  });

  it('TC-05: GET /api/rooms/<valid> without Upgrade returns 426', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(new Request(`http://localhost/api/rooms/${id}`));
    expect(res.status).toBe(426);
  });

  it('TC-06: GET /b/<valid> returns 200 with HTML', async () => {
    const id = newBoardId();
    const res = await SELF.fetch(new Request(`http://localhost/b/${id}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/html');
  });
});

describe('Worker routing: over capacity (TC-13)', () => {
  it('TC-13: MAX+1 sockets accepted, note from last reaches all others', async () => {
    const id = newBoardId();
    const clients: Array<{ doc: Y.Doc; ws: WebSocket; close: () => void }> = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      clients.push(await connectClient(id));
    }
    for (const c of clients) expect(c.ws.readyState).toBe(WebSocket.OPEN);

    // Last client creates a note
    createSticky(clients[MAX_CONCURRENT_EDITORS]!.doc, { x: 50, y: 50 });
    await wait(1000);

    // All others see it
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      expect(snapshot(clients[i]!.doc).length).toBeGreaterThanOrEqual(1);
    }
    for (const c of clients) c.close();
  });
});

describe('Worker routing: board isolation (TC-17)', () => {
  it('TC-17: changes on one board do not appear on another', async () => {
    const id1 = newBoardId();
    const id2 = newBoardId();
    const c1 = await connectClient(id1);
    const c2 = await connectClient(id2);

    createSticky(c1.doc, { x: 100, y: 100 });
    await wait(500);
    expect(snapshot(c1.doc).length).toBe(1);
    expect(snapshot(c2.doc).length).toBe(0);

    c1.close();
    c2.close();
  });
});

describe('BoardRoom: create propagates (TC-07)', () => {
  it('TC-07: A creates sticky, B sees it', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    createSticky(A.doc, { x: 100, y: 200 });
    await wait(1000);

    const snapA = snapshot(A.doc);
    const snapB = snapshot(B.doc);
    expect(snapB.length).toBe(1);
    expect(snapB[0]!.x).toBe(snapA[0]!.x);
    expect(snapB[0]!.y).toBe(snapA[0]!.y);
    A.close(); B.close();
  });
});

describe('BoardRoom: mutations propagate, no echo (TC-08)', () => {
  it('TC-08 move: B sees move, A gets no echo', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);

    const msgsBefore = A.msgCount();
    moveObject(A.doc, noteId, 500, 600);
    await wait(1000);

    const snapB = snapshot(B.doc);
    expect(snapB[0]!.x).toBe(500);
    expect(snapB[0]!.y).toBe(600);
    expect(A.msgCount()).toBe(msgsBefore); // no echo

    A.close(); B.close();
  });

  it('TC-08 recolour: B sees recolour', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);
    setStickyColor(A.doc, noteId, 'blue');
    await wait(1000);

    expect(snapshot(B.doc)[0]!.color).toBe('blue');
    A.close(); B.close();
  });

  it('TC-08 text: B sees insert', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);
    const ytext = getText(A.doc, noteId);
    ytext.insert(0, 'hello world');
    await wait(1000);

    expect(snapshot(B.doc)[0]!.text).toBe('hello world');
    A.close(); B.close();
  });

  it('TC-08 delete: B sees delete', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);
    expect(snapshot(B.doc).length).toBe(1);

    deleteObject(A.doc, noteId);
    await wait(1000);
    expect(snapshot(B.doc).length).toBe(0);
    A.close(); B.close();
  });
});

describe('BoardRoom: concurrent text merge (TC-09)', () => {
  it('TC-09: "red " at 0 + " blue" at 5 = "red green blue"', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    // Create with "green"
    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    const ytext = getText(A.doc, noteId);
    ytext.insert(0, 'green');
    await wait(1000);

    // Edit locally without triggering server send
    const ytextA = getText(A.doc, noteId);
    const ytextB = getText(B.doc, noteId);
    A.doc.transact(() => { ytextA.insert(0, 'red '); }, SERVER_ORIGIN);
    B.doc.transact(() => { ytextB.insert(5, ' blue'); }, SERVER_ORIGIN);

    // Exchange diffs
    const diffA = Y.encodeStateAsUpdate(A.doc, Y.encodeStateVector(B.doc));
    if (diffA.length > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, diffA);
      A.ws.send(encoding.toUint8Array(enc));
    }
    await wait(500);

    const diffB = Y.encodeStateAsUpdate(B.doc, Y.encodeStateVector(A.doc));
    if (diffB.length > 0) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, diffB);
      B.ws.send(encoding.toUint8Array(enc));
    }
    await wait(1000);

    const textA = getText(A.doc, noteId).toString();
    const textB = getText(B.doc, noteId).toString();
    expect(textA).toBe('red green blue');
    expect(textB).toBe('red green blue');
    A.close(); B.close();
  });
});

describe('BoardRoom: concurrent position (TC-10)', () => {
  it('TC-10: A x=100, B x=300 → converge to same value', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);

    const mapA = getObjMap(A.doc, noteId);
    const mapB = getObjMap(B.doc, noteId);
    A.doc.transact(() => { mapA.set('x', 100); }, SERVER_ORIGIN);
    B.doc.transact(() => { mapB.set('x', 300); }, SERVER_ORIGIN);

    const diffA = Y.encodeStateAsUpdate(A.doc, Y.encodeStateVector(B.doc));
    if (diffA.length > 0) {
      const enc = encoding.createEncoder(); encoding.writeVarUint(enc, MESSAGE_SYNC); syncProtocol.writeUpdate(enc, diffA);
      A.ws.send(encoding.toUint8Array(enc));
    }
    await wait(500);
    const diffB = Y.encodeStateAsUpdate(B.doc, Y.encodeStateVector(A.doc));
    if (diffB.length > 0) {
      const enc = encoding.createEncoder(); encoding.writeVarUint(enc, MESSAGE_SYNC); syncProtocol.writeUpdate(enc, diffB);
      B.ws.send(encoding.toUint8Array(enc));
    }
    await wait(1000);

    const xA = snapshot(A.doc)[0]!.x;
    const xB = snapshot(B.doc)[0]!.x;
    expect(xA).toBe(xB);
    expect([100, 300]).toContain(xA);
    A.close(); B.close();
  });
});

describe('BoardRoom: delete wins (TC-11)', () => {
  it('TC-11: delete beats concurrent edit, no resurrection', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const noteId = createSticky(A.doc, { x: 0, y: 0 });
    await wait(500);
    expect(snapshot(B.doc).length).toBe(1);

    // B edits concurrently (not sent)
    const ytextB = getText(B.doc, noteId);
    B.doc.transact(() => { ytextB.insert(0, 'concurrent'); }, SERVER_ORIGIN);

    // A deletes
    deleteObject(A.doc, noteId);
    await wait(1000);

    expect(snapshot(A.doc).length).toBe(0);
    expect(snapshot(B.doc).length).toBe(0);

    // B sends its edit - should not resurrect
    const diffB = Y.encodeStateAsUpdate(B.doc, Y.encodeStateVector(A.doc));
    if (diffB.length > 0) {
      const enc = encoding.createEncoder(); encoding.writeVarUint(enc, MESSAGE_SYNC); syncProtocol.writeUpdate(enc, diffB);
      B.ws.send(encoding.toUint8Array(enc));
    }
    await wait(1000);

    expect(snapshot(A.doc).length).toBe(0);
    expect(snapshot(B.doc).length).toBe(0);
    A.close(); B.close();
  });
});

describe('BoardRoom: multiple clients converge (TC-12)', () => {
  it('TC-12: MAX clients create notes → identical snapshots', async () => {
    const id = newBoardId();
    const clients: Array<{ doc: Y.Doc; ws: WebSocket; close: () => void }> = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await connectClient(id));
    }

    // Each creates 4 notes
    for (const c of clients) {
      for (let j = 0; j < 4; j++) {
        createSticky(c.doc, { x: Math.random() * 1000, y: Math.random() * 1000 });
      }
      await wait(100);
    }
    await wait(2000);

    // Re-sync all
    for (const c of clients) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, c.doc);
      c.ws.send(encoding.toUint8Array(enc));
    }
    await wait(1000);

    const count = snapshot(clients[0]!.doc).length;
    expect(count).toBe(MAX_CONCURRENT_EDITORS * 4);
    for (let i = 1; i < clients.length; i++) {
      expect(snapshot(clients[i]!.doc).length).toBe(count);
    }
    for (const c of clients) c.close();
  }, 30000);
});

describe('BoardRoom: late joiner (TC-14)', () => {
  it('TC-14: A and B create 20 notes, late joiner C sees all 20', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    for (let i = 0; i < 10; i++) createSticky(A.doc, { x: i * 50, y: 0 });
    await wait(500);
    for (let i = 0; i < 10; i++) createSticky(B.doc, { x: 0, y: i * 50 });
    await wait(2000);

    // Verify 20 notes
    expect(snapshot(A.doc).length).toBe(20);

    // Late joiner
    const C = await connectClient(id);
    expect(snapshot(C.doc).length).toBe(20);

    A.close(); B.close(); C.close();
  });
});

describe('BoardRoom: malformed traffic (TC-15)', () => {
  it('TC-15: string frame closes sender, room still works', async () => {
    const id = newBoardId();
    const A = await connectClient(id);

    // Send a text frame
    A.ws.send('this is a string');
    await wait(1000);
    expect(A.ws.readyState).toBeGreaterThanOrEqual(WebSocket.CLOSING);

    // Room still works for new clients
    const B = await connectClient(id);
    createSticky(B.doc, { x: 42, y: 42 });
    await wait(500);
    expect(snapshot(B.doc).length).toBe(1);
    B.close();
  });
});

describe('BoardRoom: awareness relay (TC-16)', () => {
  it('TC-16: awareness from A relayed to all including A', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    const aAwareness: Uint8Array[] = [];
    const bAwareness: Uint8Array[] = [];
    A.ws.addEventListener('message', (e) => {
      const d = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data as Uint8Array;
      if (d[0] === 1) aAwareness.push(d);
    });
    B.ws.addEventListener('message', (e) => {
      const d = e.data instanceof ArrayBuffer ? new Uint8Array(e.data) : e.data as Uint8Array;
      if (d[0] === 1) bAwareness.push(d);
    });

    A.ws.send(encodeAwarenessMessage(new Uint8Array([10, 20, 30])));
    await wait(500);

    expect(aAwareness.length).toBeGreaterThanOrEqual(1);
    expect(bAwareness.length).toBeGreaterThanOrEqual(1);
    expect(aAwareness[0]).toEqual(bAwareness[0]);
    A.close(); B.close();
  });
});

describe('BoardRoom: restart simulation (TC-18)', () => {
  it('TC-18: reconnect after "restart" repopulates room', async () => {
    const id = newBoardId();

    // First session
    const A = await connectClient(id);
    createSticky(A.doc, { x: 10, y: 10 });
    await wait(500);
    expect(snapshot(A.doc).length).toBe(1);
    A.close();
    await wait(500);

    // Simulate restart: new clients connect.
    // In a real restart, the client re-applies its stored doc state and syncs up.
    // We replicate this by seeding a new client doc with the original state and syncing.
    const origState = Y.encodeStateAsUpdate(A.doc);

    const A2 = await connectClient(id);
    // Apply original state (simulates client retaining local doc)
    Y.applyUpdate(A2.doc, origState);
    await wait(500);

    // New client B2 joins - should see the note via server sync
    const B2 = await connectClient(id);
    expect(snapshot(B2.doc).length).toBe(1);

    A2.close(); B2.close();
  });
});

describe('BoardRoom: dead socket handling (TC-31)', () => {
  it('TC-31: dead socket does not crash room, later clients still work', async () => {
    const id = newBoardId();
    const A = await connectClient(id);
    const B = await connectClient(id);

    // Kill B
    B.close();
    await wait(300);

    // A sends an update - room should not throw
    createSticky(A.doc, { x: 50, y: 50 });
    await wait(500);

    // New client connects fine
    const C = await connectClient(id);
    expect(snapshot(C.doc).length).toBeGreaterThanOrEqual(1);
    A.close(); C.close();
  });
});
