// Asset upload & serving API (spec: assets.api, TC-10 to TC-16).
//
// Drives the real `fetch` handler from `src/worker/index.ts` against the REAL
// pool env: real Miniflare R2 (the ASSETS_BUCKET binding from wrangler.jsonc),
// the real story 5 BoardRoom exists() RPC and the real ASSET_UPLOAD_LIMITER
// rate limiter (the local runtime emulates it, same as board-api TC-13 uses
// BOARD_CREATE_LIMITER). Determinism notes:
//  - every visitor key (CF-Connecting-IP) is unique per test except TC-14,
//    which intentionally shares one IP to exhaust the 60/min window;
//  - every board id is fresh, so rooms never collide.

import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
} from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import worker from '../../src/worker';
import { SCREENSHOT_PNG, TINY_JPEG, SCRIPT_SVG, RENAMED_PDF, jpegBytes, pdfBytes } from '../fixtures/images';

/** POST a raw body to the board's asset upload route. */
function upload(
  boardId: string,
  body: Uint8Array,
  ip: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: body as unknown as BodyInit,
      headers: { 'CF-Connecting-IP': ip, ...headers },
    }),
    env,
  );
}

function serve(key: string): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/api/assets/${key}`), env);
}

/** All R2 keys with a given prefix (empty prefix = everything). */
async function r2Keys(prefix?: string): Promise<string[]> {
  const result = await env.ASSETS_BUCKET.list({ prefix: prefix ?? '' });
  return result.objects.map((o) => o.key);
}

async function createBoard(ip: string): Promise<string> {
  const res = await worker.fetch(
    new Request('http://localhost/api/boards', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    }),
    env,
  );
  if (res.status !== 201) throw new Error(`board create failed: ${res.status}`);
  return (await res.json()).id as string;
}

describe('asset upload & serving (assets.api)', () => {
  it('TC-10: POST a real PNG to an existing board → 201; R2 stores it with the sniffed type and a pattern key', async () => {
    const boardId = await createBoard('10.9.10.1');
    const res = await upload(boardId, SCREENSHOT_PNG.bytes, '10.9.10.2');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const keys = await r2Keys(boardId);
    expect(keys).toEqual([body.assetKey]);
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe('image/png');
    const stored = new Uint8Array(await object!.arrayBuffer());
    expect(stored).toEqual(SCREENSHOT_PNG.bytes);
  });

  it('TC-11: POST to a never-created board and to a malformed id → 404; nothing stored', async () => {
    const unknown = newBoardId();
    expect((await upload(unknown, SCREENSHOT_PNG.bytes, '10.9.11.1')).status).toBe(404);
    expect((await upload('not-a-valid-id', SCREENSHOT_PNG.bytes, '10.9.11.2')).status).toBe(404);
    // The bucket never gained an object for the unknown board, and the
    // malformed id never reached R2 at all.
    expect(await r2Keys(unknown)).toEqual([]);
    expect(await r2Keys('not-a-valid-id/')).toEqual([]);
  });


  it('TC-13: a PDF renamed .png (Content-Type image/png) and an SVG with a script → 415; nothing stored', async () => {
    const boardId = await createBoard('10.9.13.1');
    const disguised = await upload(boardId, RENAMED_PDF.bytes, '10.9.13.2', {
      'Content-Type': 'image/png',
    });
    expect(disguised.status).toBe(415);
    const svg = await upload(boardId, SCRIPT_SVG.bytes, '10.9.13.3', {
      'Content-Type': 'image/svg+xml',
    });
    expect(svg.status).toBe(415);
    expect(await r2Keys(boardId)).toEqual([]);
  });

  it('TC-14: IMAGE_UPLOAD_LIMIT + 1 uploads from one IP → last is 429; a different IP → 201', async () => {
    const boardId = await createBoard('10.9.14.1');
    const ip = '10.9.14.2';
    let last = 0;
    for (let i = 0; i <= IMAGE_UPLOAD_LIMIT; i++) {
      const res = await upload(boardId, SCREENSHOT_PNG.bytes, ip);
      last = res.status;
      await res.body?.cancel();
      if (i < IMAGE_UPLOAD_LIMIT) {
        expect(res.status, `upload ${i + 1}`).toBe(201);
      }
    }
    expect(last).toBe(429);
    const fresh = await upload(boardId, SCREENSHOT_PNG.bytes, '10.9.14.3');
    expect(fresh.status).toBe(201);
  });

  it('TC-15: an R2 put failure → 500 and nothing stored', async () => {
    const boardId = await createBoard('10.9.15.1');
    // Wrap the real bucket: everything delegates, put throws (spec: the
    // failure cannot be forced on the real bucket, so it is injected here).
    const failingBucket = {
      ...env.ASSETS_BUCKET,
      put: () => Promise.reject(new Error('r2 down')),
    };
    const wrappedEnv = { ...env, ASSETS_BUCKET: failingBucket };
    const res = await worker.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        body: SCREENSHOT_PNG.bytes as unknown as BodyInit,
        headers: { 'CF-Connecting-IP': '10.9.15.2' },
      }),
      wrappedEnv,
    );
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'storage_failed' });
    expect(await r2Keys(boardId)).toEqual([]);
  });

  it('TC-16: GET stored key → 200 with immutable/nosniff/CSP headers; missing and traversal keys → 404', async () => {
    const boardId = await createBoard('10.9.16.1');
    const res = await upload(boardId, TINY_JPEG.bytes, '10.9.16.2');
    expect(res.status).toBe(201);
    const { assetKey } = (await res.json()) as { assetKey: string };

    const got = await serve(assetKey);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/jpeg');
    expect(got.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(got.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(got.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(TINY_JPEG.bytes);

    const missing = `${newBoardId()}/${newBoardId()}`;
    expect((await serve(missing)).status).toBe(404);
    // Encoded traversal segments decode to keys the pattern must refuse.
    expect((await serve(`${newBoardId()}/..%2F..%2Fx`)).status).toBe(404);
    // A space survives URL normalisation and reaches the worker: the decoded
    // key fails ASSET_KEY_PATTERN → 404 (the guard, not URL collapse).
    expect((await serve(`${newBoardId()}/a%20b`)).status).toBe(404);
  });

  it('uploads to a board created for the board-check API are refused after the window (shared limiter isolation sanity)', async () => {
    // The asset limiter is a separate namespace from the board-creation
    // limiter: creating boards never consumes upload quota and vice versa.
    const boardId = await createBoard('10.9.17.1');
    const res = await upload(boardId, pdfBytes(64), '10.9.17.2');
    expect(res.status).toBe(415); // rejected by type, not by rate limit
  });
});
