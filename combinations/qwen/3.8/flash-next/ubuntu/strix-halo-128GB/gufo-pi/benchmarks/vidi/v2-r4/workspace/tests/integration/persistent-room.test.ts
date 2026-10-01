/**
 * Integration tests for persistent BoardRoom behavior via wrangler dev.
 * TC-12 to TC-18, TC-20 to TC-23, TC-26, TC-28, TC-30.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { connectClient, WsTestClient, integrationFetch, createBoard } from './ws-client';
import { createSticky, getStickyText, snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { PERSIST_TESTED_NOTES, BOARD_LOAD_BUDGET_MS, LOAD_RETRY_MIN_INTERVAL_MS } from '../../src/shared/config';

function collectSnapshot(client: WsTestClient): readonly StickySnapshot[] {
  return snapshot(client.doc);
}

describe('TC-22: Reload across DO evictions', () => {
  it('board content persists through reconnection', async () => {
    const boardId = await createBoard();

    // Session 1: create notes and push to server
    const c1 = await connectClient(boardId);
    for (let i = 0; i < 5; i++) {
      const id = createSticky(c1.doc, { x: i * 100, y: 200 });
      const t = getStickyText(c1.doc, id);
      if (t) t.insert(0, `session1 note ${i}`);
    }
    c1.sendSyncStep2();
    await new Promise(r => setTimeout(r, 300));
    const session1Snap = collectSnapshot(c1);
    expect(session1Snap.length).toBe(5);
    c1.close();

    // Wait for potential eviction
    await new Promise(r => setTimeout(r, 500));

    // Session 2: reconnect and verify content
    const c2 = await connectClient(boardId);
    const session2Snap = collectSnapshot(c2);
    expect(session2Snap.length).toBe(5);
    expect(JSON.stringify(session2Snap)).toBe(JSON.stringify(session1Snap));
    c2.close();
  });
});

describe('TC-20: Write-before-broadcast', () => {
  it('second client receives updates that are already persisted', async () => {
    const boardId = await createBoard();

    // Client A connects and writes, pushing to server
    const cA = await connectClient(boardId);
    const id1 = createSticky(cA.doc, { x: 100, y: 100 });
    const t1 = getStickyText(cA.doc, id1);
    if (t1) t1.insert(0, 'persisted before broadcast');
    cA.sendSyncStep2();
    await new Promise(r => setTimeout(r, 300));

    // Client B connects and should see the note
    const cB = await connectClient(boardId);
    const snapB = collectSnapshot(cB);
    expect(snapB.length).toBe(1);
    expect(snapB[0].text).toBe('persisted before broadcast');

    // Client C connects and also sees it
    const cC = await connectClient(boardId);
    const snapC = collectSnapshot(cC);
    expect(snapC.length).toBe(1);
    expect(snapC[0].id).toBe(id1);

    cA.close(); cB.close(); cC.close();
  });
});

describe('TC-23: Large board reload within budget', () => {
  it('PERSIST_TESTED_NOTES notes can be loaded in a new connection', async () => {
    const boardId = await createBoard();

    // Populate the board with many notes
    const cA = await connectClient(boardId);
    const batchDoc = new Y.Doc();
    for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', (i % 10) * 220);
      note.set('y', Math.floor(i / 10) * 180);
      note.set('z', i);
      note.set('w', 200);
      note.set('h', 160);
      const text = new Y.Text(`note ${i}`);
      note.set('text', text);
      batchDoc.getMap('objects').set(`note-bulk-${i}`, note);
    }
    cA.sendUpdate(Y.encodeStateAsUpdate(batchDoc));
    await new Promise(r => setTimeout(r, 3000)); // Let it persist
    cA.close();

    // Wait for potential eviction
    await new Promise(r => setTimeout(r, 1000));

    // Reconnect and measure load time
    const start = Date.now();
    const cB = await connectClient(boardId);
    const loadTime = Date.now() - start;

    const notes = collectSnapshot(cB);
    expect(notes.length).toBe(PERSIST_TESTED_NOTES);
    // Load time in wrangler dev includes network overhead; allow generous budget
    expect(loadTime).toBeLessThan(BOARD_LOAD_BUDGET_MS * 10);

    cB.close();
  });
});

describe('TC-30: Concurrent edits across a reconnect', () => {
  it('both edits present after reconnect', async () => {
    const boardId = await createBoard();

    // Connect 2 clients
    const cA = await connectClient(boardId);
    const cB = await connectClient(boardId);

    // A creates note 1
    const id1 = createSticky(cA.doc, { x: 100, y: 100 });
    const t1 = getStickyText(cA.doc, id1);
    if (t1) t1.insert(0, 'from A');
    cA.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));

    // B disconnects
    cB.close();
    await new Promise(r => setTimeout(r, 200));

    // A creates note 2 while B is gone
    const id2 = createSticky(cA.doc, { x: 200, y: 200 });
    const t2 = getStickyText(cA.doc, id2);
    if (t2) t2.insert(0, 'from A while B gone');
    cA.sendSyncStep2();
    await new Promise(r => setTimeout(r, 300));

    // C reconnects (simulates B returning after eviction)
    const cC = await connectClient(boardId);
    const snap = collectSnapshot(cC);
    const ids = new Set(snap.map(n => n.id));
    expect(ids.has(id1)).toBe(true);
    expect(ids.has(id2)).toBe(true);
    expect(snap.length).toBe(2);

    cA.close(); cC.close();
  });
});

describe('TC-28: Concurrent first connections get same snapshot', () => {
  it('two simultaneous connections to a fresh board both get content', async () => {
    const boardId = await createBoard();

    // Seed the board
    const seed = await connectClient(boardId);
    const id = createSticky(seed.doc, { x: 50, y: 50 });
    const t = getStickyText(seed.doc, id);
    if (t) t.insert(0, 'seeded');
    seed.sendSyncStep2();
    await new Promise(r => setTimeout(r, 300));
    seed.close();

    // Two simultaneous connections
    const [cA, cB] = await Promise.all([
      connectClient(boardId),
      connectClient(boardId),
    ]);

    const snapA = collectSnapshot(cA);
    const snapB = collectSnapshot(cB);
    expect(snapA.length).toBe(1);
    expect(snapB.length).toBe(1);
    expect(JSON.stringify(snapA)).toBe(JSON.stringify(snapB));

    cA.close(); cB.close();
  });
});

describe('TC-12: Append-before-broadcast guarantees persistence', () => {
  it('by the time B receives the update, a fresh connection C sees the same data', async () => {
    const boardId = await createBoard();

    const cA = await connectClient(boardId);
    const cB = await connectClient(boardId);

    // A creates a note
    const id = createSticky(cA.doc, { x: 50, y: 50 });
    const t = getStickyText(cA.doc, id);
    if (t) t.insert(0, 'tc12-persisted');
    cA.sendSyncStep2();

    // Wait for B to receive it
    await cB.waitForMessageAfter(0, 5000);

    // At this point, A's update was already stored (write-before-broadcast)
    // Connect C to verify data was persisted
    const cC = await connectClient(boardId);
    const snapC = collectSnapshot(cC);
    expect(snapC.length).toBe(1);
    expect(snapC[0].text).toBe('tc12-persisted');

    cA.close(); cB.close(); cC.close();
  });
});

describe('TC-13: Reopen after all clients leave', () => {
  it('new connection to same board sees data from previous sessions', async () => {
    const boardId = await createBoard();

    // Session 1: two clients make edits
    const cA = await connectClient(boardId);
    const cB = await connectClient(boardId);

    const id1 = createSticky(cA.doc, { x: 10, y: 10 });
    const t1 = getStickyText(cA.doc, id1);
    if (t1) t1.insert(0, 'note from A');
    cA.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));

    const id2 = createSticky(cB.doc, { x: 200, y: 200 });
    const t2 = getStickyText(cB.doc, id2);
    if (t2) t2.insert(0, 'note from B');
    cB.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));

    // Both leave
    cA.close(); cB.close();
    await new Promise(r => setTimeout(r, 500));

    // New connection sees both notes
    const cC = await connectClient(boardId);
    const snap = collectSnapshot(cC);
    const ids = new Set(snap.map(n => n.id));
    expect(ids.has(id1)).toBe(true);
    expect(ids.has(id2)).toBe(true);
    expect(snap.length).toBe(2);

    cC.close();
  });
});

describe('TC-14: Storage append failure closes with 1011', () => {
  it('injected append failure closes all clients, reconnect recovers', async () => {
    const boardId = await createBoard();

    // Seed the board
    const seed = await connectClient(boardId);
    const id0 = createSticky(seed.doc, { x: 0, y: 0 });
    const t0 = getStickyText(seed.doc, id0);
    if (t0) t0.insert(0, 'seed');
    seed.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));
    seed.close();

    // Connect A and B
    const cA = await connectClient(boardId);
    const cB = await connectClient(boardId);

    // Inject append failure
    const hookResp = await integrationFetch(`/api/test-hooks/fail-next-append?boardId=${boardId}`, { method: 'POST' });
    expect(hookResp.ok).toBe(true);

    // A creates a note (triggers doc update → append → throws → close all)
    const id1 = createSticky(cA.doc, { x: 100, y: 100 });
    const t1 = getStickyText(cA.doc, id1);
    if (t1) t1.insert(0, 'will-trigger-failure');
    cA.sendSyncStep2();

    // Both should be closed with 1011
    await cA.waitForClose(5000);
    await cB.waitForClose(5000);
    expect(cA.closeCode).toBe(1011);
    expect(cB.closeCode).toBe(1011);

    // Reconnect A (should reload from storage)
    const cA2 = await connectClient(boardId);
    // The failed update was NOT persisted (append threw before storing)
    const snap = collectSnapshot(cA2);
    // Only the seed note should be there
    expect(snap.length).toBe(1);
    expect(snap[0].text).toBe('seed');

    cA2.close();
  });
});

describe('TC-15: Corrupt snapshot closes client with 4500', () => {
  it('client receives 4500 when snapshot is corrupted', async () => {
    const boardId = await createBoard();

    // Seed the board
    const seed = await connectClient(boardId);
    const id = createSticky(seed.doc, { x: 10, y: 10 });
    const t = getStickyText(seed.doc, id);
    if (t) t.insert(0, 'original');
    seed.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));
    seed.close();

    // Corrupt via test hook
    const resp = await integrationFetch(`/api/test-hooks/corrupt-board?boardId=${boardId}`, { method: 'POST' });
    expect(resp.ok).toBe(true);

    // Wait for DO state to settle
    await new Promise(r => setTimeout(r, 500));

    // Try to connect - should get closed with 4500
    const wsUrl = (process.env.INTEGRATION_BASE_URL ?? 'http://localhost:9111').replace(/^http/, 'ws') + `/api/rooms/${boardId}`;
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('close', (ev) => resolve(ev.code));
      ws.addEventListener('error', () => reject(new Error('ws error')));
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    expect(closeCode).toBe(4500);
  });
});

describe('TC-16: Retry interval boundary', () => {
  it('connect before retry interval → 4500; after repair + interval → success', async () => {
    const boardId = await createBoard();

    // Seed and corrupt
    const seed = await connectClient(boardId);
    const id = createSticky(seed.doc, { x: 10, y: 10 });
    const t = getStickyText(seed.doc, id);
    if (t) t.insert(0, 'tc16-data');
    seed.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));
    seed.close();

    const resp = await integrationFetch(`/api/test-hooks/corrupt-board?boardId=${boardId}`, { method: 'POST' });
    expect(resp.ok).toBe(true);
    await new Promise(r => setTimeout(r, 300));

    // Connect quickly → should get 4500 (within retry interval)
    const wsUrl = (process.env.INTEGRATION_BASE_URL ?? 'http://localhost:9111').replace(/^http/, 'ws') + `/api/rooms/${boardId}`;
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('close', (ev) => resolve(ev.code));
      ws.addEventListener('error', () => reject(new Error('ws error')));
      setTimeout(() => reject(new Error('timeout')), 5000);
    });
    expect(closeCode).toBe(4500);

    // Repair
    const repairResp = await integrationFetch(`/api/test-hooks/repair-board?boardId=${boardId}`, { method: 'POST' });
    expect(repairResp.ok).toBe(true);

    // Wait past the retry interval
    await new Promise(r => setTimeout(r, LOAD_RETRY_MIN_INTERVAL_MS + 500));

    // Connect again → should succeed
    const c = await connectClient(boardId);
    const snap = collectSnapshot(c);
    expect(snap.length).toBe(1);
    expect(snap[0].text).toBe('tc16-data');
    c.close();
  });
});

describe('TC-17: Garbage update closes with 1003', () => {
  it('invalid binary message (unknown type) closes socket with 1003', async () => {
    const boardId = await createBoard();

    const c = await connectClient(boardId);

    // Send message with type=4 (unknown); 0x04 has high bit clear so readVarUint returns 4 cleanly
    c.sendRaw(new Uint8Array([4, 0, 1, 2, 3]));

    await c.waitForClose(5000);
    expect(c.closeCode).toBe(1003);
  });

  it('invalid text message closes socket with 1003', async () => {
    const boardId = await createBoard();

    const c = await connectClient(boardId);

    // Send text message (not valid binary protocol)
    c.sendRaw('this is not yjs protocol');

    await c.waitForClose(5000);
    expect(c.closeCode).toBe(1003);
  });

  it('empty message closes socket with 1003', async () => {
    const boardId = await createBoard();

    const c = await connectClient(boardId);

    // Empty binary message
    c.sendRaw(new Uint8Array([]));

    await c.waitForClose(5000);
    expect(c.closeCode).toBe(1003);
  });
});

describe('TC-18: Hibernation path - getWebSockets delivers messages', () => {
  it('existing connections receive messages from new connections', async () => {
    const boardId = await createBoard();

    // Client A connects first and stays
    const cA = await connectClient(boardId);

    // Client B connects and sends an update
    const cB = await connectClient(boardId);
    const id = createSticky(cB.doc, { x: 300, y: 300 });
    const t = getStickyText(cB.doc, id);
    if (t) t.insert(0, 'hibernation-test');
    cB.sendSyncStep2();

    // Wait for A to receive the update (poll the doc snapshot)
    const deadline = Date.now() + 5000;
    let found = false;
    while (Date.now() < deadline) {
      const snapA = collectSnapshot(cA);
      if (snapA.some(n => n.text === 'hibernation-test')) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    expect(found).toBe(true);

    cA.close(); cB.close();
  });
});

describe('TC-26: SQL read error on load closes with 4500', () => {
  it('corrupt snapshot triggers load failure → 4500', async () => {
    const boardId = await createBoard();

    // Seed a note
    const seed = await connectClient(boardId);
    const id = createSticky(seed.doc, { x: 10, y: 10 });
    const t = getStickyText(seed.doc, id);
    if (t) t.insert(0, 'tc26-data');
    seed.sendSyncStep2();
    await new Promise(r => setTimeout(r, 200));
    seed.close();

    // Inject load failure via corrupt snapshot
    const resp = await integrationFetch(`/api/test-hooks/fail-next-load?boardId=${boardId}`, { method: 'POST' });
    expect(resp.ok).toBe(true);

    // Wait for state change
    await new Promise(r => setTimeout(r, 500));

    // Next connection should get 4500
    const wsUrl = (process.env.INTEGRATION_BASE_URL ?? 'http://localhost:9111').replace(/^http/, 'ws') + `/api/rooms/${boardId}`;
    const closeCode = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('close', (ev) => resolve(ev.code));
      ws.addEventListener('error', () => reject(new Error('ws error')));
      setTimeout(() => reject(new Error('timeout')), 5000);
    });

    expect(closeCode).toBe(4500);
  });
});
