import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { createSticky, moveObject, setStickyColor, deleteObject, getStickyText, type StickySnapshot } from '../../src/shared/board-model.ts';
import { connectToBoard, WsClient } from './helpers/ws-client.ts';
import { generateRandomOps } from './helpers/random-ops.ts';

function snapshotsEqual(a: readonly StickySnapshot[], b: readonly StickySnapshot[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x.id.localeCompare(y.id));
  const sortedB = [...b].sort((x, y) => x.id.localeCompare(y.id));
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i].id !== sortedB[i].id) return false;
    if (sortedA[i].x !== sortedB[i].x) return false;
    if (sortedA[i].y !== sortedB[i].y) return false;
    if (sortedA[i].color !== sortedB[i].color) return false;
    if (sortedA[i].text !== sortedB[i].text) return false;
  }
  return true;
}

function waitForSyncBetween(a: WsClient, b: WsClient, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (snapshotsEqual(a.getSnapshot(), b.getSnapshot())) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error('Sync timeout'));
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
}

describe('BoardRoom merging and broadcast', () => {
  it('TC-07: A creates sticky, B snapshot equals A', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    createSticky(a.doc, { x: 100, y: 100 });

    await waitForSyncBetween(a, b);

    expect(snapshotsEqual(a.getSnapshot(), b.getSnapshot())).toBe(true);
    expect(b.getNoteCount()).toBe(1);

    a.destroy();
    b.destroy();
  });

  it('TC-08a: A moves note, B sees the move; A receives no echo', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await waitForSyncBetween(a, b);

    a.receivedMessages = [];
    b.receivedMessages = [];

    moveObject(a.doc, id, 200, 200);

    await waitForSyncBetween(a, b);

    const bSnap = b.getSnapshot();
    expect(bSnap[0].x).toBe(200);
    expect(bSnap[0].y).toBe(200);

    expect(a.receivedMessages.length).toBe(0);

    a.destroy();
    b.destroy();
  });

  it('TC-08b: A recolours note, B sees the colour change', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await waitForSyncBetween(a, b);

    setStickyColor(a.doc, id, 'blue');

    await waitForSyncBetween(a, b);

    const bSnap = b.getSnapshot();
    expect(bSnap[0].color).toBe('blue');

    a.destroy();
    b.destroy();
  });

  it('TC-08c: A inserts text, B sees the text', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await waitForSyncBetween(a, b);

    const text = getStickyText(a.doc, id)!;
    text.insert(0, 'hello world');

    await waitForSyncBetween(a, b);

    const bSnap = b.getSnapshot();
    expect(bSnap[0].text).toBe('hello world');

    a.destroy();
    b.destroy();
  });

  it('TC-08d: A deletes note, B sees deletion', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await waitForSyncBetween(a, b);

    deleteObject(a.doc, id);

    await waitForSyncBetween(a, b);

    expect(b.getNoteCount()).toBe(0);

    a.destroy();
    b.destroy();
  });

  it('TC-09: concurrent text inserts merge to "red green blue"', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    const text = getStickyText(a.doc, id)!;
    text.insert(0, 'green');
    await waitForSyncBetween(a, b);

    const textA = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;

    a.doc.transact(() => {
      textA.insert(0, 'red ');
    });
    b.doc.transact(() => {
      textB.insert(textB.length, ' blue');
    });

    await new Promise((r) => setTimeout(r, 500));
    await waitForSyncBetween(a, b);

    const aText = getStickyText(a.doc, id)!.toString();
    const bText = getStickyText(b.doc, id)!.toString();

    expect(aText).toBe('red green blue');
    expect(bText).toBe('red green blue');

    a.destroy();
    b.destroy();
  });

  it('TC-10: concurrent position sets converge to same value', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitForSyncBetween(a, b);

    a.doc.transact(() => {
      const obj = a.doc.getMap('objects').get(id) as Y.Map<unknown>;
      obj.set('x', 100);
    });
    b.doc.transact(() => {
      const obj = b.doc.getMap('objects').get(id) as Y.Map<unknown>;
      obj.set('x', 300);
    });

    await new Promise((r) => setTimeout(r, 500));
    await waitForSyncBetween(a, b);

    const aSnap = a.getSnapshot();
    const bSnap = b.getSnapshot();

    expect(aSnap[0].x).toBe(bSnap[0].x);
  });

  it('TC-11: delete wins over concurrent text insert', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const id = createSticky(a.doc, { x: 100, y: 100 });
    await waitForSyncBetween(a, b);

    a.doc.transact(() => {
      deleteObject(a.doc, id);
    });
    b.doc.transact(() => {
      const text = getStickyText(b.doc, id);
      if (text) text.insert(0, 'concurrent edit');
    });

    await new Promise((r) => setTimeout(r, 500));
    await waitForSyncBetween(a, b);

    expect(a.getNoteCount()).toBe(0);
    expect(b.getNoteCount()).toBe(0);

    a.destroy();
    b.destroy();
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients with 200 random ops converge', async () => {
    const boardId = newBoardId();
    const clients: WsClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      clients.push(await connectToBoard(boardId));
    }

    for (let i = 0; i < clients.length; i++) {
      generateRandomOps(clients[i].doc, 200, 12345 + i);
    }

    await new Promise((r) => setTimeout(r, 2000));
    await waitForSyncBetween(clients[0], clients[1], 10000);
    for (let i = 2; i < clients.length; i++) {
      await waitForSyncBetween(clients[0], clients[i], 10000);
    }

    for (let i = 1; i < clients.length; i++) {
      expect(snapshotsEqual(clients[0].getSnapshot(), clients[i].getSnapshot())).toBe(true);
    }

    for (const c of clients) c.destroy();
  });

  it('TC-14: late joiner C sees all 20 notes created by A and B', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 50, y: 0 });
    }
    for (let i = 0; i < 10; i++) {
      createSticky(b.doc, { x: i * 50, y: 100 });
    }

    await waitForSyncBetween(a, b);
    expect(a.getNoteCount()).toBe(20);

    const c = await connectToBoard(boardId);
    await new Promise((r) => setTimeout(r, 500));

    expect(c.getNoteCount()).toBe(20);
    expect(snapshotsEqual(a.getSnapshot(), c.getSnapshot())).toBe(true);

    a.destroy();
    b.destroy();
    c.destroy();
  });

  it('TC-15: malformed traffic closes sender, others unaffected', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    createSticky(b.doc, { x: 10, y: 10 });
    await waitForSyncBetween(a, b);

    a.ws.send('this is a text frame');

    await new Promise((r) => setTimeout(r, 500));

    expect(a.ws.readyState).toBe(WebSocket.CLOSED);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    createSticky(b.doc, { x: 20, y: 20 });
    await new Promise((r) => setTimeout(r, 200));
    expect(b.getNoteCount()).toBe(2);

    a.destroy();
    b.destroy();
  });

  it('TC-16: awareness bytes are relayed to all sockets including sender', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    const awarenessBytes = new Uint8Array([1, 2, 3, 4, 5]);

    a.receivedMessages = [];
    b.receivedMessages = [];

    a.sendAwareness(awarenessBytes);

    await new Promise((r) => setTimeout(r, 500));

    expect(a.receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(b.receivedMessages.length).toBeGreaterThanOrEqual(1);

    a.destroy();
    b.destroy();
  });

  it('TC-18: room restart simulation - reconnecting client repopulates', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);

    createSticky(a.doc, { x: 100, y: 100 });
    createSticky(a.doc, { x: 200, y: 200 });

    expect(a.getSnapshot().length).toBe(2);

    a.destroy();
    await new Promise((r) => setTimeout(r, 200));

    const a2 = await connectToBoard(boardId);
    await new Promise((r) => setTimeout(r, 500));

    expect(a2.getNoteCount()).toBe(2);

    const b = await connectToBoard(boardId);
    await new Promise((r) => setTimeout(r, 500));

    expect(b.getNoteCount()).toBe(2);
    expect(snapshotsEqual(a2.getSnapshot(), b.getSnapshot())).toBe(true);

    a2.destroy();
    b.destroy();
  });

  it('TC-31: dead socket does not crash the room', async () => {
    const boardId = newBoardId();
    const a = await connectToBoard(boardId);
    const b = await connectToBoard(boardId);

    b.ws.close();
    b.destroy();
    await new Promise((r) => setTimeout(r, 200));

    createSticky(a.doc, { x: 50, y: 50 });
    await new Promise((r) => setTimeout(r, 300));

    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(a.getNoteCount()).toBe(1);

    const c = await connectToBoard(boardId);
    await new Promise((r) => setTimeout(r, 300));
    expect(c.getNoteCount()).toBe(1);

    a.destroy();
    c.destroy();
  });
});
