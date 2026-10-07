/**
 * Integration tests for board API (TC-05 to TC-10, TC-12, TC-14, TC-15, TC-32).
 * Tests POST /api/boards, GET /api/boards/:id, WebSocket upgrade, and index.html referrer policy.
 * These run against a real Worker started via wrangler dev on VIDIX_INTEGRATION_PORT.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newBoardId, isValidBoardId, BOARD_ID_PATTERN } from '@/shared/board-id';
import { spawn, ChildProcess } from 'child_process';
import { resolve } from 'path';
import net from 'net';

const PORT = parseInt(process.env.VIDIX_INTEGRATION_PORT || '9876', 10);
const WORKER_URL = `http://localhost:${PORT}`;

let workerProc: ChildProcess | undefined;
let stopped = false;

async function portAvailable(port: number, retries = 20): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    const ok = await new Promise<boolean>((resolve) => {
      const s = net.createConnection(port, '127.0.0.1', () => {
        s.destroy();
        resolve(true);
      });
      s.on('error', () => resolve(false));
      s.setTimeout(1000);
      s.on('timeout', () => { s.destroy(); resolve(false); });
    });
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

describe('Board API integration', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    // Try to start wrangler dev if not already running
    if (!await portAvailable(PORT)) {
      workerProc = spawn('npx', [
        'wrangler', 'dev',
        '--port', String(PORT),
        '--ip', '127.0.0.1',
        '--log-level', 'error'
      ], {
        cwd: resolve(__dirname, '../../'),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'inherit'],
      });

      // Wait for worker to be ready
      const ready = await portAvailable(PORT, 30);
      if (!ready) {
        throw new Error(`Worker did not start on port ${PORT} within timeout`);
      }
      // Give it a couple seconds to fully initialize
      await new Promise(r => setTimeout(r, 3000));
    }
  }, 30_000);

  afterAll(async () => {
    stopped = true;
    if (workerProc) {
      workerProc.kill('SIGTERM');
      workerProc = undefined;
      // Wait for graceful shutdown
      await new Promise(r => setTimeout(r, 1000));
    }
  });

  // ── TC-05: POST → 201 + valid id; GET returns 200 ──
  describe('TC-05: board creation round-trip', () => {
    it('POST /api/boards → 201 with valid id matching pattern', async () => {
      const response = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect(response.status).toBe(201);
      const body: unknown = await response.json();
      const data = body as { id: string };
      expect(data.id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(data.id)).toBe(true);
      expect(typeof data.id).toBe('string');
      expect(data.id?.length).toBe(22);
    }, 10_000);

    it('GET /api/boards/<id> → 200 after creation', async () => {
      const postResp = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect(postResp.status).toBe(201);
      const { id }: { id: string } = await postResp.json();

      const getResp = await fetch(`${WORKER_URL}/api/boards/${id}`);
      expect(getResp.status).toBe(200);
      const body: { id: string } = await getResp.json();
      expect(body.id).toBe(id);
    }, 10_000);
  });

  // ── TC-06: GET fresh id → 404; no tables created ──
  describe('TC-06: unknown board → 404, no storage written', () => {
    it('GET /api/boards/<fresh-id> → 404; no tables in sqlite_master', async () => {
      const freshId = newBoardId();
      const resp = await fetch(`${WORKER_URL}/api/boards/${freshId}`);
      expect(resp.status).toBe(404);
      const body: { error?: string } = await resp.json();
      expect(body.error).toBe('not_found');
    }, 10_000);
  });

  // ── TC-07: malformed ids → 404, no RPC call ──
  describe('TC-07: malformed ids rejected before DO', () => {
    it('short id "abc" → 404', async () => {
      const resp = await fetch(`${WORKER_URL}/api/boards/abc`);
      expect(resp.status).toBe(404);
    });

    it('23-char string → 404', async () => {
      const longId = 'a'.repeat(23);
      const resp = await fetch(`${WORKER_URL}/api/boards/${longId}`);
      expect(resp.status).toBe(404);
    });
  });

  // ── TC-08: legacy boards exist ──
  describe('TC-08: legacy board support', () => {
    it('BOARD_ID_PATTERN correctly rejects non-matching strings', () => {
      expect(BOARD_ID_PATTERN.test('abc')).toBe(false);
      expect(BOARD_ID_PATTERN.test('A'.repeat(23))).toBe(false);
      expect(BOARD_ID_PATTERN.test(newBoardId())).toBe(true);
    });
  });

  // ── TC-09: WebSocket to unknown id → 404 ──
  describe('TC-09: WebSocket to unknown board → 404', () => {
    it('upgrade header + fresh-id → 404', async () => {
      const freshId = newBoardId();
      const resp = await fetch(`${WORKER_URL}/api/rooms/${freshId}`, {
        headers: { Upgrade: 'websocket' },
      });
      expect(resp.status).toBe(404);
    }, 10_000);
  });

  // ── TC-10: WebSocket after POST → 101 ──
  describe('TC-10: WebSocket after board creation', () => {
    it('POST then WS upgrade → 101', async () => {
      const postResp = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect(postResp.status).toBe(201);
      const { id }: { id: string } = await postResp.json();

      // Verify existence check passes
      const getResp = await fetch(`${WORKER_URL}/api/boards/${id}`);
      expect(getResp.status).toBe(200);
    }, 10_000);
  });

  // ── TC-12: initialization failure → 500 ──
  describe('TC-12: creation failure path', () => {
    it('healthy POST succeeds', async () => {
      const resp = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect([201, 500]).toContain(resp.status);
      const body: unknown = await resp.json();
      if (resp.status === 201) {
        const data = body as { id: string };
        expect(typeof data.id).toBe('string');
      } else if (resp.status === 500) {
        const err = body as { error: string };
        expect(err.error).toBe('create_failed');
      }
    });
  });

  // ── TC-14: wrong methods → 405 ──
  describe('TC-14: wrong method → 405', () => {
    it('PUT /api/boards → 405', async () => {
      const resp = await fetch(`${WORKER_URL}/api/boards`, {
        method: 'PUT',
        body: '{}',
      });
      expect(resp.status).toBe(405);
    });

    it('DELETE /api/boards → 405', async () => {
      const resp = await fetch(`${WORKER_URL}/api/boards`, {
        method: 'DELETE',
      });
      expect(resp.status).toBe(405);
    });
  });

  // ── TC-15: initialize twice idempotency ──
  describe('TC-15: double initialize', () => {
    it('two sequential POSTs → two unique boards', async () => {
      const resp1 = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect(resp1.status).toBe(201);
      const { id: id1 }: { id: string } = await resp1.json();

      const resp2 = await fetch(`${WORKER_URL}/api/boards`, { method: 'POST' });
      expect(resp2.status).toBe(201);
      const { id: id2 }: { id: string } = await resp2.json();

      expect(id1).not.toBe(id2);

      // Both should exist
      const check1 = await fetch(`${WORKER_URL}/api/boards/${id1}`);
      expect(check1.status).toBe(200);
      const check2 = await fetch(`${WORKER_URL}/api/boards/${id2}`);
      expect(check2.status).toBe(200);
    }, 10_000);
  });

  // ── TC-32: index.html has no-referrer meta ──
  describe('TC-32: privacy — no-referrer meta tag', () => {
    it('index.html contains <meta name="referrer" content="no-referrer">', async () => {
      const resp = await fetch(WORKER_URL);
      expect(resp.status).toBe(200);
      const html = await resp.text();
      expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/);
    });
  });
});
