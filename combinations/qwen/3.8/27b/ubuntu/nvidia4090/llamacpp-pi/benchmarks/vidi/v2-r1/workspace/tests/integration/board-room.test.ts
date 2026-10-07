// TC-07 to TC-12, TC-14 to TC-16, TC-18, TC-31: BoardRoom Durable Object integration tests.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { newBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { CLOSE_UNSUPPORTED_DATA as CLOSE_CODE } from '../../src/shared/protocol';
import { createWsClient, type WsClient } from './ws-client';

type ObjMap = Y.Map<Y.Map<unknown>>;

function getObjects(doc: Y.Doc): ObjMap {
  return doc.getMap('objects') as ObjMap;
}

function getObj(doc: Y.Doc, id: string): Y.Map<unknown> | undefined {
  return getObjects(doc).get(id);
}

function createStickyInDoc(doc: Y.Doc, id: string, x: number, y: number, color: string = 'yellow', text: string = '') {
  const map = new Y.Map<unknown>();
  map.set('type', 'sticky');
  map.set('x', x);
  map.set('y', y);
  map.set('color', color);
  const textType = new Y.Text(text);
  map.set('text', textType);
  map.set('z', 1);
  map.set('createdAt', Date.now());
  doc.transact(() => { getObjects(doc).set(id, map); });
}

function moveInDoc(doc: Y.Doc, id: string, x: number, y: number) {
  const obj = getObj(doc, id);
  if (!obj) return;
  doc.transact(() => { obj.set('x', x); obj.set('y', y); });
}

function deleteInDoc(doc: Y.Doc, id: string) {
  doc.transact(() => { getObjects(doc).delete(id); });
}

function setNoteColor(doc: Y.Doc, id: string, color: string) {
  const obj = getObj(doc, id);
  if (!obj) return;
  doc.transact(() => { obj.set('color', color); });
}

function getNoteText(doc: Y.Doc, id: string): string {
  const obj = getObj(doc, id);
  if (!obj) return '';
  const text = obj.get('text');
  return text instanceof Y.Text ? text.toString() : '';
}

