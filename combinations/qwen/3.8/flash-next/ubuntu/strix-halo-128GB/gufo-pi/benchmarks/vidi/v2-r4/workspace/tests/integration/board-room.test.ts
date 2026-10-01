import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { newBoardId } from '../../src/shared/board-id';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import {
  createSticky,
  deleteObject,
  moveObject,
} from '../../src/shared/board-model';
import { connectClient } from './ws-client';

describe('sync.board_room', () => {
  // TC-07: server-side Y.Doc merges updates from one socket
  it('TC-07: server merges a single client update', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);

    // Create a sticky and push to server
    createSticky(clientA.doc, { x: 10, y: 20 });
    clientA.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Connect a second client: should see the sticky
    const clientB = await connectClient(boardId);
    expect(clientB.getSnapshot().length).toBe(1);

    clientA.close();
    clientB.close();
  });

  // TC-08: broadcast to other clients with latency < 1000ms
  it('TC-08: update from one client appears at another within budget', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);
    const clientB = await connectClient(boardId);

    // A creates a sticky
    createSticky(clientA.doc, { x: 0, y: 0 });
    clientA.sendSyncStep2();

    // B should see it within latency budget
    const start = Date.now();
    while (clientB.getSnapshot().length === 0 && Date.now() - start < LIVE_UPDATE_LATENCY_BUDGET_MS) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const elapsed = Date.now() - start;

    expect(clientB.getSnapshot().length).toBe(1);
    expect(elapsed).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);

    clientA.close();
    clientB.close();
  });

  // TC-09: two concurrent clients create → identical snapshots
  it('TC-09: concurrent creates produce identical snapshots', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);
    const clientB = await connectClient(boardId);

    // Both create simultaneously
    createSticky(clientA.doc, { x: 10, y: 10 });
    createSticky(clientB.doc, { x: 20, y: 20 });

    // Push both to server
    clientA.sendSyncStep2();
    clientB.sendSyncStep2();

    // Wait for convergence
    await new Promise(resolve => setTimeout(resolve, 500));

    // Sync again to ensure full convergence
    clientA.sendSyncStep1();
    clientB.sendSyncStep1();
    await new Promise(resolve => setTimeout(resolve, 300));

    const snapA = clientA.getSnapshot();
    const snapB = clientB.getSnapshot();
    expect(snapA.length).toBe(2);
    expect(snapB.length).toBe(2);
    expect(JSON.stringify(snapA)).toBe(JSON.stringify(snapB));

    clientA.close();
    clientB.close();
  });

  // TC-10: two clients delete the same sticky → exactly one entry (zero)
  it('TC-10: concurrent deletes of same sticky converge to zero', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);

    // Create a sticky
    const stickyId = createSticky(clientA.doc, { x: 0, y: 0 });
    clientA.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Both clients join knowing about the sticky
    const clientB = await connectClient(boardId);
    expect(clientB.getSnapshot().length).toBe(1);

    // Both delete the same sticky
    deleteObject(clientA.doc, stickyId);
    deleteObject(clientB.doc, stickyId);
    clientA.sendSyncStep2();
    clientB.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Sync to ensure convergence
    clientA.sendSyncStep1();
    clientB.sendSyncStep1();
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(clientA.getSnapshot().length).toBe(0);
    expect(clientB.getSnapshot().length).toBe(0);

    clientA.close();
    clientB.close();
  });

  // TC-11: 12 rapid edits by A → B sees them, converges
  it('TC-11: 12 rapid edits by A appear at B', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);
    const clientB = await connectClient(boardId);

    // Create one sticky
    const stickyId = createSticky(clientA.doc, { x: 0, y: 0 });
    clientA.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Make 12 rapid moves
    for (let i = 1; i <= 12; i++) {
      moveObject(clientA.doc, stickyId, i * 10, i * 10);
    }
    clientA.sendSyncStep2();

    // Wait for B to receive all updates
    const start = Date.now();
    while (true) {
      const snap = clientB.getSnapshot();
      if (snap.length === 1 && snap[0].x === 120) break;
      if (Date.now() - start > LIVE_UPDATE_LATENCY_BUDGET_MS) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }

    expect(clientB.getSnapshot().length).toBe(1);
    expect(clientB.getSnapshot()[0].x).toBe(120);

    clientA.close();
    clientB.close();
  });

  // TC-12: awareness message is relayed to every open socket including sender
  it('TC-12: awareness is relayed to all sockets including sender', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);
    const clientB = await connectClient(boardId);

    // Client A sends awareness: [MESSAGE_AWARENESS(1), varUint8Array(payload)]
    const awEnc = encoding.createEncoder();
    encoding.writeVarUint(awEnc, 1); // MESSAGE_AWARENESS
    encoding.writeVarUint8Array(awEnc, new Uint8Array([42, 43, 44]));
    clientA.sendRaw(encoding.toUint8Array(awEnc).buffer as ArrayBuffer);

    await new Promise(resolve => setTimeout(resolve, 300));

    // Both A and B should have received awareness messages
    const awA = clientA.receivedMessages.filter(m => m.type === 1);
    const awB = clientB.receivedMessages.filter(m => m.type === 1);
    expect(awA.length).toBeGreaterThanOrEqual(1);
    expect(awB.length).toBeGreaterThanOrEqual(1);

    clientA.close();
    clientB.close();
  });

  // TC-14: text frame → close with code 1003
  it('TC-14: text frame closes socket with code 1003', async () => {
    const boardId = newBoardId();
    const client = await connectClient(boardId);

    // Send a text frame (non-binary)
    client.sendRaw('hello');

    await client.waitForClose();
    expect(client.closeCode).toBe(1003);
  });

  // TC-15: unknown message type → close with 1003
  it('TC-15: unknown message type closes socket with code 1003', async () => {
    const boardId = newBoardId();
    const client = await connectClient(boardId);

    // Send frame with unknown type (type 99)
    const frame = new Uint8Array([99, 1, 2, 3]);
    client.sendRaw(frame.buffer as ArrayBuffer);

    await client.waitForClose();
    expect(client.closeCode).toBe(1003);
  });

  // TC-16: empty frame → close with 1003
  it('TC-16: empty frame closes socket with code 1003', async () => {
    const boardId = newBoardId();
    const client = await connectClient(boardId);

    // Send an empty buffer
    client.sendRaw(new ArrayBuffer(0));

    await client.waitForClose();
    expect(client.closeCode).toBe(1003);
  });

  // TC-18: malformed sync bytes → close with 1003
  it('TC-18: malformed sync bytes closes socket with code 1003', async () => {
    const boardId = newBoardId();
    const client = await connectClient(boardId);

    // Send sync type (MESSAGE_SYNC=0) with SyncStep1 inner type (0)
    // but with a state vector that is absurdly long (corrupt)
    const frame = new Uint8Array([0, 0, 0xFF, 0xFF, 0xFF, 0x7F, 0x01]);
    client.sendRaw(frame.buffer as ArrayBuffer);

    await client.waitForClose();
    expect(client.closeCode).toBe(1003);
  });

  // TC-31: two clients create distinct stickies → both present
  it('TC-31: two clients create distinct stickies, both converge', async () => {
    const boardId = newBoardId();
    const clientA = await connectClient(boardId);
    const clientB = await connectClient(boardId);

    // A creates one
    createSticky(clientA.doc, { x: 5, y: 5 });
    // B creates another
    createSticky(clientB.doc, { x: 15, y: 15 });

    clientA.sendSyncStep2();
    clientB.sendSyncStep2();
    await new Promise(resolve => setTimeout(resolve, 500));

    // Sync again to ensure both have full state
    clientA.sendSyncStep1();
    clientB.sendSyncStep1();
    await new Promise(resolve => setTimeout(resolve, 300));

    // Both should see both stickies
    const snapA = clientA.getSnapshot();
    const snapB = clientB.getSnapshot();
    expect(snapA.length).toBe(2);
    expect(snapB.length).toBe(2);

    // Identical snapshots (sorted by z,id so order is deterministic)
    expect(JSON.stringify(snapA)).toBe(JSON.stringify(snapB));

    clientA.close();
    clientB.close();
  });
});
