/** Integration tests for Worker routing (TC-04 to TC-06) */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { newBoardId } from '@shared/board-id';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 24125;
let serverProcess: ReturnType<typeof spawn> | null = null;

async function startServer(): Promise<void> {
  if (serverProcess) return;
  await stopServer();
  serverProcess = spawn('npx', [
    'wrangler',
    'dev',
    '--port', String(PORT),
    '--log-level', 'warn',
  ], {
    cwd: path.resolve(__dirname, '../..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  // Wait for server by polling
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const ok = await new Promise<boolean>((resolve) => {
      http.get(`http://localhost:${PORT}/`, (res) => {
        res.destroy();
        resolve(res.statusCode === 200);
      }).on('error', () => resolve(false));
    });
    if (ok) return;
  }
  throw new Error('Server failed to start within 15 seconds');
}

async function stopServer(): Promise<void> {
  if (serverProcess) {
    try { process.kill(serverProcess.pid!, 'SIGTERM'); } catch {}
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(serverProcess.pid!, 'SIGKILL'); } catch {}
    serverProcess = null;
  }
}

function httpRequest(method: string, p: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.request({
      hostname: '127.0.0.1',
      port: PORT,
      method,
      path: p,
      headers,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    }).on('error', reject).end();
  });
}

describe('Worker routing (TC-04 to TC-06)', async () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  afterEach(async () => {
    // Restart between tests so each gets a fresh DO instance
    await stopServer();
    await startServer();
  });

  // TC-04: GET /api/rooms/bad!id → 400 (invalid board id rejected early)
  it('TC-04: invalid board id returns 400', async () => {
    const { status } = await httpRequest('GET', '/api/rooms/bad!id');
    expect(status).toBe(400);
  });

  // TC-05: valid id without Upgrade header → 426
  it('TC-05: valid id without Upgrade header returns 426', async () => {
    const boardId = newBoardId();
    const { status } = await httpRequest('GET', `/api/rooms/${boardId}`);
    expect(status).toBe(426);
  });

  // TC-06: GET /b/<valid> → 200 (SPA fallback serves something)
  it('TC-06: GET /b/<valid-board-id> returns 200', async () => {
    const boardId = newBoardId();
    const { status } = await httpRequest('GET', `/b/${boardId}`);
    expect(status).toBe(200);
  });
});
