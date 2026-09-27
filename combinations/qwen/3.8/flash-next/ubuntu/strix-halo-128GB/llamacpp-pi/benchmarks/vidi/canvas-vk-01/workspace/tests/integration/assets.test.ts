import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';

import {
  IMAGE_MAX_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from '../../src/shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor } from '../../src/shared/image-format';
import { newBoardId } from '../../src/shared/board-id';
import type { Env } from '../../src/worker/env';
import { handleServe, handleUpload } from '../../src/worker/assets';
import {
  gif89aBytes,
  jpegBytes,
  junkBytes,
  pdfBytes,
  pngBytes,
  svgScriptBytes,
  webpBytes,
} from '../fixtures/image-bytes';

/**
 * The asset API (story 12, TC-10 to TC-16): the real Worker `fetch`, the real R2
 * bucket of the local runtime, the real Durable Object behind the existence
 * check. Nothing is mocked except where a failure cannot be caused honestly —
 * `ASSET_BUCKET.put` throwing (TC-15) and the rate-limit counter (TC-14).
 *
 * Rate limiting is driven through `handleUpload` with the same `env` plus a
 * limiter implementing `limit({ key })` at exactly `IMAGE_UPLOAD_LIMIT`: the
 * runtime's own `ratelimits` binding shares one process-wide window, so spending
 * 61 units of it here would leave every other test in the run answering 429 for a
 * minute. Every request that goes through `SELF.fetch` carries its own
 * `CF-Connecting-IP` for the same reason.
 */

const bindings = env as unknown as Env;

/** One board for the whole file: board creation is itself rate-limited. */
let boardPromise: Promise<string> | null = null;
async function boardId(): Promise<string> {
  if (boardPromise === null) {
    boardPromise = SELF.fetch('http://worker.local/api/boards', { method: 'POST' })
      .then(async (response) => {
        if (response.status !== 201) throw new Error(`board creation failed: ${response.status}`);
        return ((await response.json()) as { id: string }).id;
      })
      .catch((error: unknown) => {
        boardPromise = null;
        throw error;
      });
  }
  return boardPromise;
}

let visitor = 0;
/** A distinct visitor, so no two tests share a rate-limit key by accident. */
function from(): Record<string, string> {
  visitor += 1;
  return { 'CF-Connecting-IP': `10.44.${(visitor >> 8) & 0xff}.${visitor & 0xff}` };
}

/** `POST /api/boards/:board/assets` with `body` as the raw body. */
function upload(board: string, body: Uint8Array, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`http://worker.local/api/boards/${board}/assets`, {
    method: 'POST',
    headers: { ...from(), ...headers },
    body: body as BodyInit,
  });
}

