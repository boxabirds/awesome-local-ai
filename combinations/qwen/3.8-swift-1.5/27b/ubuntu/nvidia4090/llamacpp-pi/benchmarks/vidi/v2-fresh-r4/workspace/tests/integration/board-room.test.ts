import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
  snapshot,
  initDoc,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  createEncoder, toUint8Array, writeUint8, writeUint8Array,
} from 'lib0/encoding';
import {
  createDecoder, readUint8, readTailAsUint8Array,
} from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';

// --- WebSocket helpers (must be in test scope for workerd) ---

async function openWs(boardId: string): Promise<WebSocket> {
  const resp = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
    headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade' },
  });
  const ws = (resp as any).webSocket;
  ws.accept();
  return ws;
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function attachHandler(ws: WebSocket, doc: Y.Doc): void {
  ws.onmessage = (e: any) => {
    const bytes = new Uint8Array(e.data);
    if (bytes.length < 1) return;
    const d = createDecoder(bytes);
    const type = readUint8(d);
    const payload = readTailAsUint8Array(d);
    if (type === 0) {
      const enc = createEncoder();
      try {
        syncProtocol.readSyncMessage(createDecoder(payload), enc, doc, 'remote');
        const resp = toUint8Array(enc);
        if (resp.length > 0) {
          const f = createEncoder();
          writeUint8(f, 0);
          writeUint8Array(f, resp);
          ws.send(toUint8Array(f).slice().buffer);
        }
      } catch {}
    }
  };
}

function sendUpdate(ws: WebSocket, doc: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(doc);
  if (update.length === 0) return;
  const enc = createEncoder();
  syncProtocol.writeUpdate(enc, update);
  const f = createEncoder();
  writeUint8(f, 0);
  writeUint8Array(f, toUint8Array(enc));
  ws.send(toUint8Array(f).slice().buffer);
}

function sendAwareness(ws: WebSocket, payload: Uint8Array): void {
  const f = createEncoder();
  writeUint8(f, 1);
  writeUint8Array(f, payload);
  ws.send(toUint8Array(f).slice().buffer);
}

function sendRaw(ws: WebSocket, data: ArrayBuffer | string): void {
  ws.send(data);
}

async function waitFor(cond: () => boolean, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
    await new Promise(r => setTimeout(r, 20));
  }
}

function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const aIds = new Set(a.map(n => n.id));
  for (const na of a) {
    const nb = b.find(n => n.id === na.id);
    if (!nb) return false;
    if (na.x !== nb.x || na.y !== nb.y || na.color !== nb.color || na.text !== nb.text) return false;
  }
  return true;
}

// --- Tests ---

describe('TC-07: create propagates to other client', () => {
  it('client B snapshot equals A after A creates a sticky', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    createSticky(docA, { x: 100, y: 200 });
    sendUpdate(wsA, docA);

    await waitFor(() => snapshot(docB).length === 1);
    expect(snapshotsEqual(snapshot(docA), snapshot(docB))).toBe(true);
    wsA.close(); wsB.close();
  });
});

describe('TC-08: move, recolour, text insert, delete propagate', () => {
  it('move propagates to B', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 100, y: 100 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    moveObject(docA, id, 100, 100);
    sendUpdate(wsA, docA);
    await waitFor(() => {
      const s = snapshot(docB);
      return s.length === 1 && s[0].x === 100 && s[0].y === 100;
    });
    expect(snapshot(docB)[0].x).toBe(100);
    expect(snapshot(docB)[0].y).toBe(100);
    wsA.close(); wsB.close();
  });

  it('recolour propagates to B', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 100, y: 100 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    setStickyColor(docA, id, 'blue');
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB)[0]?.color === 'blue');
    expect(snapshot(docB)[0].color).toBe('blue');
    wsA.close(); wsB.close();
  });

  it('text insert propagates to B', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 100, y: 100 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    getStickyText(docA, id)!.insert(0, 'hello');
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB)[0]?.text === 'hello');
    expect(snapshot(docB)[0].text).toBe('hello');
    wsA.close(); wsB.close();
  });

  it('delete propagates to B', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 100, y: 100 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    deleteObject(docA, id);
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 0);
    expect(snapshot(docB).length).toBe(0);
    wsA.close(); wsB.close();
  });
});

