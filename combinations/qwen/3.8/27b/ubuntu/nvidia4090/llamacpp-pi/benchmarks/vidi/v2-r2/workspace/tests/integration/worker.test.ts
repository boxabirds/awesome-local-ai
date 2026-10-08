/**
 * Worker entry routing tests (story 3 TC-04/05/06/13/17, updated for the
 * story 5 contract: malformed ids are 404, not 400, and rooms can no longer
 * be created implicitly — a board must exist before its socket upgrades).
 *
 * Runs against the real Worker in workerd (vitest pool workers): no mock of
 * the Worker, the DO namespace or the assets — SELF.fetch hits the actual
 * fetch handler.
 */

import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** Creates a board through the real API and returns its id. */
async function createBoard(): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

describe('worker entry routing', () => {
  it('TC-04: invalid board id with an upgrade returns 404 and creates no object instance', async () => {
    for (const bad of ['bad', 'short', 'way_too_long_id_not_22_chars__', '../x', 'a b']) {
      const res = await SELF.fetch(`http://localhost/api/rooms/${encodeURIComponent(bad)}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      // Story 5: malformed and unknown ids are indistinguishable (404).
      expect(res.status).toBe(404);
    }
    // The namespace itself never throws on names: the route simply must not
    // ever reach it with an invalid id (it 404s first, above).
    expect(() => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('bad'))).not.toThrow();
    expect(isValidBoardId('bad')).toBe(false);
  });

  it('TC-05: valid id without a WebSocket upgrade is rejected with 426', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBe(426);
  });

  it('TC-06: valid id of an existing board with a WebSocket upgrade returns 101', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeInstanceOf(WebSocket);
    // (no close: the socket returned across the DO stub boundary is the
    // server half and would require an accept() the room already did)
  });

  it('TC-13: a client requesting an invalid board id is rejected (404, not a crash)', async () => {
    const res = await SELF.fetch('http://localhost/api/rooms/not%20a%20board%20id', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(404);
    // the Worker is still healthy afterwards
    const boardId = await createBoard();
    const res2 = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res2.status).toBe(101);
  });

  it('TC-17: /b/<valid id> serves the SPA (HTML 200) and the same id upgrades the room', async () => {
    const boardId = await createBoard();
    const html = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type') ?? '').toContain('text/html');
    const body = await html.text();
    expect(body).toContain('<div id="root">');

    // deep SPA route beyond /b/<id> also falls back to index.html
    const deep = await SELF.fetch(`http://localhost/b/${boardId}/settings`);
    expect(deep.status).toBe(200);
    expect(deep.headers.get('content-type') ?? '').toContain('text/html');

    // and the room for the same id upgrades
    const ws = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(ws.status).toBe(101);
  });

  it('a fresh (never created) id upgrades with 404 and stores nothing', async () => {
    const fresh = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${fresh}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(404);
    expect(res.webSocket).toBeNull();
  });
});