/** A successful upload, unpacked. */
async function uploadOk(board: string, body: Uint8Array, headers?: Record<string, string>) {
  const response = await upload(board, body, headers);
  if (response.status !== 201) {
    throw new Error(`upload refused with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as { assetKey: string; contentType: string };
}

const serve = (key: string): Promise<Response> =>
  SELF.fetch(`http://worker.local/api/assets/${key}`);

/**
 * Watch the bucket for writes, so a refusal can be shown to have stored nothing
 * as well as answered with an error code.
 */
function watchWrites(): { keys: string[]; restore(): void } {
  const bucket = bindings.ASSETS_BUCKET as unknown as {
    put(key: string, value: unknown, options?: unknown): Promise<unknown>;
  };
  const original = bucket.put.bind(bucket);
  const keys: string[] = [];
  bucket.put = (key: string, value: unknown, options?: unknown) => {
    keys.push(key);
    return original(key, value, options);
  };
  return { keys, restore: () => void (bucket.put = original) };
}

/** Watch the bucket for reads, so a refused key can be shown never to reach it. */
function watchReads(): { keys: string[]; restore(): void } {
  const bucket = bindings.ASSETS_BUCKET as unknown as { get(key: string): Promise<unknown> };
  const original = bucket.get.bind(bucket);
  const keys: string[] = [];
  bucket.get = async (key: string) => {
    keys.push(key);
    return original(key);
  };
  return { keys, restore: () => void (bucket.get = original) };
}

describe('asset upload', () => {
  it('TC-10: stores a real PNG and answers with the key it landed at', async () => {
    const board = await boardId();
    const bytes = pngBytes();

    const response = await upload(board, bytes);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { assetKey: string; contentType: string };

    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey).toBe(assetKeyFor(board, body.assetKey.split('/')[1]!));

    const stored = await bindings.ASSETS_BUCKET.get(body.assetKey);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
  });

  it('TC-10: takes the type from the bytes, never from the request', async () => {
    const board = await boardId();
    const uploaded = await uploadOk(board, pngBytes(), { 'Content-Type': 'text/plain' });
    expect(uploaded.contentType).toBe('image/png');
    const stored = await bindings.ASSETS_BUCKET.get(uploaded.assetKey);
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-10: accepts JPEG, GIF and WebP as well as PNG', async () => {
    const board = await boardId();
    const cases: Array<readonly [Uint8Array, string]> = [
      [jpegBytes(), 'image/jpeg'],
      [gif89aBytes(), 'image/gif'],
      [webpBytes(), 'image/webp'],
    ];
    for (const [bytes, expected] of cases) {
      const uploaded = await uploadOk(board, bytes);
      expect(uploaded.contentType).toBe(expected);
      const stored = await bindings.ASSETS_BUCKET.get(uploaded.assetKey);
      expect(stored!.httpMetadata?.contentType).toBe(expected);
    }
  });

  it('TC-11: stores nothing for a board that was never created or is malformed', async () => {
    const watched = watchWrites();
    try {
      // Right shape, no such board: the existence check answers before storage.
      const unknown = await upload(newBoardId(), pngBytes());
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'board_not_found' });

      // Not a board id at all.
      const malformed = await upload('not-a-board-id', pngBytes());
      expect(malformed.status).toBe(404);
      expect(await malformed.json()).toEqual({ error: 'board_not_found' });
    } finally {
      watched.restore();
    }
    expect(watched.keys).toEqual([]);
  });

  it('TC-11: only POST is a route under /api/boards/:id/assets', async () => {
    const board = await boardId();
    const response = await SELF.fetch(`http://worker.local/api/boards/${board}/assets`, {
      method: 'GET',
      headers: from(),
    });
    expect(response.status).toBe(405);
  });

  it('TC-12: accepts a file of exactly the limit and refuses one byte over', async () => {
    const board = await boardId();
    const watched = watchWrites();
    try {
      const overLimit = jpegBytes(IMAGE_MAX_BYTES + 1);
      expect(overLimit.byteLength).toBe(IMAGE_MAX_BYTES + 1);
      const refused = await upload(board, overLimit);
      expect(refused.status).toBe(413);
      expect(await refused.json()).toEqual({ error: 'too_large' });
      expect(watched.keys).toEqual([]);

      const atLimit = jpegBytes(IMAGE_MAX_BYTES);
      expect(atLimit.byteLength).toBe(IMAGE_MAX_BYTES);
      const accepted = await upload(board, atLimit);
      expect(accepted.status).toBe(201);
      expect(watched.keys).toHaveLength(1);
    } finally {
      watched.restore();
    }
  });

  it('TC-13: refuses a PDF named .png and an SVG, whatever the request claims', async () => {
    const board = await boardId();
    const watched = watchWrites();
    try {
      for (const [bytes, label] of [
        [pdfBytes(), 'a PDF sent as image/png'],
        [svgScriptBytes(), 'an SVG with a script'],
        [junkBytes(4096), 'random bytes'],
        [new Uint8Array(0), 'an empty body'],
      ] as const) {
        const response = await upload(board, bytes, {
          'Content-Type': 'image/png',
          'Content-Disposition': 'form-data; filename="report.png"',
        });
        expect(response.status, label).toBe(415);
        expect(await response.json(), label).toEqual({ error: 'unsupported_image_type' });
      }
      expect(watched.keys).toEqual([]);
    } finally {
      watched.restore();
    }
  });

  it('TC-14: allows IMAGE_UPLOAD_LIMIT uploads per visitor, refuses the next, spares another', async () => {
    const board = await boardId();
    const limiter = new FakeLimiter(IMAGE_UPLOAD_LIMIT);
    const envWithLimiter: Env = { ...bindings, ASSET_UPLOAD_LIMITER: limiter };
    const request = (ip: string): Request =>
      new Request(`http://worker.local/api/boards/${board}/assets`, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
        body: pngBytes() as BodyInit,
      });

    for (let index = 0; index < IMAGE_UPLOAD_LIMIT; index += 1) {
      const response = await handleUpload(request('203.0.113.7'), envWithLimiter, board);
      expect(response.status, `upload ${index + 1}`).toBe(201);
    }

    const refused = await handleUpload(request('203.0.113.7'), envWithLimiter, board);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'rate_limited' });
    expect(refused.headers.get('Retry-After')).toBe(String(IMAGE_UPLOAD_PERIOD_SECONDS));

    // A different visitor, same window, same limiter.
    expect((await handleUpload(request('203.0.113.8'), envWithLimiter, board)).status).toBe(201);
  });

  it('TC-14: with no limiter bound, uploads are unlimited rather than impossible', async () => {
    const board = await boardId();
    const envWithout: Env = { ...bindings, ASSET_UPLOAD_LIMITER: undefined };
    for (let index = 0; index < 3; index += 1) {
      const response = await handleUpload(
        new Request(`http://worker.local/api/boards/${board}/assets`, {
          method: 'POST',
          body: pngBytes() as BodyInit,
        }),
        envWithout,
        board,
      );
      expect(response.status).toBe(201);
    }
  });

  it('TC-15: a storage failure is a 500, not a silent success', async () => {
    const board = await boardId();
    const bucket = bindings.ASSETS_BUCKET as unknown as { put: () => Promise<unknown> };
    const original = bucket.put;
    bucket.put = async () => {
      throw new Error('r2 unavailable');
    };
    try {
      const response = await handleUpload(
        new Request(`http://worker.local/api/boards/${board}/assets`, {
          method: 'POST',
          headers: from(),
          body: pngBytes() as BodyInit,
        }),
        bindings,
        board,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'storage' });
    } finally {
      bucket.put = original;
    }
  });
});

