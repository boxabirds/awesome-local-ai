import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestHarness } from 'wrangler';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';

// Story 12 assets.api against the real Worker: request handling, magic-byte
// sniffing, the size limit and immutable serving, landing in real Miniflare
// R2 and using the real story 5 exists() RPC.
let base = '';
let closeHarness: (() => Promise<void>) | null = null;

beforeAll(async () => {
  const harness = createTestHarness({
    workers: [{ configPath: './wrangler.jsonc', vars: { TEST_HOOKS: '1' } }]
  });
  const { url } = await harness.listen();
  base = url.toString().replace(/\/$/, '');
  closeHarness = () => harness.close();
}, 180_000);

afterAll(async () => {
  if (closeHarness !== null) await closeHarness();
});

function fixture(name: string): Uint8Array {
  const buffer = readFileSync(join(process.cwd(), 'tests', 'fixtures', 'images', name));
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

async function createBoard(): Promise<string> {
  const response = await fetch(`${base}/api/boards`, { method: 'POST' });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  return id;
}

interface R2Key {
  name: string;
  contentType: string | null;
}

async function r2Keys(): Promise<R2Key[]> {
  const response = await fetch(`${base}/__test/r2-keys`);
  expect(response.status).toBe(200);
  const { keys } = (await response.json()) as { keys: R2Key[] };
  return keys;
}

function upload(boardId: string, body: Uint8Array, contentType = 'image/png'): Promise<Response> {
  return fetch(`${base}/api/boards/${boardId}/assets`, { method: 'POST', body, headers: { 'Content-Type': contentType } });
}

describe('assets.api upload', () => {
  it('TC-10 POSTs a real PNG to an existing board: 201, stored with sniffed contentType', async () => {
    const boardId = await createBoard();
    const before = await r2Keys();
    const png = fixture('png-screenshot.png');
    const response = await upload(boardId, png);
    expect(response.status).toBe(201);
    const { assetKey, contentType } = (await response.json()) as { assetKey: string; contentType: string };
    expect(assetKey).toMatch(ASSET_KEY_PATTERN);
    expect(assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(contentType).toBe('image/png');

    const after = await r2Keys();
    const stored = after.find((key) => key.name === assetKey);
    expect(stored).toBeDefined();
    expect(after.length).toBe(before.length + 1);

    // The stored object serves back the sniffed contentType (listings in
    // Miniflare do not surface httpMetadata, so read it from the GET).
    const served = await fetch(`${base}/api/assets/${assetKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
  });

  it('TC-11 refuses never-created and malformed board ids; nothing stored (negative)', async () => {
    const before = await r2Keys();
    const neverCreated = await upload(newBoardId(), fixture('png-screenshot.png'));
    expect(neverCreated.status).toBe(404);
    const malformed = await upload('not-a-valid-board-id', fixture('png-screenshot.png'));
    expect(malformed.status).toBe(404);
    expect(await r2Keys()).toEqual(before);
  });

  it('TC-12 rejects IMAGE_MAX_BYTES + 1 and accepts exactly IMAGE_MAX_BYTES (boundary)', async () => {
    const boardId = await createBoard();
    const before = await r2Keys();
    const oversized = await upload(boardId, new Uint8Array(IMAGE_MAX_BYTES + 1));
    expect(oversized.status).toBe(413);
    expect(await r2Keys()).toEqual(before);

    const exact = await upload(boardId, fixture('exactly-10mb.jpg'));
    expect(exact.status).toBe(201);
    const { contentType } = (await exact.json()) as { contentType: string };
    expect(contentType).toBe('image/jpeg');
  });

  it('TC-13 refuses disguised files and SVG whatever Content-Type claims (negative, security)', async () => {
    const boardId = await createBoard();
    const before = await r2Keys();
    const disguisedPdf = await upload(boardId, fixture('renamed-pdf.png'), 'image/png');
    expect(disguisedPdf.status).toBe(415);
    const svg = await upload(boardId, fixture('injected.svg'), 'image/svg+xml');
    expect(svg.status).toBe(415);
    expect(await r2Keys()).toEqual(before);
  });

  it('TC-15 answers 500 when the storage put fails, writing nothing (error path)', async () => {
    const boardId = await createBoard();
    const before = await r2Keys();
    const armed = await fetch(`${base}/__test/fail-r2-put`, { method: 'POST' });
    expect(armed.status).toBe(200);
    const failed = await upload(boardId, fixture('png-screenshot.png'));
    expect(failed.status).toBe(500);
    expect(await r2Keys()).toEqual(before);

    // One-shot: the next upload succeeds, proving the hook only arms once.
    const ok = await upload(boardId, fixture('png-screenshot.png'));
    expect(ok.status).toBe(201);
  });
});

describe('assets.api serving', () => {
  it('TC-16 serves stored bytes immutable, with the sniffed Content-Type', async () => {
    const boardId = await createBoard();
    const stored = await upload(boardId, fixture('png-screenshot.png'));
    expect(stored.status).toBe(201);
    const { assetKey } = (await stored.json()) as { assetKey: string };

    const response = await fetch(`${base}/api/assets/${assetKey}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes).toEqual(fixture('png-screenshot.png'));
  });

  it('TC-16 404s missing keys and traversal attempts (negative)', async () => {
    const missing = await fetch(`${base}/api/assets/${newBoardId()}/${newBoardId()}`);
    expect(missing.status).toBe(404);
    const traversal = await fetch(`${base}/api/assets/%2e%2e%2fx`);
    expect(traversal.status).toBe(404);
    const short = await fetch(`${base}/api/assets/a/b`);
    expect(short.status).toBe(404);
  });
});
