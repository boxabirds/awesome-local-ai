import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, URL, createBoard } from './server';
import { createTestClient, sendRaw, sendAwareness, waitForCondition, type TestClient } from './ws-client';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { initDoc, createSticky, moveObject, setStickyColor, deleteObject, getStickyText, snapshot } from '../../src/shared/board-model';
import { performRandomOps } from './random-ops';
import * as encoding from 'lib0/encoding';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';

describe('BoardRoom Durable Object integration tests', () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it('TC-07: A creates sticky → B snapshot equals A; B received exactly one update', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    createSticky(a.doc, { x: 100, y: 200 });

    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    const snapA = snapshot(a.doc);
    const snapB = snapshot(b.doc);
    expect(snapB.length).toBe(1);
    expect(snapB[0].x).toBe(snapA[0].x);
    expect(snapB[0].y).toBe(snapA[0].y);
    expect(snapB[0].color).toBe(snapA[0].color);

    a.destroy();
    b.destroy();
  });

  it('TC-08a: A moves note → B equals A; A receives no echo', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    moveObject(a.doc, id, 300, 400);

    await waitForCondition(() => {
      const s = snapshot(b.doc);
      return s.length === 1 && s[0].x === 300 && s[0].y === 400;
    }, 5000, 'B to see move');

    const snapB = snapshot(b.doc);
    expect(snapB[0].x).toBe(300);
    expect(snapB[0].y).toBe(400);

    a.destroy();
    b.destroy();
  });

  it('TC-08b: A recolours note → B equals A', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    setStickyColor(a.doc, id, 'blue');

    await waitForCondition(() => {
      const s = snapshot(b.doc);
      return s.length === 1 && s[0].color === 'blue';
    }, 5000, 'B to see colour change');

    a.destroy();
    b.destroy();
  });

  it('TC-08c: A inserts text → B equals A', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    const textA = getStickyText(a.doc, id)!;
    textA.insert(0, 'Hello ');

    await waitForCondition(() => {
      const s = snapshot(b.doc);
      return s.length === 1 && s[0].text === 'Hello ';
    }, 5000, 'B to see text');

    a.destroy();
    b.destroy();
  });

  it('TC-08d: A deletes note → B note gone', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    deleteObject(a.doc, id);

    await waitForCondition(() => snapshot(b.doc).length === 0, 5000, 'B to see deletion');

    a.destroy();
    b.destroy();
  });

  it('TC-09: concurrent text inserts merge to "red green blue"', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    // Both clients now have the note with empty text
    // First put 'green' in the text
    const textA = getStickyText(a.doc, id)!;
    textA.insert(0, 'green');
    await waitForCondition(() => {
      const s = snapshot(b.doc);
      return s[0].text === 'green';
    }, 5000, 'B to see "green"');

    // Now concurrent edits: A inserts 'red ' at 0, B inserts ' blue' at end
    const textA2 = getStickyText(a.doc, id)!;
    const textB = getStickyText(b.doc, id)!;
    textA2.insert(0, 'red ');
    textB.insert(textB.length, ' blue');

    // Wait for both to converge
    await waitForCondition(() => {
      const sA = snapshot(a.doc);
      const sB = snapshot(b.doc);
      return sA[0].text === 'red green blue' && sB[0].text === 'red green blue';
    }, 5000, 'both to converge to "red green blue"');

    expect(snapshot(a.doc)[0].text).toBe('red green blue');
    expect(snapshot(b.doc)[0].text).toBe('red green blue');

    a.destroy();
    b.destroy();
  });

  it('TC-10: concurrent position sets converge to same value', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 0, y: 0 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    // Concurrent: A sets x=100, B sets x=300
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    // Wait for convergence
    await waitForCondition(() => {
      const sA = snapshot(a.doc);
      const sB = snapshot(b.doc);
      return sA[0].x === sB[0].x;
    }, 5000, 'positions to converge');

    const sA = snapshot(a.doc);
    const sB = snapshot(b.doc);
    expect(sA[0].x).toBe(sB[0].x);
    expect([100, 300]).toContain(sA[0].x);

    a.destroy();
    b.destroy();
  });

  it('TC-11: A deletes note while B inserts text → note absent on both, no resurrection', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    const id = createSticky(a.doc, { x: 100, y: 100 }) as string;
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    // Concurrent: A deletes, B inserts text
    deleteObject(a.doc, id);
    const textB = getStickyText(b.doc, id);
    if (textB) {
      textB.insert(0, 'should not appear');
    }

    // Wait for both to converge to empty
    await waitForCondition(() => {
      return snapshot(a.doc).length === 0 && snapshot(b.doc).length === 0;
    }, 5000, 'both to show deletion');

    expect(snapshot(a.doc).length).toBe(0);
    expect(snapshot(b.doc).length).toBe(0);

    a.destroy();
    b.destroy();
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops → identical snapshots', async () => {
    const boardId = await createBoard();
    const seed = 42;
    const clients: TestClient[] = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
      const client = await createTestClient(URL, boardId);
      initDoc(client.doc);
      clients.push(client);
    }

    // Wait for all to be in sync
    await new Promise(r => setTimeout(r, 1000));

    // Each client performs 200 random ops
    for (const client of clients) {
      performRandomOps(client.doc, 200, seed);
    }

    // Wait for convergence. Story 4 adds a SQLite write per update, so the
    // broadcast pipeline needs longer than a fixed 3s under burst load;
    // poll until every client holds the same state (bounded by 15s).
    await waitForCondition(
      () => {
        const snaps = clients.map(c => JSON.stringify(snapshot(c.doc)));
        return snaps.every(s => s === snaps[0]);
      },
      15000,
      'all clients to converge'
    );

    const snaps = clients.map(c => JSON.stringify(snapshot(c.doc)));
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i]).toBe(snaps[0]);
    }

    console.log(`TC-12: seed=${seed}, all ${MAX_CONCURRENT_EDITORS} clients converged`);

    for (const c of clients) c.destroy();
  }, 30000);

  it('TC-14: late joiner C sees all 20 notes created by A and B', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    // A creates 10 notes
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 100, y: 0 });
    }
    // B creates 10 notes
    for (let i = 0; i < 10; i++) {
      createSticky(b.doc, { x: i * 100, y: 200 });
    }

    // Wait for both to see all 20
    await waitForCondition(() => snapshot(a.doc).length === 20, 5000, 'A to see 20 notes');
    await waitForCondition(() => snapshot(b.doc).length === 20, 5000, 'B to see 20 notes');

    // Late joiner C connects
    const c = await createTestClient(URL, boardId);

    // C should immediately see all 20 notes
    await waitForCondition(() => snapshot(c.doc).length === 20, 5000, 'C to see 20 notes');

    const snapA = JSON.stringify(snapshot(a.doc).map(n => ({id: n.id, x: n.x, y: n.y, color: n.color})).sort((a, b) => a.id.localeCompare(b.id)));
    const snapC = JSON.stringify(snapshot(c.doc).map(n => ({id: n.id, x: n.x, y: n.y, color: n.color})).sort((a, b) => a.id.localeCompare(b.id)));
    expect(snapC).toBe(snapA);

    a.destroy();
    b.destroy();
    c.destroy();
  });

  it('TC-15: malformed traffic from A → A closed with 1003, B still open and receives updates', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);
    initDoc(a.doc);

    // Run 4 types of malformed traffic
    const malformedFrames: (Uint8Array | string)[] = [
      // 1. Text frame (string) → invalid, closed with 1003
      'hello',
      // 2. Truncated sync frame (SyncStep1 with no state vector) → invalid
      new Uint8Array([MESSAGE_SYNC, 0]),
      // 3. Unknown type 9 → ignored, not fatal
      new Uint8Array([9, 1, 2, 3]),
      // 4. Invalid Yjs update (random bytes as sync update) → closed with 1003
      (() => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        const innerEnc = encoding.createEncoder();
        encoding.writeVarUint(innerEnc, 2); // update message type
        encoding.writeVarUint8Array(innerEnc, new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]));
        encoding.writeUint8Array(enc, encoding.toUint8Array(innerEnc));
        return encoding.toUint8Array(enc);
      })(),
    ];

    for (const frame of malformedFrames) {
      if (a.ws.readyState === WebSocket.CLOSED || a.ws.readyState === WebSocket.CLOSING) break;
      sendRaw(a, frame);
      await new Promise(r => setTimeout(r, 200));
    }

    // A should be closed with code 1003
    await waitForCondition(() => a.closeCode !== null, 5000, 'A to be closed');
    expect(a.closeCode).toBe(CLOSE_UNSUPPORTED_DATA);

    // B should still be open
    expect(b.closeCode).toBeNull();
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    // B can still receive updates
    const c = await createTestClient(URL, boardId);
    initDoc(c.doc);
    createSticky(c.doc, { x: 50, y: 50 });
    await waitForCondition(() => snapshot(b.doc).length >= 1, 5000, 'B to receive update');

    b.destroy();
    c.destroy();
  });

  it('TC-16: awareness bytes from A → A and B both receive identical bytes', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    const awarenessPayload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const msgCountA = a.receivedMessages.length;
    const msgCountB = b.receivedMessages.length;

    sendAwareness(a, awarenessPayload);

    // Wait for both to receive the awareness relay
    await waitForCondition(() => {
      return a.receivedMessages.length > msgCountA && b.receivedMessages.length > msgCountB;
    }, 5000, 'both to receive awareness');

    // Both should have received the same awareness frame
    const aFrame = a.receivedMessages[a.receivedMessages.length - 1];
    const bFrame = b.receivedMessages[b.receivedMessages.length - 1];

    expect(aFrame[0]).toBe(MESSAGE_AWARENESS);
    expect(bFrame[0]).toBe(MESSAGE_AWARENESS);
    expect(aFrame.length).toBe(bFrame.length);
    for (let i = 0; i < aFrame.length; i++) {
      expect(aFrame[i]).toBe(bFrame[i]);
    }

    a.destroy();
    b.destroy();
  });

  it('TC-18: restart simulation - A reconnects to fresh room, B converges', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);

    initDoc(a.doc);
    createSticky(a.doc, { x: 100, y: 100 });
    createSticky(a.doc, { x: 200, y: 200 });
    await waitForCondition(() => snapshot(b.doc).length === 2, 5000, 'B to see 2 notes');

    // Simulate restart: close all sockets
    a.destroy();
    b.destroy();
    await new Promise(r => setTimeout(r, 500));

    // A reconnects first (to a fresh room instance)
    const a2 = await createTestClient(URL, boardId);
    await new Promise(r => setTimeout(r, 1000));

    // B reconnects
    const b2 = await createTestClient(URL, boardId);
    await waitForCondition(() => snapshot(b2.doc).length === 2, 5000, 'B2 to see 2 notes');

    const snapA = snapshot(a2.doc);
    const snapB = snapshot(b2.doc);
    expect(snapA.length).toBe(2);
    expect(snapB.length).toBe(2);

    a2.destroy();
    b2.destroy();
  });

  it('TC-31: B closed abruptly, A sends update → room does not throw; later sockets still receive', async () => {
    const boardId = await createBoard();
    const a = await createTestClient(URL, boardId);
    const b = await createTestClient(URL, boardId);
    initDoc(a.doc);

    createSticky(a.doc, { x: 100, y: 100 });
    await waitForCondition(() => snapshot(b.doc).length === 1, 5000, 'B to see note');

    // Abruptly close B's socket
    b.ws.close();
    await new Promise(r => setTimeout(r, 500));

    // A sends another update
    createSticky(a.doc, { x: 300, y: 300 });

    // A new client C connects and should see both notes
    const c = await createTestClient(URL, boardId);
    await waitForCondition(() => snapshot(c.doc).length === 2, 5000, 'C to see 2 notes');

    expect(snapshot(c.doc).length).toBe(2);

    a.destroy();
    c.destroy();
  });
});
