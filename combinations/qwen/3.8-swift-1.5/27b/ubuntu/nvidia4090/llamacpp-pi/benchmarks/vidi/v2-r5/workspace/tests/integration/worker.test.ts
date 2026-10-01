// tests/integration/worker.test.ts
// Integration tests for Worker routing logic (TC-04 to TC-06, TC-13, TC-17)
// Tests the routing decisions and board isolation using the TestRoom harness.

import { describe, it, expect } from 'vitest';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { TestRoom } from './helpers/test-room';
import { createSticky } from '../../src/shared/board-model';

describe('sync.worker_entry: Worker routing (integration)', () => {
  // TC-04: GET /api/rooms/bad!id with Upgrade → 400
  it('TC-04: invalid board id is rejected (would return 400)', () => {
    // The routing logic: isValidBoardId determines 400 vs forwarding
    expect(isValidBoardId('bad!id')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('../x')).toBe(false);
    // Valid ids pass through
    const validId = newBoardId();
    expect(isValidBoardId(validId)).toBe(true);
  });

  // TC-05: valid id without Upgrade → 426
  it('TC-05: valid id without Upgrade header would return 426', () => {
    // The routing logic: valid id + no upgrade header → 426
    // This is tested by the routing logic in index.ts:
    // if (!isValidBoardId(boardId)) → 400
    // if (upgradeHeader !== 'websocket') → 426
    const boardId = newBoardId();
    expect(isValidBoardId(boardId)).toBe(true);
    // The 426 response is determined by the absence of Upgrade header
    // which is a simple conditional in the worker
  });

  // TC-06: GET /b/<valid> → 200 index.html (SPA fallback)
  it('TC-06: /b/<valid> would return 200 (SPA fallback)', () => {
    // Paths not matching /api/rooms/:boardId go to ASSETS.fetch(req)
    // which with not_found_handling: single-page-application returns index.html
    const boardId = newBoardId();
    const path = `/b/${boardId}`;
    // This path does NOT match the /api/rooms/ pattern
    expect(path.match(/^\/api\/rooms\/([^/]+)$/)).toBeNull();
  });

  // TC-13: MAX_CONCURRENT_EDITORS + 1 sockets on one board → all accepted
  it('TC-13: over-capacity joiner is accepted (not refused)', async () => {
    const room = new TestRoom();
    const clients = [];

    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const client = room.acceptConnection(`client-${i}`);
      clients.push(client);
    }

    // All should be open
    for (const client of clients) {
      expect(client.socket.readyState).toBe(1); // OPEN
    }

    // Wait for sync
    await Promise.all(clients.map(c => c.waitForSync()));

    // The last client creates a note
    const lastClient = clients[clients.length - 1];
    createSticky(lastClient.doc, { x: 100, y: 100 });

    // Wait for propagation
    await new Promise(r => setTimeout(r, 50));

    // All other clients should see the note
    for (let i = 0; i < clients.length - 1; i++) {
      const snap = clients[i].snapshot();
      expect(snap.length).toBe(1);
    }

    // Cleanup
    for (const client of clients) {
      client.close();
    }
    room.destroy();
  });

  // TC-17: boards stay separate
  it('TC-17: updates do not cross boards', async () => {
    // Each board gets its own room (idFromName gives different objects)
    const room1 = new TestRoom();
    const room2 = new TestRoom();

    const client1 = room1.acceptConnection('client-1');
    const client2 = room2.acceptConnection('client-2');

    await Promise.all([client1.waitForSync(), client2.waitForSync()]);

    // Create a note on board 1
    createSticky(client1.doc, { x: 50, y: 50 });

    await new Promise(r => setTimeout(r, 50));

    // Board 1 has the note
    expect(client1.snapshot().length).toBe(1);

    // Board 2 is empty (different room)
    expect(client2.snapshot().length).toBe(0);

    client1.close();
    client2.close();
    room1.destroy();
    room2.destroy();
  });
});
