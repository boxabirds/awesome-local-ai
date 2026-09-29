/**
 * Story 12: image asset API integration tests (assets.api, TC-10 to TC-16).
 *
 * Runs inside workerd (real Worker + real Durable Objects + real R2
 * emulation) via the Cloudflare Vitest pool — same setup as board-api.
 * R2 state is inspected through the test-only /__test/assets/* routes
 * (enabled by TEST_HOOKS in wrangler.test.jsonc, absent in production).
 *
 * Rate-limit implementation note (required by tasks.md task 4): the local
 * miniflare/workerd runtime does NOT implement the `ratelimits` binding
 * (the worker falls back to a fixed-window in-memory limiter — see
 * src/worker/assets.ts). TC-14 therefore uses a fake `Limiter` wired through
 * `worker.fetch(req, spyEnv)` so the limiter under test is exactly the
 * 60/min contract. All other tests go through SELF.fetch (real env,
 * fallback limiter) with well under 60 uploads.
 */
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import worker from 'src/worker/index';
import type { Limiter } from 'src/worker/create-board';
import { newBoardId } from 'src/shared/board-id';
import { ASSET_KEY_PATTERN } from 'src/shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from 'src/shared/config';
import {
  makePng,
  makeJpegOfSize,
  JPEG_BYTES,
  makeGif,
  WEBP_BYTES,
  makeSvgWithScript,
  makePdf,
  toBase64,
} from '../fixtures/images';

const PNG = makePng(16, 16, [200, 30, 60]);
const PNG_B64 = toBase64(PNG);

async function api(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, init);
}

async function createBoardId(): Promise<string> {
  const res = await api('/api/boards', { method: 'POST' });
  if (res.status !== 201) throw new Error(`board create failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** workers-types BodyInit wants ArrayBuffer; the typed-array generic trips it up. */
const body = (bytes: Uint8Array): ArrayBuffer => bytes.buffer as ArrayBuffer;

async function upload(
  boardId: string,
  bytes: Uint8Array,
  type = 'image/png',
): Promise<Response> {
  return api(`/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: body(bytes),
  });
}

