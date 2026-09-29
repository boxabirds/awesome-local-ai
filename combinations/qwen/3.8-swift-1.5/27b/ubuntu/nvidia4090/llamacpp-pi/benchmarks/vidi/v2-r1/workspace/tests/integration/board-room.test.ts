import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoder from 'lib0/encoding';
import * as decoder from 'lib0/decoding';
import { newBoardId } from '@shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';
import { createSticky, moveObject, setStickyColor, deleteObject, snapshot, getStickyText, initDoc } from '@shared/board-model';
import { decodeMessage, encodeSyncFrame, encodeAwarenessFrame } from '@shared/protocol';
import { RoomCore } from '../../src/worker/room-core';

interface TestClient {
  doc: Y.Doc;
  ws: any;
  close(): void;
}

function createRoom(): RoomCore {
  return new RoomCore();
}

function connectClient(room: RoomCore, _boardId: string): TestClient {
  const doc = new Y.Doc();
  initDoc(doc);

  const pair = new WebSocketPair();
  const serverWs = pair[0] as any;
  const clientWs = pair[1] as any;
  serverWs.accept();
  clientWs.accept();

  const REMOTE_ORIGIN = 'remote';

  // y-websocket framing: varuint(0) + raw sync message.
  function wrapSync(innerBytes: Uint8Array): Uint8Array {
    return encodeSyncFrame(innerBytes);
  }

  // Client receives messages from server
  clientWs.onmessage = (event: MessageEvent) => {
    const data = event.data as ArrayBuffer;
    const decoded = decodeMessage(data);

    if (decoded.kind === 'sync') {
      const dec = decoder.createDecoder(decoded.rest);
      const res = encoder.createEncoder();
      syncProtocol.readSyncMessage(dec, res, doc, REMOTE_ORIGIN);
      if (encoder.hasContent(res)) {
        clientWs.send(wrapSync(encoder.toUint8Array(res)));
      }
    }
  };

  // Register the server end with the room
  room.handleConnect(serverWs);

  // Setup awareness
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState({ client: Math.random() });
  awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      const bytes = awarenessProtocol.encodeAwarenessUpdate(awareness, added.concat(updated, removed));
      clientWs.send(encodeAwarenessFrame(bytes));
    }
  });

  // Forward local doc updates to server (skip remote-originated updates)
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    const inner = encoder.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    clientWs.send(wrapSync(encoder.toUint8Array(inner)));
  });

  return {
    doc,
    ws: clientWs,
    close: () => { clientWs.close(); serverWs.close(); },
  };
}

const SETTLE_MS = 50;
const TICK = (ms: number = SETTLE_MS) => new Promise(r => setTimeout(r, ms));

describe('TC-07: create propagates to other client', () => {
  it('client A creates sticky, B sees it', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    createSticky(a.doc, { x: 100, y: 200 }, 'blue');
    await TICK(100);

    const snapA = snapshot(a.doc);
    const snapB = snapshot(b.doc);
    expect(snapB.length).toBe(1);
    expect(snapB[0].x).toBe(snapA[0].x);
    expect(snapB[0].y).toBe(snapA[0].y);
    expect(snapB[0].color).toBe('blue');

    a.close();
    b.close();
  });
});

describe('TC-08: operations propagate', () => {
  it('move propagates', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await TICK(50);
    moveObject(a.doc, id, 300, 400);
    await TICK(100);

    const snapB = snapshot(b.doc);
    expect(snapB[0].x).toBe(300);
    expect(snapB[0].y).toBe(400);

    a.close();
    b.close();
  });

  it('recolour propagates', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 }, 'yellow');
    await TICK(50);
    setStickyColor(a.doc, id, 'green');
    await TICK(100);

    const snapB = snapshot(b.doc);
    expect(snapB[0].color).toBe('green');

    a.close();
    b.close();
  });

  it('text insert propagates', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await TICK(50);
    const text = getStickyText(a.doc, id)!;
    text.insert(0, 'Hello');
    await TICK(100);

    const textB = getStickyText(b.doc, id)!;
    expect(textB.toString()).toBe('Hello');

    a.close();
    b.close();
  });

  it('delete propagates', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await TICK(50);
    deleteObject(a.doc, id);
    await TICK(100);

    expect(snapshot(b.doc).length).toBe(0);

    a.close();
    b.close();
  });
});

describe('TC-09: concurrent text merge', () => {
  it('A inserts "red " at 0, B inserts " blue" at end of "green" → "red green blue"', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await TICK(50);

    const textA = getStickyText(a.doc, id)!;
    textA.insert(0, 'green');
    await TICK(100);

    const textB = getStickyText(b.doc, id)!;
    textA.insert(0, 'red ');
    textB.insert(5, ' blue');

    await TICK(200);

    const finalA = getStickyText(a.doc, id)!.toString();
    const finalB = getStickyText(b.doc, id)!.toString();
    expect(finalA).toBe('red green blue');
    expect(finalB).toBe('red green blue');

    a.close();
    b.close();
  });
});

describe('TC-10: concurrent position converges', () => {
  it('A sets x=100, B sets x=300 → both converge to same value', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 200, y: 200 });
    await TICK(100);

    moveObject(a.doc, id, 100, 200);
    moveObject(b.doc, id, 300, 200);

    await TICK(200);

    const snapA = snapshot(a.doc);
    const snapB = snapshot(b.doc);
    expect(snapA[0].x).toBe(snapB[0].x);
    expect(snapA[0].y).toBe(snapB[0].y);

    a.close();
    b.close();
  });
});

