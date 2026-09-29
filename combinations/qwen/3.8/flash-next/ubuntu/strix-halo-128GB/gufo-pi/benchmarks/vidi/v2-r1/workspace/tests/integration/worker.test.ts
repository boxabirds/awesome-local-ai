import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

import { newBoardId } from '../../src/shared/board-id';

describe('Worker routing', () => {
  // TC-04 (story 3): invalid board id → 404 (was 400 before story 5)
  it('returns 404 for invalid board id with Upgrade header', async () => {
    const req = new Request('http://localhost/api/rooms/bad!id', {
      headers: { Upgrade: 'websocket' },
    });
    const res = await SELF.fetch(req);
    expect(res.status).toBe(404);
  });

  // TC-05 (story 3): valid id without Upgrade → 426
  it('returns 426 for valid board id without Upgrade header', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/api/rooms/${id}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(426);
  });

  // TC-06 (story 3): /b/<valid> → 200 (SPA fallback)
  it('returns 200 for /b/<valid> path (SPA fallback)', async () => {
    const id = newBoardId();
    const req = new Request(`http://localhost/b/${id}`);
    const res = await SELF.fetch(req);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!');
  });
});
