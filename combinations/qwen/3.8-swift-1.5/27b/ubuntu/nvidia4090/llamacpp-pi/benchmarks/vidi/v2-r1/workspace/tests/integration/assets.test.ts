/**
 * Story 12: asset API integration tests (TC-10 to TC-13, TC-15, TC-16).
 *
 * Real Worker request handling (`SELF.fetch`), real R2 (Miniflare) and the
 * real story 5 `exists()` RPC.
 */
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '@shared/board-id';
import { ASSET_KEY_PATTERN } from '@shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '@shared/config';
import { handleUpload } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import { fixtureBytes, sizedBytes, JPEG_MAGIC, PNG_MAGIC } from '../fixtures/images';

/** Create a fresh board through the public API; returns its id. */
async function createBoard(): Promise<string> {
  const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(post.status).toBe(201);
  const { id } = (await post.json()) as { id: string };
  return id;
}

/** Number of objects currently in the R2 bucket. */
async function r2Count(): Promise<number> {
  const result = await env.ASSETS_BUCKET.list();
  return result.objects.length;
}

describe('TC-10: POST a real PNG to an existing board', () => {
  it('201; R2 object exists with contentType image/png; key matches the pattern', async () => {
    const boardId = await createBoard();
    const png = fixtureBytes('screenshot.png');

    const resp = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);

    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.httpMetadata?.contentType).toBe('image/png');
    // Drain the body so the storage frame can be popped (known issue).
    await object?.arrayBuffer();
  });
});

describe('TC-11: unknown and malformed boards are refused (negative)', () => {
  it('POST to a never-created board id → 404; nothing stored', async () => {
    const freshId = newBoardId();
    const before = await r2Count();

    const resp = await SELF.fetch(`http://localhost/api/boards/${freshId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: fixtureBytes('screenshot.png'),
    });
    expect(resp.status).toBe(404);
    expect(await r2Count()).toBe(before);
  });

  it('POST to a malformed board id → 404; nothing stored', async () => {
    const before = await r2Count();

    const resp = await SELF.fetch('http://localhost/api/boards/not-a-valid-id/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: fixtureBytes('screenshot.png'),
    });
    expect(resp.status).toBe(404);
    expect(await r2Count()).toBe(before);
  });
});

describe('TC-12: size limit boundary', () => {
  it('IMAGE_MAX_BYTES + 1 → 413, nothing stored', async () => {
    const boardId = await createBoard();
    const before = await r2Count();

    const resp = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: sizedBytes(IMAGE_MAX_BYTES + 1, JPEG_MAGIC),
    });
    expect(resp.status).toBe(413);
    expect(await r2Count()).toBe(before);
  });

  it('exactly IMAGE_MAX_BYTES (JPEG magic) → 201 (boundary)', async () => {
    const boardId = await createBoard();

    const resp = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: sizedBytes(IMAGE_MAX_BYTES, JPEG_MAGIC),
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/jpeg');
    expect(body.assetKey).toMatch(ASSET_KEY_PATTERN);

    const object = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(object).not.toBeNull();
    expect(object?.size).toBe(IMAGE_MAX_BYTES);
    // Drain the body so the storage frame can be popped (known issue).
    await object?.arrayBuffer();
  });
});

describe('TC-13: disguised and SVG files are refused (negative, security)', () => {
  it('PDF with Content-Type image/png → 415, nothing stored', async () => {
    const boardId = await createBoard();
    const before = await r2Count();

    const resp = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: fixtureBytes('fake.png'), // a real PDF renamed .png
    });
    expect(resp.status).toBe(415);
    expect(await r2Count()).toBe(before);
  });

  it('SVG with a script tag → 415, nothing stored', async () => {
    const boardId = await createBoard();
    const before = await r2Count();

    const resp = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/svg+xml' },
      body: fixtureBytes('script.svg'),
    });
    expect(resp.status).toBe(415);
    expect(await r2Count()).toBe(before);
  });
});

describe('TC-15: R2 put failure → 500 (error path)', () => {
  it('wrapped bucket whose put throws → 500', async () => {
    const boardId = await createBoard();

    // A real storage failure cannot be forced on demand: wrap the bucket.
    const failingEnv = {
      ...env,
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('injected r2 failure');
        },
        get: env.ASSETS_BUCKET.get.bind(env.ASSETS_BUCKET),
        list: env.ASSETS_BUCKET.list.bind(env.ASSETS_BUCKET),
      },
    } as unknown as Env;

    const req = new Request('http://localhost/api/boards/x/assets', {
      method: 'POST',
      body: fixtureBytes('screenshot.png'),
    });
    const resp = await handleUpload(req, failingEnv, boardId);
    expect(resp.status).toBe(500);
  });
});

describe('TC-16: serving stored assets', () => {
  it('GET a stored key → 200 with Content-Type, immutable Cache-Control, nosniff, CSP', async () => {
    const boardId = await createBoard();
    const upload = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: fixtureBytes('small.png'),
    });
    expect(upload.status).toBe(201);
    const { assetKey } = (await upload.json()) as { assetKey: string };

    const resp = await SELF.fetch(`http://localhost/api/assets/${assetKey}`);
    expect(resp.status).toBe(200);
    expect(resp.headers.get('Content-Type')).toBe('image/png');
    expect(resp.headers.get('Cache-Control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(resp.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(resp.headers.get('Content-Security-Policy')).toBe("default-src 'none'");

    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(bytes.subarray(0, 8)).toEqual(new Uint8Array(PNG_MAGIC));
  });

  it('GET a missing key → 404', async () => {
    const resp = await SELF.fetch(`http://localhost/api/assets/${newBoardId()}/${newBoardId()}`);
    expect(resp.status).toBe(404);
  });

  it("GET '../x' (malformed key) → 404", async () => {
    // Encoded so the path survives URL normalisation.
    const encoded = await SELF.fetch('http://localhost/api/assets/..%2Fx');
    expect(encoded.status).toBe(404);
  });
});
