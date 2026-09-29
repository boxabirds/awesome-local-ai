// Story 12, task 1: asset API integration tests (workerd pool, TC-10..TC-16).
//
// These run the real worker (POST /api/boards/:id/assets and
// GET /api/assets/:boardId/:assetId) against a real R2 bucket and real
// BoardRoom namespace materialised from wrangler.jsonc, so the type sniffing,
// board-exists gate, size limit, key shape, cache headers and per-visitor rate
// limit are all exercised end to end.

import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
} from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import worker from '../../src/worker/index';
import { handleServe, type AssetsEnv } from '../../src/worker/assets';

// Leading bytes are what the worker sniffs on; the trailing bytes are served
// back verbatim so the serve tests can assert byte equality.
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x44, 0x45, 0x41, 0x44,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xaa, 0xbb]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const SVG = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c]);

const boardAssets = (boardId: string): string => `http://localhost/api/boards/${boardId}/assets`;
const assetUrl = (key: string): string => `http://localhost/api/assets/${key}`;

// Create a board (the upload route requires the board to exist).
async function makeBoard(ip: string): Promise<string> {
  const res = await SELF.fetch('http://localhost/api/boards', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': ip },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function upload(
  boardId: string,
  body: Uint8Array,
  opts: { ip?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.ip !== undefined) headers['CF-Connecting-IP'] = opts.ip;
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return SELF.fetch(boardAssets(boardId), {
    method: 'POST',
    body,
    headers,
  });
}

describe('asset API (story 12, assets.api)', () => {
  it('TC-10: POST a real PNG to an existing board → 201, key matches the pattern, object stored', async () => {
    const boardId = await makeBoard('10.40.0.10');
    const res = await upload(boardId, PNG);
    expect(res.status).toBe(201);
    const { assetKey, contentType } = (await res.json()) as {
      assetKey: string;
      contentType: string;
    };
    expect(assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(contentType).toBe('image/png');
    // The R2 object exists with the stored content type.
    const obj = await (env as { ASSETS_BUCKET: { get: (k: string) => Promise<{ httpMetadata?: { contentType?: string } } | null> } }).ASSETS_BUCKET.get(assetKey);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: POST to a never-created board or a malformed id → 404, nothing stored', async () => {
    const never = newBoardId(); // valid shape, never created
    const res = await upload(never, PNG, { ip: '10.40.0.11' });
    expect(res.status).toBe(404);
    expect((await res.json()) as unknown).toEqual({ error: 'not_found' });
    // Malformed board id (wrong shape) is 404 at the route, before any storage.
    const malformed = await SELF.fetch(boardAssets('nope'), { method: 'POST', body: PNG });
    expect(malformed.status).toBe(404);
  });

  it('TC-12: an oversized body is 413 (nothing stored); exactly IMAGE_MAX_BYTES is 201', async () => {
    const boardId = await makeBoard('10.40.0.12');
    const oversized = new Uint8Array(IMAGE_MAX_BYTES + 1);
    // JPEG signature so the type is valid but the size is over.
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;
    const over = await upload(boardId, oversized);
    expect(over.status).toBe(413);

    const atLimit = new Uint8Array(IMAGE_MAX_BYTES);
    atLimit[0] = 0xff;
    atLimit[1] = 0xd8;
    atLimit[2] = 0xff;
    const atLimitRes = await upload(boardId, atLimit);
    expect(atLimitRes.status).toBe(201);
  });

  it('TC-13: a PDF (declared image/png) and an SVG are both 415', async () => {
    const boardId = await makeBoard('10.40.0.13');
    // The declared Content-Type is image/png, but the content is a PDF.
    const pdf = await upload(boardId, PDF, { contentType: 'image/png' });
    expect(pdf.status).toBe(415);
    const svg = await upload(boardId, SVG, { contentType: 'image/svg+xml' });
    expect(svg.status).toBe(415);
  });

  it('TC-14: IMAGE_UPLOAD_LIMIT + 1 uploads from one IP → last is 429; another IP is 201', async () => {
    const boardId = await makeBoard('10.40.0.14');
    const ip = '10.40.0.140';
    for (let i = 0; i < IMAGE_UPLOAD_LIMIT; i += 1) {
      const res = await upload(boardId, PNG, { ip });
      expect(res.status, `attempt ${i + 1} of ${IMAGE_UPLOAD_LIMIT}`).toBe(201);
    }
    const blocked = await upload(boardId, PNG, { ip });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()) as unknown).toEqual({ error: 'rate_limited' });
    // A different visitor is unaffected (image.rate_limit).
    const other = await upload(boardId, PNG, { ip: '10.40.0.141' });
    expect(other.status).toBe(201);
  });

  it('TC-15: an R2 put that throws maps to 500 storage_failed', async () => {
    const boardId = await makeBoard('10.40.0.15');
    const throwing: AssetsEnv = {
      ...env,
      ASSETS_BUCKET: {
        put: async (): Promise<unknown> => {
          throw new Error('r2 down');
        },
        get: async (): Promise<null> => null,
      } as AssetsEnv['ASSETS_BUCKET'],
    } as unknown as AssetsEnv;
    const res = await worker.fetch(
      new Request(boardAssets(boardId), { method: 'POST', body: PNG }),
      throwing,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as unknown).toEqual({ error: 'storage_failed' });
  });

  it('TC-16: a stored key serves 200 with immutable cache, nosniff and CSP; missing and ../x are 404', async () => {
    const boardId = await makeBoard('10.40.0.16');
    const res = await upload(boardId, PNG);
    const { assetKey } = (await res.json()) as { assetKey: string };

    const serve = await SELF.fetch(assetUrl(assetKey));
    expect(serve.status).toBe(200);
    expect(serve.headers.get('content-type')).toBe('image/png');
    expect(serve.headers.get('cache-control')).toMatch(/immutable/);
    expect(serve.headers.get('cache-control')).toMatch(/max-age=\d{6,}/);
    expect(serve.headers.get('x-content-type-options')).toBe('nosniff');
    expect(serve.headers.get('content-security-policy')).toBe("default-src 'none'");
    const served = new Uint8Array(await serve.arrayBuffer());
    expect(served).toEqual(PNG);

    // Missing key (valid shape, never uploaded) and a path-traversal key.
    const missing = await SELF.fetch(assetUrl(assetKeyFor(newBoardId(), newBoardId())));
    expect(missing.status).toBe(404);
    const asEnv = env as unknown as AssetsEnv;
    expect((await handleServe(asEnv, '../x')).status).toBe(404);
  });
});
