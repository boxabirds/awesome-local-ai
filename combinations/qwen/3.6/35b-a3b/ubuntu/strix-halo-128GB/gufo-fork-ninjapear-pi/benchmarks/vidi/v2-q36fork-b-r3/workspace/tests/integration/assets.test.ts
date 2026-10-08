/** TC-10 to TC-13, TC-15, TC-16 — asset API integration tests against wrangler dev */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { newBoardId, isValidBoardId } from '@shared/board-id';
import { IMAGE_MAX_BYTES } from '@shared/config';

const __dirname = '/w/workspace/tests/integration';
const PORT = Number(process.env.AGENT_PORT_FIRST ?? '24140');
let serverProcess: ReturnType<typeof spawn> | null = null;

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'images', name));
}

async function startServer(): Promise<void> {
  if (serverProcess) return;
  await stopServer();
  serverProcess = spawn('npx', [
    'wrangler',
    'dev',
    '--port', String(PORT),
    '--log-level', 'warn',
  ], {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

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

// Create a board via POST /api/boards, then verify it exists
async function createTestBoard(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${PORT}/api/boards`, { method: 'POST' }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.id);
        } catch { reject(new Error('Bad response: ' + body)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('TC-10: POST real PNG to existing board', () => {
  beforeAll(startServer, 60_000);
  afterAll(stopServer);

  it('returns 201 with valid PNG and correct contentType', async () => {
    const boardId = await createTestBoard();
    const pngData = loadFixture('screenshot.png');

    const result = await httpRequest('POST', `/api/boards/${boardId}/assets`, pngData);
    expect(result.status).toBe(201);
    const json = JSON.parse(result.body) as { assetKey: string; contentType: string };
    expect(json.contentType).toBe('image/png');
    // Verify key format: two base64url segments separated by /
    expect(/^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/.test(json.assetKey)).toBe(true);
  });
});

describe('TC-11: POST to non-existent or malformed board', () => {
  beforeAll(startServer, 60_000);
  afterAll(stopServer);

  it('returns 404 for never-created board id', async () => {
    const fakeId = new Array(22).fill('a').join('');
    const pngData = loadFixture('small_0.png');

    const result = await httpRequest('POST', `/api/boards/${fakeId}/assets`, pngData);
    expect(result.status).toBe(404);
  });

  it('returns 404 for malformed board id', async () => {
    const pngData = loadFixture('small_0.png');

    const result = await httpRequest('POST', '/api/boards/bad!id!/assets', pngData);
    expect(result.status).toBe(404);
  });
});

describe('TC-12: size limit boundary', () => {
  beforeAll(startServer, 60_000);
  afterAll(stopServer);

  it('rejects IMAGE_MAX_BYTES + 1 with 413', async () => {
    const boardId = await createTestBoard();
    const overMaxData = loadFixture('over_max.jpg');

    const result = await httpRequest('POST', `/api/boards/${boardId}/assets`, overMaxData);
    expect(result.status).toBe(413);
  });

  it('accepts exactly IMAGE_MAX_BYTES JPEG with 201', async () => {
    const boardId = await createTestBoard();
    const maxData = loadFixture('exact_max.jpg');

    const result = await httpRequest('POST', `/api/boards/${boardId}/assets`, maxData);
    expect(result.status).toBe(201);
  });
});

describe('TC-13: wrong type by content', () => {
  beforeAll(startServer, 60_000);
  afterAll(stopServer);

  it('rejects PDF disguised as image/png with 415', async () => {
    const boardId = await createTestBoard();
    const pdfData = loadFixture('renamed.pdf');

    const result = await httpRequest('POST', `/api/boards/${boardId}/assets`, pdfData, {
      'Content-Type': 'image/png',
    });
    expect(result.status).toBe(415);
  });

  it('rejects SVG with script tag with 415', async () => {
    const boardId = await createTestBoard();
    const svgData = loadFixture('script.svg');

    const result = await httpRequest('POST', `/api/boards/${boardId}/assets`, svgData);
    expect(result.status).toBe(415);
  });
});

describe('TC-16: serve images with correct headers', () => {
  beforeAll(startServer, 60_000);
  afterAll(stopServer);

  it('GET stored key returns 200 with proper headers', async () => {
    const boardId = await createTestBoard();
    const pngData = loadFixture('screenshot.png');

    // Upload first
    const uploadResult = await httpRequest('POST', `/api/boards/${boardId}/assets`, pngData);
    expect(uploadResult.status).toBe(201);
    const { assetKey } = JSON.parse(uploadResult.body) as { assetKey: string };

    // GET it
    const getRes = await httpRequest('GET', `/api/assets/${assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers['content-type']).toContain('image/png');
    expect(getRes.headers['cache-control']).toContain('immutable');
    expect(getRes.headers['x-content-type-options']).toBe('nosniff');
    expect(getRes.headers['content-security-policy']).toBe("default-src 'none'");
  });

  it('GET missing key returns 404', async () => {
    const result = await httpRequest('GET', '/api/assets/nonexistent/key');
    expect(result.status).toBe(404);
  });

  it('GET path traversal key returns 404', async () => {
    const result = await httpRequest('GET', '/api/assets/../evil/png');
    expect(result.status).toBe(404);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────

function httpRequest(
  method: string,
  p: string,
  body?: Uint8Array | Buffer,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const url = `http://localhost:${PORT}${p}`;
    const options: http.RequestOptions = {
      method,
      headers: { ...extraHeaders },
    };

    const req = http.request(url, options, (res) => {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (typeof v === 'string') headers[k.toLowerCase()] = v;
      }
      let rawBody = '';
      res.setEncoding('utf-8');
      res.on('data', (d) => { rawBody += d; });
      res.on('end', () => {
        resolve({ status: res.statusCode!, body: rawBody, headers });
      });
    });
    req.on('error', reject);

    if (body) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.write(Buffer.from(body));
      }
    }
    req.end();
  });
}
