/**
 * Integration tests for the image asset API (story 12, assets.api).
 * TC-10 to TC-13, TC-15, TC-16.
 *
 * The `cloudflare:test` pool boots the real worker with the R2 bucket bound,
 * so these exercise the real upload/serve paths against real R2.
 */
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  pngBytes,
  jpegBytes,
  svgBytes,
  pdfBytes,
  randomBytes,
} from '../fixtures/images';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { BOARD_ID_PATTERN } from '../../src/shared/board-id';

function base(): string {
  return 'http://localhost';
}

async function createBoard(): Promise<string> {
  const res = await SELF.fetch(`${base()}/api/boards`, { method: 'POST' });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function upload(
  boardId: string,
  bytes: Uint8Array,
  contentType = 'application/octet-stream',
  headers: Record<string, string> = {},
): Promise<Response> {
  return SELF.fetch(`${base()}/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'content-type': contentType, ...headers },
    body: bytes as unknown as Blob,
  });
}

async function getAsset(key: string): Promise<Response> {
  return SELF.fetch(`${base()}/api/assets/${key}`, { method: 'GET' });
}

describe('assets.api: upload (TC-10, TC-11, TC-12, TC-13, TC-15)', () => {
  // TC-10: real PNG → 201 { assetKey, contentType }; GET → 200 immutable; in R2.
  it('TC-10: a real PNG uploads and serves immutably', async () => {
    const boardId = await createBoard();
    const png = pngBytes(8, 8);
    const res = await upload(boardId, png, 'image/png');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(BOARD_ID_PATTERN.test(body.assetKey.split('/')[0])).toBe(true);
    expect(body.assetKey.split('/')).toHaveLength(2);

    const get = await getAsset(body.assetKey);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-type')).toBe('image/png');
    expect(get.headers.get('cache-control')).toMatch(/max-age=\d+/);
    expect(get.headers.get('cache-control')).toMatch(/immutable/);
    // Served bytes match the upload.
    const served = new Uint8Array(await get.arrayBuffer());
    expect(Array.from(served)).toEqual(Array.from(new Uint8Array(png)));

    // Object is retrievable from the bucket.
    const obj = await env.ASSETS_BUCKET.get(body.assetKey);
    expect(obj).not.toBeNull();
    expect(obj!.httpMetadata?.contentType).toBe('image/png');
  });

  // TC-11: exactly IMAGE_MAX_BYTES → 201; +1 byte → 413.
  it('TC-11: a 10 MB JPEG uploads; 10 MB + 1 byte is 413', async () => {
    const boardId = await createBoard();
    const atLimit = jpegBytes(IMAGE_MAX_BYTES);
    const atLimitRes = await upload(boardId, atLimit, 'image/jpeg');
    expect(atLimitRes.status).toBe(201);

    const over = jpegBytes(IMAGE_MAX_BYTES + 1);
    const overRes = await upload(boardId, over, 'image/jpeg');
    expect(overRes.status).toBe(413);
  });

  // TC-12: PDF (Content-Type image/png) → 415; SVG → 415; nothing stored.
  it('TC-12: a renamed PDF and an SVG are 415 and not stored', async () => {
    const boardId = await createBoard();
    const before = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    const beforeCount = (before as { objects: unknown[] }).objects.length;

    const pdfRes = await upload(boardId, pdfBytes(), 'image/png');
    expect(pdfRes.status).toBe(415);
    const svgRes = await upload(boardId, svgBytes(), 'image/svg+xml');
    expect(svgRes.status).toBe(415);

    const after = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    const afterCount = (after as { objects: unknown[] }).objects.length;
    expect(afterCount).toBe(beforeCount);
  });

  // TC-13: malformed board id → 404; non-existent board → 404.
  it('TC-13: malformed and non-existent boards are 404', async () => {
    // Malformed board id (does not match the 128-bit pattern).
    const malformed = await upload('not-a-valid-id!', pngBytes(), 'image/png');
    expect(malformed.status).toBe(404);

    // Well-formed but non-existent board id.
    const nonexistent = 'a'.repeat(22);
    const res = await upload(nonexistent, pngBytes(), 'image/png');
    expect(res.status).toBe(404);
  });

  // TC-15: put throws → 500; object not stored.
  it('TC-15: an injected put failure is 500 and stores nothing', async () => {
    const boardId = await createBoard();
    const before = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    const beforeCount = (before as { objects: unknown[] }).objects.length;

    const res = await upload(boardId, pngBytes(), 'image/png', {
      'x-vidi6-test-fail-put': '1',
    });
    expect(res.status).toBe(500);

    const after = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    const afterCount = (after as { objects: unknown[] }).objects.length;
    expect(afterCount).toBe(beforeCount);
  });
});

describe('assets.api: serve (TC-16)', () => {
  it('TC-16: stored key → 200; missing key → 404; ../x → 404', async () => {
    const boardId = await createBoard();
    const res = await upload(boardId, pngBytes(4, 4), 'image/png');
    const { assetKey } = (await res.json()) as { assetKey: string };

    // Stored key → 200.
    expect((await getAsset(assetKey)).status).toBe(200);

    // Missing (well-formed) key → 404.
    const missing = `${boardId}/${'b'.repeat(22)}`;
    expect((await getAsset(missing)).status).toBe(404);

    // Path traversal → 404 (handled by the worker, never the SPA).
    const traversal = SELF.fetch(`${base()}/api/assets/${boardId}/../${'b'.repeat(22)}`);
    const t = await traversal;
    expect(t.status).toBe(404);
  });

  it('TC-16: random bytes / malformed key → 404', async () => {
    // A malformed key (23 chars) → 404.
    expect((await getAsset(`${'a'.repeat(23)}/${'b'.repeat(22)}`)).status).toBe(404);
    // A non-image upload is 415 (guarding the serve side stays clean).
    const boardId = await createBoard();
    expect((await upload(boardId, randomBytes(100), 'image/png')).status).toBe(415);
  });
});