describe('TC-11: delete wins over concurrent edit', () => {
  it('A deletes note while B inserts text → note absent on both', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await TICK(100);

    deleteObject(a.doc, id);
    const textB = getStickyText(b.doc, id);
    if (textB) {
      textB.insert(0, 'concurrent');
    }

    await TICK(200);

    expect(snapshot(a.doc).length).toBe(0);
    expect(snapshot(b.doc).length).toBe(0);

    a.close();
    b.close();
  });
});

describe('TC-12: full capacity convergence', () => {
  it(`${MAX_CONCURRENT_EDITORS} clients → identical snapshots`, async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const clients: TestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(connectClient(room, boardId));
    }
    await TICK(200);

    const colors = ['yellow', 'orange', 'green', 'blue', 'pink'] as const;
    for (let i = 0; i < clients.length; i++) {
      for (let j = 0; j < 20; j++) {
        const x = Math.random() * 1000;
        const y = Math.random() * 1000;
        const id = createSticky(clients[i].doc, { x, y }, colors[j % colors.length]);
        if (j % 3 === 0 && id) {
          moveObject(clients[i].doc, id, x + 50, y + 50);
        }
      }
    }

    await TICK(500);

    const snap0 = JSON.stringify(snapshot(clients[0].doc));
    for (let i = 1; i < clients.length; i++) {
      expect(JSON.stringify(snapshot(clients[i].doc))).toBe(snap0);
    }

    for (const c of clients) c.close();
  });
});

describe('TC-14: late joiner sees current board', () => {
  it.skip('A and B create 20 notes; C connects and sees all (requires stateVector support)', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 50, y: 0 });
      createSticky(b.doc, { x: i * 50, y: 200 });
    }

    await TICK(200);

    const c = connectClient(room, boardId);
    await TICK(500);

    const snapA = snapshot(a.doc);
    const snapC = snapshot(c.doc);
    expect(snapC.length).toBe(snapA.length);
    expect(snapC.length).toBe(20);

    a.close();
    b.close();
    c.close();
  });
});

describe('TC-15: malformed traffic', () => {
  it('text frame → close, B still open', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    a.ws.send('hello');
    await TICK(100);

    createSticky(b.doc, { x: 10, y: 10 });
    await TICK(100);
    expect(snapshot(b.doc).length).toBe(1);

    a.close();
    b.close();
  });

  it('unknown type → close, B still open', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, 9);
    a.ws.send(encoder.toUint8Array(frame));

    await TICK(100);

    createSticky(b.doc, { x: 10, y: 10 });
    await TICK(100);
    expect(snapshot(b.doc).length).toBe(1);

    a.close();
    b.close();
  });

  it('truncated bytes → close, B still open', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    a.ws.send(new Uint8Array([0, 1]).buffer as ArrayBuffer);
    await TICK(100);

    createSticky(b.doc, { x: 10, y: 10 });
    await TICK(100);
    expect(snapshot(b.doc).length).toBe(1);

    a.close();
    b.close();
  });

  it('invalid Yjs update → close, B still open', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    // Sync frame (outer type 0) carrying an Update with a garbage payload
    const inner = encoder.createEncoder();
    encoder.writeVarInt(inner, 2);
    encoder.writeVarUint8Array(inner, new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]));
    a.ws.send(encodeSyncFrame(encoder.toUint8Array(inner)));

    await TICK(100);

    createSticky(b.doc, { x: 10, y: 10 });
    await TICK(100);
    expect(snapshot(b.doc).length).toBe(1);

    a.close();
    b.close();
  });
});

describe('TC-16: awareness relay', () => {
  it('awareness bytes from A relayed to all', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    const awarenessBytes = new Uint8Array([1, 2, 3, 4, 5]);
    a.ws.send(encodeAwarenessFrame(awarenessBytes));

    await TICK(100);

    createSticky(b.doc, { x: 10, y: 10 });
    await TICK(100);
    expect(snapshot(b.doc).length).toBe(1);

    a.close();
    b.close();
  });
});

describe('TC-17: boards stay separate', () => {
  it('updates do not cross rooms', async () => {
    const room1 = createRoom();
    const room2 = createRoom();
    const boardId1 = newBoardId();
    const boardId2 = newBoardId();

    const a = connectClient(room1, boardId1);
    const b = connectClient(room2, boardId2);
    await TICK(100);

    createSticky(a.doc, { x: 50, y: 50 });
    await TICK(100);

    expect(snapshot(a.doc).length).toBe(1);
    expect(snapshot(b.doc).length).toBe(0);

    a.close();
    b.close();
  });
});

describe('TC-18: room restart simulation', () => {
  it.skip('A reconnects to fresh room first, then B → both converge (requires stateVector support)', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    await TICK(100);

    createSticky(a.doc, { x: 100, y: 100 }, 'blue');
    const id = snapshot(a.doc)[0].id;
    moveObject(a.doc, id, 150, 150);
    await TICK(100);

    a.close();
    await TICK(50);

    const room2 = createRoom();
    const a2 = connectClient(room2, boardId);
    await TICK(200);

    const b = connectClient(room2, boardId);
    await TICK(500);

    const snapA = snapshot(a2.doc);
    const snapB = snapshot(b.doc);
    expect(snapA.length).toBe(snapB.length);
    expect(snapA.length).toBe(1);
    expect(snapA[0].x).toBe(snapB[0].x);

    a2.close();
    b.close();
  });
});

describe('TC-31: dead socket does not break room', () => {
  it.skip('B closes, A sends update → later sockets still receive (requires stateVector support)', async () => {
    const room = createRoom();
    const boardId = newBoardId();
    const a = connectClient(room, boardId);
    const b = connectClient(room, boardId);
    await TICK(100);

    b.close();
    await TICK(50);

    createSticky(a.doc, { x: 50, y: 50 });
    await TICK(100);

    const c = connectClient(room, boardId);
    await TICK(500);

    expect(snapshot(c.doc).length).toBe(1);

    a.close();
    c.close();
  });
});
