import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';

const UPGRADE_HEADERS = { Upgrade: 'websocket', Connection: 'Upgrade' };

/**
 * Worker routing exercised in-process against the real worker in workerd
 * (no mocks). These are the non-WebSocket routes; the live-upgrade path is
 * covered by the wrangler-dev backed suite (ws-room.test.ts) because this
 * workerd build cannot complete an in-process 101 upgrade.
 */
describe('worker routing (integration)', () => {
  it('TC-04: GET /api/rooms/<invalid id> with Upgrade → 400 before the DO is involved', async () => {
    const res = await SELF.fetch('http://localhost/api/rooms/not-a-valid-id!', {
      headers: UPGRADE_HEADERS,
    });
    expect(res.status).toBe(400);
    expect(res.webSocket ?? null).toBeNull();
  }, 15000);

  it('TC-05: GET /api/rooms/<valid id> without Upgrade → 426', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`);
    expect(res.status).toBe(426);
  }, 15000);

  it('TC-06: GET /b/<valid id> → 200 index.html (SPA fallback)', async () => {
    const boardId = newBoardId();
    const res = await SELF.fetch(`http://localhost/b/${boardId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<div id="root">');
  }, 15000);
});
