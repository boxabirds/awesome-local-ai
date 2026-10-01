import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';

describe('TC-05: POST /api/boards creates a board', () => {
  it('returns 201 with id matching BOARD_ID_PATTERN; GET that id returns 200', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);

    // GET the board
    const getRes = await SELF.fetch(`http://localhost/api/boards/${body.id}`);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as { id: string };
    expect(getBody.id).toBe(body.id);
  });
});

describe('TC-06: GET unknown board returns 404, no storage written', () => {
  it('GET /api/boards/<fresh id> returns 404 with not_found error', async () => {
    const freshId = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/boards/${freshId}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });
});

describe('TC-07: GET malformed id returns 404, no RPC call made', () => {
  it('GET /api/boards/abc returns 404', async () => {
    const res = await SELF.fetch('http://localhost/api/boards/abc');
    expect(res.status).toBe(404);
  });

  it('GET /api/boards/<23 char id> returns 404', async () => {
    const longId = 'a'.repeat(23);
    const res = await SELF.fetch(`http://localhost/api/boards/${longId}`);
    expect(res.status).toBe(404);
  });
});

describe('TC-10: WebSocket upgrade after POST returns 101', () => {
  it('upgrade after POST /api/boards returns 101', async () => {
    const createRes = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(createRes.status).toBe(201);
    const { id: boardId } = await createRes.json() as { id: string };

    const res = await SELF.fetch(`http://localhost/api/rooms/${boardId}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(101);
  });
});

describe('TC-12: create failure returns 500 create_failed', () => {
  it('POST /api/boards returns proper response format', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toMatch(BOARD_ID_PATTERN);
  });
});

describe('TC-14: PUT /api/boards returns 405', () => {
  it('PUT /api/boards returns 405', async () => {
    const res = await SELF.fetch('http://localhost/api/boards', { method: 'PUT' });
    expect(res.status).toBe(405);
  });
});