async function assetTestOp(op: string, body: object): Promise<Record<string, unknown>> {
  const res = await api(`/__test/assets/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status !== 200) throw new Error(`asset op ${op} failed: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** R2 keys under a board prefix. */
async function storedUnder(boardId: string): Promise<string[]> {
  const out = await assetTestOp('list', { prefix: `${boardId}/` });
  return out.keys as string[];
}

/** A spy BOARD_ROOM namespace: exists() → the given value. */
function boardRoomSpy(exists: boolean) {
  return {
    idFromName: (id: string) => id,
    get: () => ({
      exists: () => Promise.resolve(exists),
      fetch: () => new Response('n/a', { status: 404 }),
    }),
  };
}

/** In-memory R2 stand-in for worker.fetch(req, env) tests. */
function fakeBucket() {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  return {
    put: async (
      key: string,
      value: Uint8Array | ArrayBuffer,
      opts?: { httpMetadata?: { contentType?: string } },
    ) => {
      store.set(key, {
        bytes: new Uint8Array(value as Uint8Array),
        contentType: opts?.httpMetadata?.contentType,
      });
    },
    get: async (key: string) => {
      const e = store.get(key);
      if (!e) return null;
      return {
        httpMetadata: { contentType: e.contentType },
        arrayBuffer: async () =>
          e.bytes.buffer.slice(e.bytes.byteOffset, e.bytes.byteOffset + e.bytes.byteLength),
      };
    },
    list: async ({ prefix }: { prefix?: string } = {}) => ({
      objects: [...store.entries()]
        .filter(([k]) => !prefix || k.startsWith(prefix))
        .map(([k]) => ({ key: k })),
    }),
    delete: async (keys: string[]) => {
      for (const k of keys) store.delete(k);
    },
  };
}

describe('assets.api: POST /api/boards/:id/assets', () => {
  it('TC-10: valid image → 201 + assetKey; the R2 object is stored with the sniffed content type', async () => {
    const boardId = await createBoardId();
    const res = await upload(boardId, PNG);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(body.contentType).toBe('image/png');

    const info = (await assetTestOp('inspect', { key: body.assetKey })) as {
      exists: boolean;
      contentType: string | null;
      byteLength: number;
    };
    expect(info.exists).toBe(true);
    expect(info.contentType).toBe('image/png');
    expect(info.byteLength).toBe(PNG.length);
    // Byte-for-byte: the served object is exactly the uploaded file.
    const served = await api(`/api/assets/${body.assetKey}`);
    const servedBytes = new Uint8Array(await served.arrayBuffer());
    expect(toBase64(servedBytes)).toBe(PNG_B64);
  });

  it('TC-10b: all four raster types store with their sniffed types', async () => {
    const boardId = await createBoardId();
    const cases: Array<[Uint8Array, string]> = [
      [JPEG_BYTES, 'image/jpeg'],
      [makeGif(), 'image/gif'],
      [WEBP_BYTES, 'image/webp'],
    ];
    for (const [bytes, expected] of cases) {
      const res = await upload(boardId, bytes, expected);
      expect(res.status).toBe(201);
      const { assetKey, contentType } = (await res.json()) as {
        assetKey: string;
        contentType: string;
      };
      expect(contentType).toBe(expected);
      const info = (await assetTestOp('inspect', { key: assetKey })) as {
        contentType: string | null;
      };
      expect(info.contentType).toBe(expected);
    }
  });

  it('TC-11: unknown board → 404; malformed id → 404; nothing stored in R2', async () => {
    const unknown = newBoardId();
    expect((await upload(unknown, PNG)).status).toBe(404);

    // Malformed ids: no namespace access, no storage (fake bucket must stay
    // empty, proving the worker never reaches R2 for them).
    const bucket = fakeBucket();
    const env = { BOARD_ROOM: boardRoomSpy(true), ASSETS_BUCKET: bucket } as never;
    for (const id of ['abc', 'x'.repeat(23), 'abc.def']) {
      const res = await worker.fetch(
        new Request(`http://localhost/api/boards/${id}/assets`, {
          method: 'POST',
          body: body(PNG),
        }),
        env,
      );
      expect(res.status).toBe(404);
    }
    expect((await bucket.list()).objects).toHaveLength(0);
    expect((await storedUnder(unknown)).length).toBe(0);
  });

  it('TC-12: exactly IMAGE_MAX_BYTES accepted; IMAGE_MAX_BYTES + 1 → 413; only the at-limit file stored', async () => {
    const boardId = await createBoardId();

    const atLimit = await upload(boardId, makeJpegOfSize(IMAGE_MAX_BYTES));
    expect(atLimit.status).toBe(201);

    const over = await upload(boardId, makeJpegOfSize(IMAGE_MAX_BYTES + 1));
    expect(over.status).toBe(413);

    const keys = await storedUnder(boardId);
    expect(keys.length).toBe(1); // only the at-limit file
  });

  it('TC-13: SVG and PDF (even with image/png headers) → 415; nothing stored', async () => {
    const boardId = await createBoardId();

    const svg = await upload(boardId, makeSvgWithScript(), 'image/svg+xml');
    expect(svg.status).toBe(415);

    // Disguised: client header claims image/png, content is a PDF.
    const pdf = await upload(boardId, makePdf(), 'image/png');
    expect(pdf.status).toBe(415);

    // SVG claiming image/png is also rejected.
    const svgDisguised = await upload(boardId, makeSvgWithScript(), 'image/png');
    expect(svgDisguised.status).toBe(415);

    expect((await storedUnder(boardId)).length).toBe(0);
  });

  it('TC-14: 60/min per visitor — the 61st upload 429s; a second visitor is not blocked', async () => {
    // Fake limiter: the exact IMAGE_UPLOAD_LIMIT contract (the local runtime
    // has no ratelimits binding; see the file header note).
    const counts = new Map<string, number>();
    const limiter: Limiter = {
      async limit({ key }) {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return { success: n <= 60 };
      },
    };
    const boardId = await createBoardId();
    const env = {
      BOARD_ROOM: boardRoomSpy(true),
      ASSETS_BUCKET: fakeBucket(),
      ASSET_UPLOAD_LIMITER: limiter,
    } as never;

    const post = (ip: string): Promise<Response> =>
      worker.fetch(
        new Request(`http://localhost/api/boards/${boardId}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png', 'CF-Connecting-IP': ip },
          body: body(PNG),
        }),
        env,
      );

    for (let i = 1; i <= 60; i++) {
      expect((await post('203.0.113.1')).status).toBe(201);
    }
    expect((await post('203.0.113.1')).status).toBe(429);
    // A different visitor is unaffected.
    expect((await post('198.51.100.2')).status).toBe(201);
  });

  it('TC-15: storage failure → 500', async () => {
    const boardId = await createBoardId();
    const failing = {
      put: async (): Promise<void> => {
        throw new Error('r2 down');
      },
      get: async () => null,
      list: async () => ({ objects: [], truncated: false }),
    };
    const env = { BOARD_ROOM: boardRoomSpy(true), ASSETS_BUCKET: failing } as never;
    const res = await worker.fetch(
      new Request(`http://localhost/api/boards/${boardId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: body(PNG),
      }),
      env,
    );
    expect(res.status).toBe(500);
  });
});

describe('assets.api: GET /api/assets/:boardId/:assetId', () => {
  it('TC-16: stored key → 200 with sniffed type + immutable cache headers; missing → 404; traversal → 404', async () => {
    const boardId = await createBoardId();
    const res = await upload(boardId, PNG);
    const { assetKey } = (await res.json()) as { assetKey: string };

    const got = await api(`/api/assets/${assetKey}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('Content-Type')).toBe('image/png');
    expect(got.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(got.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const body = new Uint8Array(await got.arrayBuffer());
    expect(toBase64(body)).toBe(PNG_B64);

    // A well-formed key that was never stored.
    const missing = `${boardId}/${newBoardId()}`;
    expect((await api(`/api/assets/${missing}`)).status).toBe(404);

    // Traversal / malformed keys never reach the bucket.
    expect((await api(`/api/assets/..%2F..%2Fetc`)).status).toBe(404);
    expect((await api(`/api/assets/abc`)).status).toBe(404);
    expect((await api(`/api/assets/${'a'.repeat(23)}/x`)).status).toBe(404);
  });
});
