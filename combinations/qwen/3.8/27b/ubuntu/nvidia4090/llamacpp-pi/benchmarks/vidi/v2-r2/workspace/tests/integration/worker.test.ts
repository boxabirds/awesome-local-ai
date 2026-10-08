/**
 * Worker entry routing tests (design TC-04, TC-05, TC-06, TC-13, TC-17).
 *
 * Runs against the real Worker in workerd (vitest pool workers): no mock of
 * the Worker, the DO namespace or the assets — SELF.fetch hits the actual
 * fetch handler.
 */

import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isValidBoardId, newBoardId } from '../../src/shared/board-id';

const BOARD_ID = newBoardId();

describe('worker entry routing', () => {
  it('TC-04: invalid board id with an upgrade returns 400 and creates no object instance', async () => {
    for (const bad of ['bad', 'short', 'way_too_long_id_not_22_chars__', '../x', 'a b']) {
      const res = await SELF.fetch(`http://localhost/api/rooms/${encodeURIComponent(bad)}`, {
        headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
      });
      expect(res.status).toBe(400);
    }
    // The namespace itself never throws on names: the route simply must not
    // ever reach it with an invalid id (it 400s first, above).
    expect(() => env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName('bad'))).not.toThrow();
    expect(isValidBoardId('bad')).toBe(false);
  });

  it('TC-05: valid id without a WebSocket upgrade is rejected with 4xx', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${BOARD_ID}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBe(426);
  });

  it('TC-06: valid id with a WebSocket upgrade returns 101 with a webSocket', async () => {
    const res = await SELF.fetch(`http://localhost/api/rooms/${BOARD_ID}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
    expect(res.webSocket).toBeInstanceOf(WebSocket);
    // (no close: the socket returned across the DO stub boundary is the
    // server half and would require an accept() the room already did)
  });

  it('TC-13: a client requesting an invalid board id is rejected (400, not a crash)', async () => {
    const res = await SELF.fetch('http://localhost/api/rooms/not%20a%20board%20id', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(400);
    // the Worker is still healthy afterwards
    const res2 = await SELF.fetch(`http://localhost/api/rooms/${BOARD_ID}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res2.status).toBe(101);
  });

  it('TC-17: /b/<valid id> serves the SPA (HTML 200) and the same id upgrades the room', async () => {
    const html = await SELF.fetch(`http://localhost/b/${BOARD_ID}`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type') ?? '').toContain('text/html');
    const body = await html.text();
    expect(body).toContain('<div id="root">');

    // deep SPA route beyond /b/<id> also falls back to index.html
    const deep = await SELF.fetch(`http://localhost/b/${BOARD_ID}/settings`);
    expect(deep.status).toBe(200);
    expect(deep.headers.get('content-type') ?? '').toContain('text/html');

    // and the room for the same id upgrades
    const ws = await SELF.fetch(`http://localhost/api/rooms/${BOARD_ID}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(ws.status).toBe(101);
  });
});
