/**
 * Integration tests for the asset API (story 12, assets.api). TC-10 to TC-16.
 *
 * These run against the real Miniflare R2 bucket and the real story 5
 * `exists()` Durable Object RPC, driven through `SELF.fetch` so the HTTP routing
 * in `index.ts` is covered too.
 *
 * Rate limiting uses the real `ASSET_UPLOAD_LIMITER` binding (the local workerd
 * runtime supports `ratelimits`). Because the integration project shares one
 * worker across files, every test asks for its own `CF-Connecting-IP` so budgets
 * cannot interfere.
 */
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
  ASSET_CACHE_MAX_AGE_SECONDS,
} from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import type { Env } from '../../src/worker/index';
import { handleServe, handleUpload } from '../../src/worker/assets';
import { gifBytes, jpegBytes, pdfBytes, pngBytes, svgBytes, webpBytes } from '../fixtures/imageBytes';

const HOST = 'http://localhost';

/** Bindings for the worker under test, typed as the worker's own Env. */
const testEnv = env as unknown as Env;

/** A unique address per test: the shared worker must not mix rate-limit budgets. */
let ipCounter = 200;
function freshIp(): string {
  ipCounter += 1;
  return `10.77.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

/** Create a board through the API so uploads have somewhere legal to go. */
async function createBoard(ip = freshIp()): Promise<string> {
  const res = await SELF.fetch(
    makeRequest(`${HOST}/api/boards`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

function postAsset(boardId: string, body: Uint8Array, headers: Record<string, string> = {}) {
  return SELF.fetch(
    makeRequest(`${HOST}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': freshIp(), ...headers },
      body: body as unknown as BodyInit,
    }),
  );
}

async function listedKeys(prefix: string): Promise<string[]> {
  // The published R2 types make `keys` vs `objects` a discriminated union; local
  // Miniflare reports `keys`. Read whichever is present.
  const list = (await testEnv.ASSETS_BUCKET.list({
    prefix,
  })) as unknown as { keys?: Array<{ key: string }>; objects?: Array<{ key: string }> };
  const entries = list.keys ?? list.objects ?? [];
  return entries.map((k) => k.key);
}