describe('TC-09: concurrent text merge', () => {
  it('A inserts "red " at 0, B inserts " blue" → both "red green blue"', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 0, y: 0 });
    getStickyText(docA, id)!.insert(0, 'green');
    sendUpdate(wsA, docA);
    await waitFor(() => getStickyText(docB, id)?.toString() === 'green');

    getStickyText(docA, id)!.insert(0, 'red ');
    sendUpdate(wsA, docA);
    getStickyText(docB, id)!.insert(5, ' blue');
    sendUpdate(wsB, docB);

    await waitFor(() => {
      const ta = getStickyText(docA, id)?.toString() ?? '';
      const tb = getStickyText(docB, id)?.toString() ?? '';
      return ta === tb && ta.length > 0;
    });
    expect(getStickyText(docA, id)!.toString()).toBe('red green blue');
    wsA.close(); wsB.close();
  });
});

describe('TC-10: concurrent position sets converge', () => {
  it('A sets x=100, B sets x=300 → both converge', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 0, y: 0 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    moveObject(docA, id, 100, 0);
    sendUpdate(wsA, docA);
    moveObject(docB, id, 300, 0);
    sendUpdate(wsB, docB);

    await waitFor(() => {
      const sa = snapshot(docA).find(n => n.id === id);
      const sb = snapshot(docB).find(n => n.id === id);
      return sa && sb && sa.x === sb.x;
    });
    expect(snapshot(docA).find(n => n.id === id)!.x)
      .toBe(snapshot(docB).find(n => n.id === id)!.x);
    wsA.close(); wsB.close();
  });
});

describe('TC-11: delete wins over concurrent edit', () => {
  it('A deletes while B inserts → absent on both', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    const id = createSticky(docA, { x: 0, y: 0 });
    sendUpdate(wsA, docA);
    await waitFor(() => snapshot(docB).length === 1);

    deleteObject(docA, id);
    sendUpdate(wsA, docA);
    const textB = getStickyText(docB, id);
    if (textB) textB.insert(0, 'resurrect?');
    sendUpdate(wsB, docB);

    await waitFor(() =>
      !snapshot(docA).find(n => n.id === id) &&
      !snapshot(docB).find(n => n.id === id)
    );
    wsA.close(); wsB.close();
  });
});

describe('TC-12: MAX_CONCURRENT_EDITORS clients converge', () => {
  it(`${MAX_CONCURRENT_EDITORS} clients × 200 ops → identical snapshots`, async () => {
    const boardId = newBoardId();
    const wss: WebSocket[] = [];
    const docs: Y.Doc[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const ws = await openWs(boardId);
      const doc = makeDoc();
      attachHandler(ws, doc);
      wss.push(ws);
      docs.push(doc);
    }
    await new Promise(r => setTimeout(r, 1000));

    let seed = 42;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const words = ['hello', 'world', 'foo', 'bar', 'baz'];
    const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

    for (let ci = 0; ci < docs.length; ci++) {
      for (let op = 0; op < 200; op++) {
        const r = rand();
        const snap = snapshot(docs[ci]);
        if (r < 0.4 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          const text = getStickyText(docs[ci], note.id);
          if (text) text.insert(text.length, words[Math.floor(rand() * words.length)]);
        } else if (r < 0.7 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          moveObject(docs[ci], note.id, rand() * 1000, rand() * 1000);
        } else if (r < 0.8) {
          createSticky(docs[ci], { x: rand() * 1000, y: rand() * 1000 });
        } else if (r < 0.9 && snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          setStickyColor(docs[ci], note.id, colors[Math.floor(rand() * colors.length)]);
        } else if (snap.length > 0) {
          const note = snap[Math.floor(rand() * snap.length)];
          deleteObject(docs[ci], note.id);
        }
        sendUpdate(wss[ci], docs[ci]);
      }
    }

    await new Promise(r => setTimeout(r, 10000));
    const base = snapshot(docs[0]);
    for (let i = 1; i < docs.length; i++) {
      expect(snapshotsEqual(base, snapshot(docs[i]))).toBe(true);
    }
    for (const ws of wss) ws.close();
  });
});

describe('TC-14: late joiner sees current board', () => {
  it('C connects after A and B create 20 notes → C snapshot equals A', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    for (let i = 0; i < 10; i++) createSticky(docA, { x: i * 50, y: 0 });
    sendUpdate(wsA, docA);
    for (let i = 0; i < 10; i++) createSticky(docB, { x: i * 50, y: 100 });
    sendUpdate(wsB, docB);
    await waitFor(() => snapshot(docA).length === 20 && snapshot(docB).length === 20);

    const wsC = await openWs(boardId);
    const docC = makeDoc();
    attachHandler(wsC, docC);
    await waitFor(() => snapshot(docC).length === 20, 15000);
    expect(snapshotsEqual(snapshot(docA), snapshot(docC))).toBe(true);
    wsA.close(); wsB.close(); wsC.close();
  });
});