describe('asset serving', () => {
  it('TC-16: serves a stored image with immutable caching and no sniffing', async () => {
    const board = await boardId();
    const bytes = pngBytes();
    const { assetKey } = await uploadOk(board, bytes);

    const response = await serve(assetKey);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('TC-16: answers 404 for a key that was never stored', async () => {
    const board = await boardId();
    const response = await serve(`${board}/${'z'.repeat(22)}`);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'board_not_found' });
  });

  it('TC-16: answers 404 for anything that is not a key, without reading the bucket', async () => {
    const board = await boardId();
    const watched = watchReads();
    try {
      const shortId = 'z'.repeat(21);
      const longId = 'z'.repeat(23);
      for (const key of [
        '../x',
        '../etc/passwd',
        `${board}/..`,
        board, // no separator
        `${board}/${shortId}`,
        `${board}/${longId}`,
        `${board}/has space`,
        `${'z'.repeat(23)}/${longId}`,
        'not-a-key-at-all',
      ]) {
        const response = await handleServe(bindings, key);
        expect(response.status, key).toBe(404);
      }
      expect(watched.keys).toEqual([]);
    } finally {
      watched.restore();
    }
  });

  it('TC-16: dot segments are resolved away before routing, and never reach the bucket', async () => {
    const board = await boardId();
    const watched = watchReads();
    try {
      for (const path of [
        '/api/assets/../../etc/passwd',
        `/api/assets/${board}/../../etc/passwd`,
        `/api/assets/${board}/..`,
        '/api/assets/',
      ]) {
        const response = await SELF.fetch(`http://worker.local${path}`);
        // Either no route at all or the SPA fallback. What must not happen is an
        // asset response: no image, and no read of storage.
        expect(response.headers.get('Content-Type'), path).not.toContain('image/');
        expect(response.headers.get('X-Content-Type-Options'), path).toBeNull();
      }
      expect(watched.keys).toEqual([]);
    } finally {
      watched.restore();
    }
  });

  it('TC-16: upload and serving need no credentials and set none', async () => {
    const board = await boardId();
    const response = await SELF.fetch(`http://worker.local/api/boards/${board}/assets`, {
      method: 'POST',
      body: pngBytes() as BodyInit,
      // No Cookie, no Authorization header: an anonymous visitor can add and read.
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('Set-Cookie')).toBeNull();

    const { assetKey } = (await response.json()) as { assetKey: string };
    const served = await SELF.fetch(`http://worker.local/api/assets/${assetKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('Set-Cookie')).toBeNull();
  });

  it('TC-16: only GET is a route under /api/assets', async () => {
    const board = await boardId();
    const response = await SELF.fetch(`http://worker.local/api/assets/${board}/${'z'.repeat(22)}`, {
      method: 'DELETE',
    });
    expect(response.status).toBe(405);
  });
});

/** The Worker `RateLimit` interface: `limit({ key })` allows `per` per key. */
class FakeLimiter {
  private counts = new Map<string, number>();

  constructor(private readonly per: number) {}

  async limit(opts: { key: string }): Promise<{ success: boolean }> {
    const current = (this.counts.get(opts.key) ?? 0) + 1;
    this.counts.set(opts.key, current);
    return { success: current <= this.per };
  }
}
