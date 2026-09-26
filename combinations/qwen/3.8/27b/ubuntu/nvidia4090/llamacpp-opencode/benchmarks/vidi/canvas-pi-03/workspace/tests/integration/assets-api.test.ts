/**
 * Story 12 — assets.api integration tests (TC-10 to TC-16). Runs against the
 * real integration `wrangler dev` server: production workerd, real Durable
 * Object (exists() RPC), real Miniflare R2 bucket, and the real routing.
 *
 * Rate limiting (TC-14): the pinned local runtime (wrangler 3.x dev) does not
 * expose the platform `ratelimits` binding, so the worker runs its in-memory
 * fixed-window limiter (IMAGE_UPLOAD_LIMIT per IMAGE_UPLOAD_PERIOD_SECONDS per
 * visitor key) — exactly what wrangler.jsonc declares for production. The
 * `x-test-visitor` header (TEST_HOOKS servers) pins the key.
 */
import { describe, it, expect } from 'vitest';
import { request as httpRequest } from 'node:http';
import { BASE_URL, INTEGRATION_PORT } from './server';
import { newBoardId } from '@/shared/board-id';
import { ASSET_KEY_PATTERN, assetKeyFor } from '@/shared/image-format';
import { IMAGE_MAX_BYTES, IMAGE_UPLOAD_LIMIT, ASSET_CACHE_MAX_AGE_SECONDS } from '@/shared/config';

// --- Tiny valid image signatures (content, not the client's Content-Type). ---
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

interface UploadResult {
  status: number;
  body: Record<string, unknown>;
}

// Each board creation uses its own rate-limit key (TEST_HOOKS x-test-visitor
// override) so the fixed-window board-create limiter (shared 'unknown' key
// otherwise) never trips across the whole integration run.
let boardSeq = 0;
async function createBoard(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/boards`, {
    method: 'POST',
    headers: { 'x-test-visitor': `assets-test-${++boardSeq}` },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function upload(
  boardId: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
  headers: Record<string, string> = {},
): Promise<UploadResult> {
  const res = await fetch(`${BASE_URL}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...headers },
    body: bytes as unknown as ArrayBuffer,
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

/** A raw GET (sends the literal path, no client-side `..` normalisation). */
function rawGet(path: string): Promise<{ status: number; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: INTEGRATION_PORT, path, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function serve(key: string): Promise<{ status: number; headers: Headers }> {
  const res = await fetch(`${BASE_URL}/api/assets/${key}`);
  await res.text();
  return { status: res.status, headers: res.headers };
}

describe('assets.api (integration)', () => {
  it('TC-10: stores a valid PNG at 201 with a well-formed assetKey and sniffed contentType', async () => {
    const boardId = await createBoard();
    const { status, body } = await upload(boardId, PNG, 'image/png');
    expect(status).toBe(201);
    const assetKey = body.assetKey as string;
    expect(assetKey).toBeDefined();
    expect(assetKey).toMatch(ASSET_KEY_PATTERN);
    // The key is namespaced by the board.
    expect(assetKey).toBe(assetKeyFor(boardId, (assetKey.split('/')[1] ?? '')));
    // The content type is sniffed from the CONTENT, not the client header.
    expect(body.contentType).toBe('image/png');
  });

  it('TC-10: stores JPEG / GIF / WebP with their sniffed types', async () => {
    const boardId = await createBoard();
    for (const [bytes, type] of [
      [JPEG, 'image/jpeg'],
      [GIF, 'image/gif'],
      [WEBP, 'image/webp'],
    ] as const) {
      const { status, body } = await upload(boardId, bytes, type);
      expect(status).toBe(201);
      expect(body.contentType).toBe(type);
    }
  });

  it('TC-11: POST to a never-created board and to a malformed id -> 404, nothing stored', async () => {
    const neverCreated = newBoardId();
    const r1 = await upload(neverCreated, PNG, 'image/png');
    expect(r1.status).toBe(404);

    const r2 = await upload('abc', PNG, 'image/png');
    expect(r2.status).toBe(404);
    expect(r2.body).toEqual({ error: 'not_found' });
  });

  it('TC-12: PNG at IMAGE_MAX_BYTES + 1 -> 413 (boundary); at the limit it stores', async () => {
    const boardId = await createBoard();
    const over = new Uint8Array(IMAGE_MAX_BYTES + 1);
    over.set(PNG, 0);
    const { status } = await upload(boardId, over, 'image/png');
    expect(status).toBe(413);

    // Exactly IMAGE_MAX_BYTES of valid PNG is within the limit -> stored.
    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit.set(PNG, 0);
    const ok = await upload(boardId, atLimit, 'image/png');
    expect(ok.status).toBe(201);
  });

  it('TC-13: SVG content sent as image/png -> 415 (content, not header); a valid type still stores', async () => {
    const boardId = await createBoard();
    const bad = await upload(boardId, SVG_BYTES, 'image/png');
    expect(bad.status).toBe(415);
    // Even with a lying .png name, the content wins.
    expect(bad.body).toEqual({ error: 'unsupported_type' });
    // A real PNG still stores (the rejection is content-based, not a ban).
    const good = await upload(boardId, PNG, 'image/png');
    expect(good.status).toBe(201);
  });

  it('TC-14: IMAGE_UPLOAD_LIMIT + 1 uploads from one visitor -> last is 429; a different visitor -> 201', async () => {
    const boardId = await createBoard();
    const key = 'rate-tester-1';
    let last = 0;
    let saw201 = 0;
    for (let i = 0; i <= IMAGE_UPLOAD_LIMIT; i++) {
      const { status } = await upload(boardId, PNG, 'image/png', { 'x-test-visitor': key });
      last = status;
      if (status === 201) saw201 += 1;
    }
    // The first IMAGE_UPLOAD_LIMIT succeed; the (limit+1)th is rate-limited.
    expect(saw201).toBe(IMAGE_UPLOAD_LIMIT);
    expect(last).toBe(429);

    // A different visitor key has its own window.
    const other = await upload(boardId, PNG, 'image/png', { 'x-test-visitor': 'rate-tester-2' });
    expect(other.status).toBe(201);
  });

  it('TC-15: R2 put failure -> 500 (test hook); no assetKey', async () => {
    const boardId = await createBoard();
    const { status, body } = await upload(boardId, PNG, 'image/png', { 'x-test-fail-asset-put': '1' });
    expect(status).toBe(500);
    expect(body.assetKey).toBeUndefined();
  });

  it('TC-16: serves a stored key (200 + headers); a missing key -> 404; a ../ key -> 404', async () => {
    const boardId = await createBoard();
    const { body } = await upload(boardId, PNG, 'image/png');
    const assetKey = body.assetKey as string;

    const got = await serve(assetKey);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(got.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(got.headers.get('cache-control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);

    // A well-formed key that was never uploaded -> 404.
    const missing = await serve(assetKeyFor(boardId, newBoardId()));
    expect(missing.status).toBe(404);

    // A traversal key -> 404. `..%2Fx` is the form that survives URL
    // normalisation (a literal `..` would be collapsed by the URL parser
    // before reaching the worker); the server-side pattern check rejects it.
    const traversal = await rawGet('/api/assets/..%2Fx');
    expect(traversal.status).toBe(404);
    // A well-formed single-segment (no board/asset split) also 404s.
    const single = await rawGet('/api/assets/not-a-key');
    expect(single.status).toBe(404);
  });
});