function insertTextAt(doc: Y.Doc, id: string, pos: number, str: string) {
  const obj = getObj(doc, id);
  if (!obj) return;
  const text = obj.get('text') as Y.Text;
  doc.transact(() => { text.insert(pos, str); });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BoardRoom (sync.room)', () => {
  it('TC-07: A creates sticky → B snapshot equals A; B received exactly one update', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    createStickyInDoc(a.doc, 'note-1', 10, 20, 'yellow', 'hello');
    await sleep(300);

    const snapA = a.snapshot();
    const snapB = b.snapshot();
    expect(snapB.count).toBe(snapA.count);
    expect(snapB.notes).toEqual(snapA.notes);
    expect(b.receivedUpdates.length).toBe(1);

    a.close();
    b.close();
  });

  describe('TC-08: Each mutation kind propagates and A gets no echo', () => {
    it('move', async () => {
      const boardId = newBoardId();
      const a = await createWsClient(boardId);
      const b = await createWsClient(boardId);
      await a.waitForSync();
      await b.waitForSync();

      createStickyInDoc(a.doc, 'n1', 0, 0);
      await sleep(200);
      a.receivedUpdates.length = 0;

      moveInDoc(a.doc, 'n1', 100, 200);
      await sleep(300);

      expect(b.snapshot().notes[0].x).toBe(100);
      expect(b.snapshot().notes[0].y).toBe(200);
      expect(a.receivedUpdates.length).toBe(0);

      a.close();
      b.close();
    });

    it('recolor', async () => {
      const boardId = newBoardId();
      const a = await createWsClient(boardId);
      const b = await createWsClient(boardId);
      await a.waitForSync();
      await b.waitForSync();

      createStickyInDoc(a.doc, 'n1', 0, 0, 'yellow');
      await sleep(200);
      a.receivedUpdates.length = 0;

      setNoteColor(a.doc, 'n1', 'blue');
      await sleep(300);

      expect(b.snapshot().notes[0].color).toBe('blue');
      expect(a.receivedUpdates.length).toBe(0);

      a.close();
      b.close();
    });

    it('text insert', async () => {
      const boardId = newBoardId();
      const a = await createWsClient(boardId);
      const b = await createWsClient(boardId);
      await a.waitForSync();
      await b.waitForSync();

      createStickyInDoc(a.doc, 'n1', 0, 0);
      await sleep(200);
      a.receivedUpdates.length = 0;

      insertTextAt(a.doc, 'n1', 0, 'hello world');
      await sleep(300);

      expect(b.snapshot().notes[0].text).toBe('hello world');
      expect(a.receivedUpdates.length).toBe(0);

      a.close();
      b.close();
    });

    it('delete', async () => {
      const boardId = newBoardId();
      const a = await createWsClient(boardId);
      const b = await createWsClient(boardId);
      await a.waitForSync();
      await b.waitForSync();

      createStickyInDoc(a.doc, 'n1', 0, 0);
      await sleep(200);
      a.receivedUpdates.length = 0;

      deleteInDoc(a.doc, 'n1');
      await sleep(300);

      expect(b.snapshot().count).toBe(0);
      expect(a.receivedUpdates.length).toBe(0);

      a.close();
      b.close();
    });
  });

  it('TC-09: concurrent text inserts merge (red green blue)', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    createStickyInDoc(a.doc, 'n1', 0, 0, 'yellow', 'green');
    await sleep(300);

    // A inserts 'red ' at position 0, B inserts ' blue' at the end
    insertTextAt(a.doc, 'n1', 0, 'red ');
    insertTextAt(b.doc, 'n1', getNoteText(b.doc, 'n1').length, ' blue');

    await sleep(500);

    expect(getNoteText(a.doc, 'n1')).toBe('red green blue');
    expect(getNoteText(b.doc, 'n1')).toBe('red green blue');

    a.close();
    b.close();
  });

  it('TC-10: concurrent position sets converge to same value on both', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    createStickyInDoc(a.doc, 'n1', 0, 0);
    await sleep(300);

    // Both set x to different values "simultaneously"
    a.doc.transact(() => { getObj(a.doc, 'n1')!.set('x', 100); });
    b.doc.transact(() => { getObj(b.doc, 'n1')!.set('x', 300); });

    await sleep(500);

    const xA = getObj(a.doc, 'n1')!.get('x') as number;
    const xB = getObj(b.doc, 'n1')!.get('x') as number;
    expect(xA).toBe(xB);

    a.close();
    b.close();
  });

  it('TC-11: delete wins over concurrent text insert; no resurrection', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    createStickyInDoc(a.doc, 'n1', 0, 0, 'yellow', 'original');
    await sleep(300);

    // A deletes, B types into the note
    deleteInDoc(a.doc, 'n1');
    insertTextAt(b.doc, 'n1', 0, 'typed');

    await sleep(500);

    expect(a.snapshot().count).toBe(0);
    expect(b.snapshot().count).toBe(0);

    a.close();
    b.close();
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients with 200 random ops converge', async () => {
    const boardId = newBoardId();
    const numClients = MAX_CONCURRENT_EDITORS;
    const clients: WsClient[] = [];
    for (let i = 0; i < numClients; i++) {
      clients.push(await createWsClient(boardId));
    }
    await Promise.all(clients.map((c) => c.waitForSync()));

    let seed = 42;
    function rand(): number {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    const words = ['hello', 'world', 'foo', 'bar', 'test', 'idea'];

    for (let op = 0; op < 200; op++) {
      const client = clients[op % numClients];
      const action = rand();
      if (action < 0.4) {
        const snap = client.snapshot();
        if (snap.count > 0) {
          const noteId = snap.notes[Math.floor(rand() * snap.count)].id;
          const word = words[Math.floor(rand() * words.length)];
          insertTextAt(client.doc, noteId, getNoteText(client.doc, noteId).length, word + ' ');
        }
      } else if (action < 0.7) {
        const snap = client.snapshot();
        if (snap.count > 0) {
          const noteId = snap.notes[Math.floor(rand() * snap.count)].id;
          moveInDoc(client.doc, noteId, rand() * 1000, rand() * 1000);
        }
      } else if (action < 0.8) {
        const id = `note-${op}-${Math.floor(rand() * 10000)}`;
        createStickyInDoc(client.doc, id, rand() * 500, rand() * 500, 'yellow', words[0]);
      } else if (action < 0.9) {
        const snap = client.snapshot();
        if (snap.count > 0) {
          const noteId = snap.notes[Math.floor(rand() * snap.count)].id;
          const colors = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];
          setNoteColor(client.doc, noteId, colors[Math.floor(rand() * colors.length)]);
        }
      } else {
        const snap = client.snapshot();
        if (snap.count > 0) {
          const noteId = snap.notes[Math.floor(rand() * snap.count)].id;
          deleteInDoc(client.doc, noteId);
        }
      }
    }

    // Wait for all updates to propagate
    await sleep(5000);

    const sortSnap = (s: { count: number; notes: Array<{ id: string }> }) => ({
      count: s.count,
      notes: [...s.notes].sort((a, b) => a.id.localeCompare(b.id)),
    });
    const refSnap = sortSnap(clients[0].snapshot());
    for (let i = 1; i < clients.length; i++) {
      expect(sortSnap(clients[i].snapshot())).toEqual(refSnap);
    }

    for (const c of clients) c.close();
  }, 30000);

  it('TC-14: Late joiner C sees all notes from A and B', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    for (let i = 0; i < 10; i++) {
      createStickyInDoc(a.doc, `a-note-${i}`, i * 10, 0, 'yellow', `A${i}`);
      createStickyInDoc(b.doc, `b-note-${i}`, i * 10, 100, 'blue', `B${i}`);
    }
    await sleep(500);

    const c = await createWsClient(boardId);
    await c.waitForSync();
    await sleep(200);

    const snapC = c.snapshot();
    expect(snapC.count).toBe(20);

    a.close();
    b.close();
    c.close();
  });

  it('TC-15: malformed traffic from A closes A only; B still receives updates', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    // Send a string frame (text frame is invalid per protocol)
    a.ws.send('not binary');

    const closeResult = await Promise.race([
      a.closed,
      sleep(3000).then(() => null as { code: number } | null),
    ]);
    expect(closeResult).not.toBeNull();
    expect(closeResult!.code).toBe(CLOSE_CODE);

    // B should still be open
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    // B can still create a note
    createStickyInDoc(b.doc, 'b-note', 5, 5, 'green', 'still working');
    await sleep(300);
    expect(b.snapshot().count).toBe(1);

    b.close();
  }, 10000);

  it('TC-16: awareness bytes relayed to all sockets including sender', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();

    const awarenessPayload = new Uint8Array([1, 2, 3, 4, 5]);
    const msg = encoding.createEncoder();
    encoding.writeVarUint(msg, 1); // MESSAGE_AWARENESS
    encoding.writeUint8Array(msg, awarenessPayload);
    a.ws.send(encoding.toUint8Array(msg));

    await sleep(300);

    expect(a.receivedAwareness.length).toBeGreaterThanOrEqual(1);
    expect(b.receivedAwareness.length).toBeGreaterThanOrEqual(1);

    a.close();
    b.close();
  });

  it('TC-18: restart simulation — fresh room repopulated by reconnecting client', async () => {
    const boardId = newBoardId();

    const a1 = await createWsClient(boardId);
    await a1.waitForSync();
    createStickyInDoc(a1.doc, 'persistent-note', 10, 10, 'yellow', 'important');
    await sleep(300);
    a1.close();

    await sleep(500);

    // A reconnects — if room was evicted, fresh room gets state via SyncStep2
    const a2 = await createWsClient(boardId);
    await a2.waitForSync();
    await sleep(300);

    expect(a2.snapshot().count).toBeGreaterThanOrEqual(1);

    // B reconnects and should converge
    const b = await createWsClient(boardId);
    await b.waitForSync();
    await sleep(300);

    const snapA = a2.snapshot();
    const snapB = b.snapshot();
    expect(snapB.notes.map((n) => n.id).sort()).toEqual(snapA.notes.map((n) => n.id).sort());

    a2.close();
    b.close();
  });

  it('TC-31: dead socket dropped; later sockets still receive', async () => {
    const boardId = newBoardId();
    const a = await createWsClient(boardId);
    const b = await createWsClient(boardId);
    const c = await createWsClient(boardId);
    await a.waitForSync();
    await b.waitForSync();
    await c.waitForSync();

    b.ws.close();
    await sleep(200);

    createStickyInDoc(a.doc, 'after-b-dead', 0, 0, 'yellow', 'test');
    await sleep(300);

    expect(c.snapshot().count).toBe(1);

    a.close();
    c.close();
  });
});
