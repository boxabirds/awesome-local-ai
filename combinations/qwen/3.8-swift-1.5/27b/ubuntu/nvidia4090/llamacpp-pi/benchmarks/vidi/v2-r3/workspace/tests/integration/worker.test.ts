import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';

describe('TC-04: invalid board id returns 400', () => {
  it('GET /api/rooms/bad!id with Upgrade returns 400', async () => {
    const req = new Request('http://x/api/rooms/bad!id', {
      headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade' },
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(400);
  });
});

describe('TC-05: valid id without Upgrade returns 426', () => {
  it('GET /api/rooms/<valid> without Upgrade returns 426', async () => {
    const boardId = newBoardId();
    const req = new Request(`http://x/api/rooms/${boardId}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(426);
  });
});

describe('TC-06: SPA fallback', () => {
  it('GET /b/<valid> returns 200', async () => {
    const boardId = newBoardId();
    const req = new Request(`http://x/b/${boardId}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
  });
});