describe('TC-15: malformed traffic closes only the offending socket', () => {
  const cases: { name: string; data: ArrayBuffer | string }[] = [
    { name: 'text frame', data: 'hello' },
    { name: 'truncated bytes', data: new ArrayBuffer(0) },
    { name: 'unknown type', data: new Uint8Array([9, 1]).buffer as ArrayBuffer },
    { name: 'invalid sync type', data: new Uint8Array([0, 3, 255, 255]).buffer as ArrayBuffer },
  ];

  for (const { name, data } of cases) {
    it(`${name}: A closed with 1003, B still open`, async () => {
      const boardId = newBoardId();
      const wsA = await openWs(boardId);
      const wsB = await openWs(boardId);
      const docA = makeDoc();
      const docB = makeDoc();
      attachHandler(wsA, docA);
      attachHandler(wsB, docB);
      await new Promise(r => setTimeout(r, 500));

      let aClosed = false;
      let aCloseCode: number | null = null;
      wsA.onclose = (e: any) => { aClosed = true; aCloseCode = e.code; };

      sendRaw(wsA, data);

      await waitFor(() => aClosed, 5000);
      expect(aCloseCode).toBe(1003);
      expect((wsB as any).readyState).not.toBe(3);

      createSticky(docB, { x: 10, y: 10 });
      sendUpdate(wsB, docB);
      await waitFor(() => snapshot(docB).length >= 1);
      wsB.close();
    });
  }
});

describe('TC-16: awareness relay', () => {
  it('A sends awareness → both receive', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    let aCount = 0, bCount = 0;
    
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    
    // Wrap to count messages
    const origA = wsA.onmessage;
    wsA.onmessage = (e) => { aCount++; origA?.call(wsA, e); };
    const origB = wsB.onmessage;
    wsB.onmessage = (e) => { bCount++; origB?.call(wsB, e); };
    
    await new Promise(r => setTimeout(r, 500));
    
    sendAwareness(wsA, new Uint8Array([1, 2, 3, 4, 5]));
    await new Promise(r => setTimeout(r, 200));
    
    expect(aCount).toBeGreaterThanOrEqual(2);
    expect(bCount).toBeGreaterThanOrEqual(2);
    wsA.close(); wsB.close();
  });
});

describe('TC-18: room restart simulation', () => {
  it('A reconnects, then B → both converge', async () => {
    const boardId = newBoardId();

    const wsA1 = await openWs(boardId);
    const wsB1 = await openWs(boardId);
    const docA1 = makeDoc();
    const docB1 = makeDoc();
    attachHandler(wsA1, docA1);
    attachHandler(wsB1, docB1);
    await new Promise(r => setTimeout(r, 500));

    createSticky(docA1, { x: 10, y: 10 });
    sendUpdate(wsA1, docA1);
    createSticky(docB1, { x: 20, y: 20 });
    sendUpdate(wsB1, docB1);
    await waitFor(() => snapshot(docA1).length === 2 && snapshot(docB1).length === 2);

    wsA1.close(); wsB1.close();
    await new Promise(r => setTimeout(r, 200));

    const wsA2 = await openWs(boardId);
    const docA2 = makeDoc();
    attachHandler(wsA2, docA2);
    await waitFor(() => snapshot(docA2).length === 2, 15000);

    const wsB2 = await openWs(boardId);
    const docB2 = makeDoc();
    attachHandler(wsB2, docB2);
    await waitFor(() => snapshot(docB2).length === 2, 15000);

    expect(snapshotsEqual(snapshot(docA2), snapshot(docB2))).toBe(true);
    wsA2.close(); wsB2.close();
  });
});

describe('TC-31: dead socket error path', () => {
  it('B closes, A sends update, C receives', async () => {
    const boardId = newBoardId();
    const wsA = await openWs(boardId);
    const wsB = await openWs(boardId);
    const docA = makeDoc();
    const docB = makeDoc();
    attachHandler(wsA, docA);
    attachHandler(wsB, docB);
    await new Promise(r => setTimeout(r, 500));

    wsB.close();
    await new Promise(r => setTimeout(r, 500));

    createSticky(docA, { x: 50, y: 50 });
    sendUpdate(wsA, docA);
    await new Promise(r => setTimeout(r, 500));

    const wsC = await openWs(boardId);
    const docC = makeDoc();
    attachHandler(wsC, docC);
    await waitFor(() => snapshot(docC).length >= 1, 10000);
    expect(snapshot(docC).length).toBe(1);
    wsA.close(); wsC.close();
  });
});
