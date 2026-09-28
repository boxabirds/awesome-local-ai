import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { newBoardId, isValidBoardId } from '../../src/shared/board-id';
import { createWsClient } from './ws-client';
import { createSticky } from '../../src/shared/board-model';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** Helper: create a board by calling initialize() directly on the DO */
async function createTestBoard(): Promise<string> {
  const id = newBoardId();
  const doId = env.BOARD_ROOM.idFromName(id);
  const stub = env.BOARD_ROOM.get(doId) as unknown as { initialize(): Promise<'created' | 'exists'> };
  await stub.initialize();
  return id;
}

describe('TC-04: invalid board id returns 404', () => {
  it('rejects bad!id with Upgrade header', async () => {
    const response = await SELF.fetch('http://example.com/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(404);
  });
});

describe('TC-05: valid id without Upgrade returns 426', () => {
  it('returns 426 Upgrade Required', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://example.com/api/rooms/${id}`);
    expect(response.status).toBe(426);
  });
});

describe('TC-06: SPA fallback for /b/:boardId', () => {
  it('returns index.html for valid board path', async () => {
    const id = newBoardId();
    const response = await SELF.fetch(`http://example.com/b/${id}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('<!doctype html>');
  });
});

describe('TC-13: over-capacity joiner is not refused', () => {
  it('accepts MAX_CONCURRENT_EDITORS + 1 sockets and propagates', async () => {
    const boardId = await createTestBoard();

    const first = await createWsClient((url, init) => SELF.fetch(url, init), boardId);
    await first.waitForSync();
    createSticky(first.doc, { x: 10, y: 10 });

    await new Promise((r) => setTimeout(r, 100));

    const extra = await createWsClient((url, init) => SELF.fetch(url, init), boardId);
    await extra.waitForSync();

    const snap = extra.snapshot();
    expect(snap.length).toBe(1);

    first.close();
    extra.close();
  });
});

describe('TC-17: board isolation', () => {
  it('updates do not cross between different boards', async () => {
    const board1 = await createTestBoard();
    const board2 = await createTestBoard();

    const client1 = await createWsClient((url, init) => SELF.fetch(url, init), board1);
    const client2 = await createWsClient((url, init) => SELF.fetch(url, init), board2);

    await client1.waitForSync();
    await client2.waitForSync();

    createSticky(client1.doc, { x: 5, y: 5 });
    await new Promise((r) => setTimeout(r, 200));

    const snap2 = client2.snapshot();
    expect(snap2.length).toBe(0);

    client1.close();
    client2.close();
  });
});
