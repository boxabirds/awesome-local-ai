import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';

describe('TC-04: Invalid board id returns 404', () => {
  it('GET /api/rooms/bad!id with Upgrade → 404', async () => {
    const request = new Request('http://localhost/api/rooms/bad!id', {
      headers: { 'Upgrade': 'websocket', 'Connection': 'Upgrade' },
    });
    const response = await SELF.fetch(request);
    expect(response.status).toBe(404);
  });
});

describe('TC-05: Valid id without Upgrade returns 426', () => {
  it('GET /api/rooms/<valid> without Upgrade → 426', async () => {
    const boardId = newBoardId();
    const request = new Request(`http://localhost/api/rooms/${boardId}`);
    const response = await SELF.fetch(request);
    expect(response.status).toBe(426);
  });
});

describe('TC-06: SPA fallback for /b/<valid>', () => {
  it('GET /b/<valid> → 200 index.html', async () => {
    const boardId = newBoardId();
    const request = new Request(`http://localhost/b/${boardId}`);
    const response = await SELF.fetch(request);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('<html');
  });
});
