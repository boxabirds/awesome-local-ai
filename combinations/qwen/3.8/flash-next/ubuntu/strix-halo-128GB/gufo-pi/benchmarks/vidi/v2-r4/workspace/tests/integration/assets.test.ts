/**
 * Integration tests for the assets API (TC-10 to TC-13, TC-15, TC-16).
 * Runs against a real wrangler dev with Miniflare R2 and BoardRoom DO.
 */
import { describe, it, expect } from 'vitest';
import { integrationFetch, createBoard } from './ws-client';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.resolve(__dirname, '../fixtures/images');

function readFixture(name: string): ArrayBuffer {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return ab;
}

describe('assets.api upload (TC-10)', () => {
  it('POST real PNG to existing board → 201; R2 object with correct contentType; key matches pattern', async () => {
    const boardId = await createBoard();
    const png = readFixture('tiny.png');

    const res = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: png,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as { assetKey: string; contentType: string };
    expect(data.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(data.assetKey)).toBe(true);
    expect(data.assetKey.startsWith(boardId + '/')).toBe(true);

    // Verify we can serve it back
    const getRes = await integrationFetch(`/api/assets/${data.assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('image/png');
  });
});

describe('assets.api 404 (TC-11)', () => {
  it('POST to never-created board id → 404', async () => {
    // Create a fresh id that was never registered as a board
    const { newBoardId } = await import('../../src/shared/board-id');
    const fakeId = newBoardId();
    const png = readFixture('tiny.png');

    const res = await integrationFetch(`/api/boards/${fakeId}/assets`, {
      method: 'POST',
      body: png,
    });

    expect(res.status).toBe(404);
  });

  it('POST to malformed id → 404', async () => {
    const png = readFixture('tiny.png');
    const res = await integrationFetch('/api/boards/abc/assets', {
      method: 'POST',
      body: png,
    });
    expect(res.status).toBe(404);
  });
});

describe('assets.api size limit (TC-12)', () => {
  it('POST IMAGE_MAX_BYTES + 1 bytes → 413', async () => {
    const boardId = await createBoard();
    const oversized = new ArrayBuffer(IMAGE_MAX_BYTES + 1);
    const view = new Uint8Array(oversized);
    // Put PNG magic bytes so it would pass sniffing
    view[0] = 0x89; view[1] = 0x50; view[2] = 0x4E; view[3] = 0x47;

    const res = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: oversized,
    });

    expect(res.status).toBe(413);
  });

  it('POST valid JPEG of exactly IMAGE_MAX_BYTES → 201 (boundary)', async () => {
    const boardId = await createBoard();
    // Create a file of exactly IMAGE_MAX_BYTES with JPEG magic
    const ab = new ArrayBuffer(IMAGE_MAX_BYTES);
    const view = new Uint8Array(ab);
    view[0] = 0xFF; view[1] = 0xD8; view[2] = 0xFF;

    const res = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: ab,
    });

    expect(res.status).toBe(201);
    const data = await res.json() as { contentType: string };
    expect(data.contentType).toBe('image/jpeg');
  });
});

describe('assets.api type sniffing (TC-13)', () => {
  it('POST PDF renamed as PNG with Content-Type: image/png → 415', async () => {
    const boardId = await createBoard();
    const pdf = readFixture('renamed.pdf-as-png.png');

    const res = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: pdf,
      headers: { 'Content-Type': 'image/png' },
    });

    expect(res.status).toBe(415);
  });

  it('POST SVG → 415', async () => {
    const boardId = await createBoard();
    const svg = readFixture('bad.svg');

    const res = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: svg,
    });

    expect(res.status).toBe(415);
  });
});

describe('assets.api serving (TC-16)', () => {
  it('GET stored key → 200 with Content-Type, immutable Cache-Control, nosniff, CSP', async () => {
    const boardId = await createBoard();
    const png = readFixture('tiny.png');

    const uploadRes = await integrationFetch(`/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: png,
    });
    expect(uploadRes.status).toBe(201);
    const { assetKey } = await uploadRes.json() as { assetKey: string };

    const res = await integrationFetch(`/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
  });

  it('GET missing key → 404', async () => {
    const { newBoardId } = await import('../../src/shared/board-id');
    const key = `${newBoardId()}/${newBoardId()}`;
    const res = await integrationFetch(`/api/assets/${key}`);
    expect(res.status).toBe(404);
  });

  it('GET key with .. in path → 404 (key does not match ASSET_KEY_PATTERN)', async () => {
    // The URL path /api/assets/..%2Fx would be decoded by the server as '../x'
    // which doesn't match ASSET_KEY_PATTERN so should return 404
    const res = await integrationFetch('/api/assets/..%2Fx');
    expect(res.status).toBe(404);
  });
});
