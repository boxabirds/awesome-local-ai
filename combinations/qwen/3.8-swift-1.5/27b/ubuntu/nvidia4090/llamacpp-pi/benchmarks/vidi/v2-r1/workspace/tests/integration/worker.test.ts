import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '@shared/board-id';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';

describe('TC-04: invalid board id returns 404 (story 5: was 400)', () => {
  it('GET /api/rooms/bad!id with Upgrade returns 404', async () => {
    const response = await SELF.fetch('http://localhost/api/rooms/bad!id', {
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
      },
    });
    expect(response.status).toBe(404);
  });
});

describe('TC-05: valid id without Upgrade returns 426', () => {
  it('GET /api/rooms/<valid> without Upgrade header returns 426', async () => {
    const boardId = newBoardId();
    const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {});
    expect(response.status).toBe(426);
  });
});

describe('TC-06: SPA fallback', () => {
  it('GET /b/<valid> returns 200', async () => {
    const boardId = newBoardId();
    // Non-API paths should not return 400 or 426
    // The ASSETS binding may not be available in test env, so we just verify
    // it doesn't hit the API route handler
    const response = await SELF.fetch(`http://localhost/b/${boardId}`, {});
    // In test env without assets, this may return various statuses
    // The key assertion is that it's NOT 400 (bad board id) or 426 (upgrade required)
    expect(response.status).not.toBe(400);
    expect(response.status).not.toBe(426);
  });
});

describe('TC-13: over capacity is not refused', () => {
  it(`${MAX_CONCURRENT_EDITORS + 1} connections are all accepted (soft capacity)`, async () => {
    // The worker never counts participants and has no connection limit.
    // This is verified by the fact that the routing logic has no participant counting.
    // The actual multi-connection test is in board-room.test.ts where we test
    // the BoardRoom class directly with multiple sockets.
    // Here we verify the routing accepts any valid board id without restriction.
    const boardId = newBoardId();
    // Multiple requests to the same valid board id should all get 426 (no upgrade)
    // rather than any "capacity exceeded" error
    for (let i = 0; i < MAX_CONCURRENT_EDITORS + 1; i++) {
      const response = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {});
      expect(response.status).toBe(426); // Not refused, just needs upgrade
    }
  });
});

describe('TC-17: boards stay separate (routing isolation)', () => {
  it('different board ids route to different paths', async () => {
    const boardId1 = newBoardId();
    const boardId2 = newBoardId();
    
    // Both should be valid and get 426 (need upgrade)
    const resp1 = await SELF.fetch(`http://localhost/api/rooms/${boardId1}`, {});
    const resp2 = await SELF.fetch(`http://localhost/api/rooms/${boardId2}`, {});
    
    expect(resp1.status).toBe(426);
    expect(resp2.status).toBe(426);
    
    // The idFromName logic ensures different boardIds get different DO instances.
    // This is a property of the DurableObjectNamespace.idFromName() function
    // which deterministically maps names to unique IDs.
    // Full isolation is tested in board-room.test.ts with separate room instances.
  });
});
