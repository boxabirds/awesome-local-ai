/**
 * Story 12 — asset upload and serving API (assets.api).
 *
 * Real Worker request handling, real Miniflare R2 and the real story 5
 * `exists()` RPC through `SELF.fetch`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SELF, env, reset } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import { handleUpload, handleServe, type AssetsEnv } from '../../src/worker/assets';

// A real 1x1 PNG (valid magic bytes + decodable payload).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PNG_BYTES = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

// An SVG document containing a script tag (must never be accepted).
const SVG_BYTES = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>',
);

// A PDF (renamed .png on the client; the server must decide by content).
const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

function jpegBytes(size: number): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  return b;
}

beforeEach(async () => {
  await reset();
});

async function createBoard(): Promise<string> {
  const res = await SELF.fetch(new Request('http://localhost/api/boards', { method: 'POST' }));
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function upload(boardId: string, bytes: Uint8Array, contentType?: string): Promise<Response> {
  return SELF.fetch(
    new Request(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: bytes as unknown as BodyInit,
      headers: contentType ? { 'Content-Type': contentType } : {},
    }),
  );
}

async function storedKeys(prefix: string): Promise<string[]> {
  const { objects } = await env.ASSETS_BUCKET.list({ prefix });
  return objects.map((o) => o.key);
}

describe('TC-10: POST a real PNG to an existing board → 201, stored with contentType', () => {
  it('201; R2 object exists with contentType image/png; key matches the pattern', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, PNG_BYTES, 'image/png');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(body.contentType).toBe('image/png');

    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
    expect(object?.size).toBe(PNG_BYTES.length);
  });
});

describe('TC-11: uploads to boards that do not exist are refused (negative)', () => {
  it('POST to a never-created board id → 404; nothing in R2', async () => {
    const boardId = newBoardId();
    const res = await upload(boardId, PNG_BYTES);
    expect(res.status).toBe(404);
    expect(await storedKeys('')).toEqual([]);
  });

  it('POST to a malformed board id → 404; nothing in R2', async () => {
    const res = await upload('not-a-valid-id', PNG_BYTES);
    expect(res.status).toBe(404);
    expect(await storedKeys('')).toEqual([]);
  });
});

describe('TC-12: size limit (boundary)', () => {
  it(`POST ${IMAGE_MAX_BYTES + 1} bytes → 413, nothing stored`, async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, new Uint8Array(IMAGE_MAX_BYTES + 1));
    expect(res.status).toBe(413);
    expect(await storedKeys('')).toEqual([]);
  });

  it(`POST a valid JPEG of exactly ${IMAGE_MAX_BYTES} bytes → 201`, async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, jpegBytes(IMAGE_MAX_BYTES), 'image/jpeg');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object?.size).toBe(IMAGE_MAX_BYTES);
  });
});

describe('TC-13: disguised and SVG files are refused by content (negative, security)', () => {
  it('POST a PDF with Content-Type image/png → 415; nothing stored', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, PDF_BYTES, 'image/png');
    expect(res.status).toBe(415);
    expect(await storedKeys('')).toEqual([]);
  });

  it('POST an SVG with a script tag → 415; nothing stored', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, SVG_BYTES, 'image/svg+xml');
    expect(res.status).toBe(415);
    expect(await storedKeys('')).toEqual([]);
  });
});

describe('TC-15: storage failure → 500 (error path)', () => {
  it('R2 put wrapped to throw → 500', async () => {
    const boardId = await createBoard();
    const failingEnv: AssetsEnv = {
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('injected storage failure');
        },
        get: async () => null,
        list: async () => ({ objects: [], truncated: false }),
        delete: async () => {},
      },
      BOARD_ROOM: env.BOARD_ROOM,
    };
    const res = await handleUpload(
      new Request('http://localhost/api/boards/x/assets', { method: 'POST', body: PNG_BYTES as unknown as BodyInit }),
      failingEnv,
      boardId,
    );
    expect(res.status).toBe(500);
    // Nothing was stored through the real bucket either.
    expect(await storedKeys('')).toEqual([]);
  });
});

describe('TC-16: serving stored assets (immutable, nosniff, CSP)', () => {
  it('GET a stored key → 200 with Content-Type, immutable Cache-Control, nosniff, CSP', async () => {
    const boardId = await createBoard();
    const up = await upload(boardId, PNG_BYTES, 'image/png');
    const { assetKey } = (await up.json()) as { assetKey: string };

    const res = await SELF.fetch(new Request(`http://localhost/api/assets/${assetKey}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_BYTES.length);
  });

  it('GET a missing key → 404', async () => {
    const key = `${newBoardId()}/${newBoardId()}`;
    const res = await SELF.fetch(new Request(`http://localhost/api/assets/${key}`));
    expect(res.status).toBe(404);
  });

  it("GET '../x' → 404 (malformed keys are refused)", async () => {
    // URL parsing normalises dot segments, so the pattern guard is exercised
    // at the handler boundary (any unnormalised key reaching the handler
    // must be refused, not resolved against the bucket).
    const res = await handleServe(env, '../x');
    expect(res.status).toBe(404);
  });
});