// ---------------------------------------------------------------------------
// TC-10: a real PNG for an existing board is stored and reported
// ---------------------------------------------------------------------------
describe('TC-10: POST a real PNG to an existing board', () => {
  it('returns 201 with a pattern-matching key and stores the bytes in R2', async () => {
    const boardId = await createBoard();
    const bytes = pngBytes(16, 12);

    const res = await postAsset(boardId, bytes);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const stored = await testEnv.ASSETS_BUCKET.get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
  });

  it('accepts JPEG, GIF and WebP too', async () => {
    const boardId = await createBoard();
    const cases: Array<[Uint8Array, string]> = [
      [jpegBytes(), 'image/jpeg'],
      [gifBytes('GIF89a'), 'image/gif'],
      [webpBytes(), 'image/webp'],
    ];
    for (const [bytes, contentType] of cases) {
      const res = await postAsset(boardId, bytes);
      expect(res.status).toBe(201);
      const body = (await res.json()) as { assetKey: string; contentType: string };
      expect(body.contentType).toBe(contentType);
      expect(await listedKeys(`${boardId}/`)).toContain(body.assetKey);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-11: uploads to boards that do not exist are refused and store nothing
// ---------------------------------------------------------------------------
describe('TC-11: POST to an unknown or malformed board id', () => {
  it('returns 404 for a valid but never-created board and stores nothing', async () => {
    const boardId = newBoardId();
    const res = await postAsset(boardId, pngBytes(4, 4));
    expect(res.status).toBe(404);
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });

  it('returns 404 for malformed board ids', async () => {
    // Ids containing dots are not testable here: the URL parser normalises `..`
    // and `%2e%2e` path segments away before the worker sees them.
    for (const id of ['abc', 'A'.repeat(23), 'nope_nope_nope_nope_nope']) {
      const res = await postAsset(id, pngBytes(4, 4));
      expect(res.status).toBe(404);
    }
  });

  it('returns 405 for GET on the upload route', async () => {
    const boardId = await createBoard();
    const res = await SELF.fetch(makeRequest(`${HOST}/api/boards/${boardId}/assets`));
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// TC-12: the 10 MB boundary
// ---------------------------------------------------------------------------
describe('TC-12: size limit boundary', () => {
  it('rejects IMAGE_MAX_BYTES + 1 with 413 and stores nothing', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, jpegBytes(IMAGE_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('too_large');
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });

  it('accepts exactly IMAGE_MAX_BYTES', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, jpegBytes(IMAGE_MAX_BYTES));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    const stored = await testEnv.ASSETS_BUCKET.get(body.assetKey);
    expect(stored?.size).toBe(IMAGE_MAX_BYTES);
  });
});

// ---------------------------------------------------------------------------
// TC-13: the content decides the type, never the file name or header
// ---------------------------------------------------------------------------
describe('TC-13: disguised and script-bearing files', () => {
  it('rejects a PDF sent as image/png with 415 and stores nothing', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, pdfBytes(), { 'Content-Type': 'image/png' });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('unsupported_type');
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });

  it('rejects an SVG with 415 and stores nothing', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, svgBytes(), { 'Content-Type': 'image/svg+xml' });
    expect(res.status).toBe(415);
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });

  it('rejects an empty body', async () => {
    const boardId = await createBoard();
    const res = await postAsset(boardId, new Uint8Array(0));
    expect(res.status).toBe(415);
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TC-14: the upload budget
// ---------------------------------------------------------------------------
describe('TC-14: rate limit per visitor', () => {
  it(`allows ${IMAGE_UPLOAD_LIMIT} uploads then returns 429; another visitor still gets 201`, async () => {
    const boardId = await createBoard();
    const ip = freshIp();
    const bytes = pngBytes(2, 2);

    for (let i = 0; i < IMAGE_UPLOAD_LIMIT; i++) {
      const res = await postAsset(boardId, bytes, { 'CF-Connecting-IP': ip });
      expect(res.status, `upload ${i + 1}`).toBe(201);
    }

    const blocked = await postAsset(boardId, bytes, { 'CF-Connecting-IP': ip });
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
    expect(await listedKeys(`${boardId}/`)).toHaveLength(IMAGE_UPLOAD_LIMIT);

    const other = await postAsset(boardId, bytes);
    expect(other.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// TC-15: storage failure is reported, not swallowed
// ---------------------------------------------------------------------------
describe('TC-15: R2 put failure', () => {
  it('returns 500 when the bucket throws', async () => {
    const boardId = await createBoard();
    const brokenBucket = {
      put: async () => {
        throw new Error('bucket unavailable');
      },
      get: async () => null,
      list: async () => ({ keys: [], truncated: false }),
      delete: async () => undefined,
    } as unknown as R2Bucket;

    const brokenEnv = {
      BOARD_ROOM: testEnv.BOARD_ROOM,
      ASSETS: testEnv.ASSETS,
      BOARD_CREATE_LIMITER: testEnv.BOARD_CREATE_LIMITER,
      ASSET_UPLOAD_LIMITER: testEnv.ASSET_UPLOAD_LIMITER,
      ASSETS_BUCKET: brokenBucket,
    } as unknown as Env;

    const request = new Request(`${HOST}/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': freshIp() },
      body: pngBytes(4, 4) as unknown as BodyInit,
    });
    const res = await handleUpload(request, brokenEnv, boardId);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('storage_failure');
    // Nothing was stored under this board by the failed attempt.
    expect(await listedKeys(`${boardId}/`)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TC-16: serving is immutable and never executable
// ---------------------------------------------------------------------------
describe('TC-16: GET /api/assets/:boardId/:assetId', () => {
  it('serves the stored bytes with immutable caching and no-sniff headers', async () => {
    const boardId = await createBoard();
    const bytes = pngBytes(6, 6);
    const upload = await postAsset(boardId, bytes);
    const { assetKey } = (await upload.json()) as { assetKey: string };

    const res = await SELF.fetch(makeRequest(`${HOST}/api/assets/${assetKey}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('returns 404 for a well-formed key that was never stored', async () => {
    const res = await SELF.fetch(makeRequest(`${HOST}/api/assets/${newBoardId()}/${newBoardId()}`));
    expect(res.status).toBe(404);
  });

  it('returns 404 for traversal attempts', async () => {
    // Encoded slashes survive URL parsing, so the request reaches the handler and
    // the key pattern is what refuses it.
    const encoded = await SELF.fetch(makeRequest(`${HOST}/api/assets/..%2f..%2fetc%2fpasswd`));
    expect(encoded.status).toBe(404);

    expect((await handleServe(testEnv, '../x')).status).toBe(404);
    expect((await handleServe(testEnv, `${newBoardId()}/../../secret`)).status).toBe(404);
    expect((await handleServe(testEnv, 'short/asset')).status).toBe(404);
  });

  it('returns 404 for a key with the wrong number of parts', async () => {
    const res = await SELF.fetch(makeRequest(`${HOST}/api/assets/${newBoardId()}`));
    expect(res.status).toBe(404);
  });

  it('refuses to serve a stored object whose metadata is not an accepted image type', async () => {
    const boardId = await createBoard();
    const key = `${boardId}/${newBoardId()}`;
    await testEnv.ASSETS_BUCKET.put(key, svgBytes(), {
      httpMetadata: { contentType: 'image/svg+xml' },
    });
    const res = await SELF.fetch(makeRequest(`${HOST}/api/assets/${key}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });
});
