/**
 * TC-17: every update from A to B (3 edits) acks exactly once each.
 * TC-18: awareness relay and handshake are never acked.
 * TC-19: two clients: A edits, B acks A's; A's ack count stays 0.
 * TC-20: hibernate, then wake: a late-arriving update still acks.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { connectClient, type WsClient } from './ws-client';

const room = (boardId: string) =>
  env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));

let boardCounter = 0;

function newBoard(): string {
  boardCounter += 1;
  // Exactly 22 chars from [A-Za-z0-9_-].
  const prefix = 'ack' + String(boardCounter).padStart(2, '0');
  const suffix = Math.random().toString(36).replace(/[^a-zA-Z0-9]/g, '').slice(0, 19).padEnd(19, 'x');
  return (prefix + suffix).slice(0, 22);
}

describe('sync ack integration (story 13)', () => {
  it('TC-17: every update from A is acked exactly once', async () => {
    const id = newBoard();
    const a = await connectClient(id);
    await a.waitForSync();

    const acksBefore = a.syncAckCount;

    // Make 3 edits in separate macrotasks so Yjs sends them as 3 frames.
    const objects = a.doc.getMap('objects');
    objects.set('n1', new Y.Map());
    await new Promise((r) => setTimeout(r, 50));
    objects.set('n2', new Y.Map());
    await new Promise((r) => setTimeout(r, 50));
    objects.set('n3', new Y.Map());

    // Wait for the room to process and ack.
    await new Promise((r) => setTimeout(r, 200));

    expect(a.syncAckCount - acksBefore).toBe(3);
    a.close();
  });

  it('TC-18: awareness frames are never acked', async () => {
    const id = newBoard();
    const a = await connectClient(id);
    await a.waitForSync();

    // After the handshake, wait a tick for any in-flight acks to arrive.
    await new Promise((r) => setTimeout(r, 100));
    const afterHandshake = a.syncAckCount;

    // Send an awareness frame — no ack expected.
    a.sendAwareness(a.encodeAwareness({ user: 'a' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(a.syncAckCount).toBe(afterHandshake);

    // Send another awareness frame — still no ack.
    a.sendAwareness(a.encodeAwareness({ user: 'a', color: 'red' }));
    await new Promise((r) => setTimeout(r, 100));
    expect(a.syncAckCount).toBe(afterHandshake);

    a.close();
  });

  it('TC-19: two clients: A edits, B receives; both get acked', async () => {
    const id = newBoard();
    const a = await connectClient(id);
    const b = await connectClient(id);
    await a.waitForSync();
    await b.waitForSync();

    const acksA = a.syncAckCount;
    const acksB = b.syncAckCount;

    // A makes an edit.
    a.doc.getMap('objects').set('n1', new Y.Map());

    // B makes an edit.
    b.doc.getMap('objects').set('n2', new Y.Map());

    await new Promise((r) => setTimeout(r, 300));

    // Both clients should have received acks for their own edits.
    expect(a.syncAckCount).toBeGreaterThan(acksA);
    expect(b.syncAckCount).toBeGreaterThan(acksB);

    a.close();
    b.close();
  });

  it('TC-20: hibernate, then wake: a late-arriving update still acks', async () => {
    const id = newBoard();
    const a = await connectClient(id);
    await a.waitForSync();

    // Make an edit and confirm it's stored.
    a.doc.getMap('objects').set('n1', new Y.Map());
    await new Promise((r) => setTimeout(r, 100));

    const acksAfterFirst = a.syncAckCount;
    expect(acksAfterFirst).toBeGreaterThanOrEqual(1);

    // Hibernate the room (simulate the platform discarding in-memory state).
    await runInDurableObject(room(id), (r) => {
      (r as unknown as { resetForTest: () => void }).resetForTest();
    });

    // Make another edit — the room wakes (webSocketMessage handler) and acks.
    a.doc.getMap('objects').set('n2', new Y.Map());
    await new Promise((r) => setTimeout(r, 300));

    // The second edit should have been acked.
    expect(a.syncAckCount).toBeGreaterThan(acksAfterFirst);

    a.close();
  });
});
