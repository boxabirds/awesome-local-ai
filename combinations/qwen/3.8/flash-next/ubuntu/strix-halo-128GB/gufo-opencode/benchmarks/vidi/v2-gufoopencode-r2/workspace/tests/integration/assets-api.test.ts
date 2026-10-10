// Story 12 asset API integration: real Worker routes, real Durable Object
// existence RPC and real R2 in workerd. TC-10 to TC-13, TC-15, TC-16.

import { describe, expect, it, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';

// 1x1 truecolor PNG (decodable; magic bytes are what the server sniffs).
const PNG = new Uint8Array(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  )
    .split('')
    .map((c) => c.charCodeAt(0)),
);

function padded(magic: readonly number[], total: number): Uint8Array {
  const body = new Uint8Array(total);
  body.set(magic, 0);
  return body;
}

async function newBoard(): Promise<string> {
  const response = await SELF.fetch('http://mocked-worker/api/boards', { method: 'POST' });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

function postAsset(boardId: string, body: BodyInit, contentType = 'image/png'): Promise<Response> {
  return SELF.fetch(`http://mocked-worker/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

describe('POST /api/boards/:boardId/assets', () => {
  it('TC-10: a real PNG to an existing board is stored with its sniffed type and an unguessable key', async () => {
    const boardId = await newBoard();
    const response = await postAsset(boardId, PNG.slice());
    expect(response.status).toBe(201);
    const { assetKey, contentType } = (await response.json()) as {
      assetKey: string;
      contentType: string;
    };
    expect(contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(assetKey)).toBe(true);
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);

    const stored = await env.ASSETS_BUCKET.get(assetKey);
    expect(stored).not.toBeNull();
    expect(stored!.httpMetadata?.contentType).toBe('image/png');
    const storedBytes = new Uint8Array(await stored!.arrayBuffer());
    expect(storedBytes.byteLength).toBe(PNG.byteLength);
  });

  it('TC-11: uploads to unknown or malformed boards get 404 and store nothing', async () => {
    const putSpy = vi.spyOn(env.ASSETS_BUCKET, 'put');
    const unknown = newBoardId();
    expect((await postAsset(unknown, PNG.slice())).status).toBe(404);
    expect((await postAsset('not-an-id', PNG.slice())).status).toBe(404);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 is 413 and stores nothing; exactly IMAGE_MAX_BYTES JPEG is 201', async () => {
    const boardId = await newBoard();
    const putSpy = vi.spyOn(env.ASSETS_BUCKET, 'put');

    const over = padded([0xff, 0xd8, 0xff], IMAGE_MAX_BYTES + 1);
    expect((await postAsset(boardId, over)).status).toBe(413);
    expect(putSpy).not.toHaveBeenCalled();

    const atLimit = padded([0xff, 0xd8, 0xff, 0xe0], IMAGE_MAX_BYTES);
    const response = await postAsset(boardId, atLimit);
    expect(response.status).toBe(201);
    const { contentType } = (await response.json()) as { contentType: string };
    expect(contentType).toBe('image/jpeg');
    expect(putSpy).toHaveBeenCalledTimes(1);
    putSpy.mockRestore();
  });

  it('TC-13: content decides, not Content-Type: PDF bytes and SVG are 415 and store nothing', async () => {
    const boardId = await newBoard();
    const putSpy = vi.spyOn(env.ASSETS_BUCKET, 'put');

    const pdf = new TextEncoder().encode('%PDF-1.4\n% disguised\n');
    expect((await postAsset(boardId, pdf, 'image/png')).status).toBe(415);

    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await postAsset(boardId, svg, 'image/svg+xml')).status).toBe(415);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('TC-15: an R2 put that throws is a 500', async () => {
    const boardId = await newBoard();
    const putSpy = vi.spyOn(env.ASSETS_BUCKET, 'put').mockRejectedValue(new Error('r2 down'));
    const response = await postAsset(boardId, PNG.slice());
    expect(response.status).toBe(500);
    putSpy.mockRestore();
  });
});

describe('GET /api/assets/:boardId/:assetId', () => {
  it('TC-16: stored bytes come back immutable and un-sniffable; missing keys and traversal are 404', async () => {
    const boardId = await newBoard();
    const response = await postAsset(boardId, PNG.slice());
    const { assetKey } = (await response.json()) as { assetKey: string };
    const [keyBoard, keyAsset] = assetKey.split('/');

    const served = await SELF.fetch(`http://mocked-worker/api/assets/${keyBoard}/${keyAsset}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'");
    const body = new Uint8Array(await served.arrayBuffer());
    expect(body.byteLength).toBe(PNG.byteLength);

    expect((await SELF.fetch(`http://mocked-worker/api/assets/${boardId}/${newBoardId()}`)).status).toBe(404);
    // Encoded traversal reaches the handler (the URL parser collapses plain
    // '../' before routing); the key pattern rejects it.
    expect((await SELF.fetch('http://mocked-worker/api/assets/..%2Ffoo/x')).status).toBe(404);
    expect((await SELF.fetch(`http://mocked-worker/api/assets/${boardId}/x`)).status).toBe(404);
  });
});
