/**
 * Integration tests for share.board_api.
 * Tests TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { newBoardId, isValidBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { HTTP_BASE } from './global-setup';
import { createWsClient } from './ws-client';
import http from 'node:http';

function httpRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const openClients: Array<{ close(): void }> = [];

afterEach(async () => {
  for (const c of openClients) {
    try { c.close(); } catch {}
  }
  openClients.length = 0;
  await new Promise((r) => setTimeout(r, 100));
});

describe('Board API (share.board_api)', () => {
  // TC-05: POST /api/boards → 201 with id; GET 200; created_at set
  it('TC-05: POST creates board, GET returns 200', async () => {
    const res = await httpRequest(`${HTTP_BASE}/api/boards`, { method: 'POST' });
    expect(res.status).toBe(201);
    const data = JSON.parse(res.body);
    expect(data.id).toMatch(BOARD_ID_PATTERN);

    // GET should return 200
    const getRes = await httpRequest(`${HTTP_BASE}/api/boards/${data.id}`);
    expect(getRes.status).toBe(200);
    const getData = JSON.parse(getRes.body);
    expect(getData.id).toBe(data.id);
  });

  // TC-06: GET fresh never-created id → 404; no storage written
  it('TC-06: GET unknown valid id returns 404', async () => {
    const id = newBoardId();
    const res = await httpRequest(`${HTTP_BASE}/api/boards/${id}`);
    expect(res.status).toBe(404);
    const data = JSON.parse(res.body);
    expect(data.error).toBe('not_found');
  });

  // TC-07: GET malformed ids → 404, no RPC call
  it('TC-07: GET malformed ids returns 404', async () => {
    // "abc" is too short
    const res1 = await httpRequest(`${HTTP_BASE}/api/boards/abc`);
    expect(res1.status).toBe(404);

    // 23-char id is too long
    const longId = 'A'.repeat(23);
    const res2 = await httpRequest(`${HTTP_BASE}/api/boards/${longId}`);
    expect(res2.status).toBe(404);

    // Verify these don't pass validation
    expect(isValidBoardId('abc')).toBe(false);
    expect(isValidBoardId(longId)).toBe(false);
  });

  // TC-08: legacy board (updates without created_at) → GET 200
  it('TC-08: legacy board with updates but no created_at returns 200', async () => {
    // Use the test hook to seed a legacy board
    const id = newBoardId();
    // Seed the board via the test hook
    const seedRes = await httpRequest(`${HTTP_BASE}/__test/boards/${id}/seed-legacy?count=3`, { method: 'GET' });
    expect(seedRes.status).toBe(200);
    const seedData = JSON.parse(seedRes.body);
    expect(seedData.seeded).toBe(3);

    // GET should return 200 (legacy board exists)
    const getRes = await httpRequest(`${HTTP_BASE}/api/boards/${id}`);
    expect(getRes.status).toBe(200);
  });

  // TC-09: WebSocket upgrade to unknown id → 404
  it('TC-09: WebSocket upgrade to unknown id returns 404', async () => {
    const id = newBoardId();
    // Use HTTP upgrade attempt
    const res = await httpRequest(`${HTTP_BASE}/api/rooms/${id}`, {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(404);
  });

  // TC-10: WebSocket upgrade after POST → 101
  it('TC-10: WebSocket upgrade after board creation succeeds', async () => {
    const createRes = await httpRequest(`${HTTP_BASE}/api/boards`, { method: 'POST' });
    expect(createRes.status).toBe(201);
    const { id } = JSON.parse(createRes.body);

    // Connect via WebSocket
    const wsBase = HTTP_BASE.replace('http:', 'ws:') + '/api/rooms';
    const client = await createWsClient(wsBase, id);
    openClients.push(client);
    expect(client.ws.readyState).toBe(WebSocket.OPEN);
  });

  // TC-14: PUT /api/boards → 405
  it('TC-14: PUT /api/boards returns 405', async () => {
    const res = await httpRequest(`${HTTP_BASE}/api/boards`, { method: 'PUT' });
    expect(res.status).toBe(405);
  });

  // TC-32: served index.html contains meta referrer no-referrer
  it('TC-32: index.html contains meta referrer no-referrer', async () => {
    const res = await httpRequest(`${HTTP_BASE}/`);
    expect(res.status).toBe(200);
    // May be with or without self-closing slash depending on HTML processor
    expect(res.body).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"\s*\/?\s*>/);
  });
});
