import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import type { Env } from '../../src/worker/index';
import { maxSizeJpeg, oversizeJpeg, pdfBytes, pngBytes, svgBytes } from '../fixtures/image-bytes';
import { ensureBoard, fetchWorker } from './ws-client';

const BASE = 'https://example.com';
const bucket = (env as unknown as Env).ASSETS_BUCKET;
const upload = (boardId: string, body: Uint8Array, type = 'application/octet-stream') =>
  fetchWorker(`${BASE}/api/boards/${boardId}/assets`, { method: 'POST', body, headers: { 'Content-Type': type } });
const storedKeys = async () => (await bucket.list()).objects.map((o) => o.key);

async function newBoard(): Promise<string> {
  const id = newBoardId();
  await ensureBoard(id);
  return id;
}

describe('Asset API', () => {
  it('TC-10: a real PNG is stored with its sniffed type under an unguessable key', async () => {
    const boardId = await newBoard();
    const res = await upload(boardId, pngBytes());
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    const stored = await bucket.head(body.assetKey);
    expect(stored?.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11: unknown and malformed boards are 404 and store nothing', async () => {
    const before = await storedKeys();
    expect((await upload(newBoardId(), pngBytes())).status).toBe(404);
    expect((await upload('not-a-board', pngBytes())).status).toBe(404);
    expect(await storedKeys()).toEqual(before);
  });

  it('TC-12: one byte over the limit is 413 and not stored; exactly the limit is accepted', async () => {
    const boardId = await newBoard();
    const before = await storedKeys();
    expect((await upload(boardId, oversizeJpeg(), 'image/jpeg')).status).toBe(413);
    expect(await storedKeys()).toEqual(before);
    const ok = await upload(boardId, maxSizeJpeg(), 'image/jpeg');
    expect(ok.status).toBe(201);
    const { assetKey } = (await ok.json()) as { assetKey: string };
    expect((await bucket.head(assetKey))?.size).toBe(IMAGE_MAX_BYTES);
  });

  it('TC-13: a PDF claiming image/png and an SVG with a script are 415 and not stored', async () => {
    const boardId = await newBoard();
    const before = await storedKeys();
    expect((await upload(boardId, pdfBytes(), 'image/png')).status).toBe(415);
    expect((await upload(boardId, svgBytes(), 'image/svg+xml')).status).toBe(415);
    expect(await storedKeys()).toEqual(before);
  });

  it('TC-15: a storage failure is 500', async () => {
    const boardId = await newBoard();
    const put = vi.spyOn(bucket, 'put').mockRejectedValue(new Error('r2 down'));
    try {
      expect((await upload(boardId, pngBytes())).status).toBe(500);
    } finally {
      put.mockRestore();
    }
  });

  it('TC-16: stored assets are served immutable, nosniff and with a locked-down CSP; missing and malformed keys are 404', async () => {
    const boardId = await newBoard();
    const { assetKey } = (await (await upload(boardId, pngBytes())).json()) as { assetKey: string };
    const res = await fetchWorker(`${BASE}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pngBytes());

    expect((await fetchWorker(`${BASE}/api/assets/${boardId}/${newBoardId()}`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/api/assets/${boardId}/..%2Fx`)).status).toBe(404);
    expect((await fetchWorker(`${BASE}/api/assets/${boardId}/x`)).status).toBe(404);
  });
});
