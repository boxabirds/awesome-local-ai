/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { newBoardId } from '@shared/board-id';
import { IMAGE_MAX_BYTES } from '@shared/config';
import { ASSET_KEY_PATTERN } from '@shared/image-format';

// Inline fixtures (fs not available in Workers test env)
const PNG_FIXTURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

const SVG_FIXTURE = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

const PDF_FIXTURE = new TextEncoder().encode('%PDF-1.4 fake pdf content for testing');

async function createBoardId(): Promise<string> {
  const post = await SELF.fetch('http://localhost/api/boards', { method: 'POST' });
  expect(post.status).toBe(201);
  const { id } = (await post.json()) as { id: string };
  return id;
}

// TC-10: POST real PNG to existing board -> 201, R2 object exists with contentType image/png
describe('TC-10: POST real PNG to existing board', () => {
  it('returns 201 with valid assetKey; R2 object has correct contentType; key matches pattern', async () => {
    const boardId = await createBoardId();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_FIXTURE,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { assetKey: string; contentType: string };
    expect(data.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(data.assetKey)).toBe(true);
    expect(data.assetKey.startsWith(boardId + '/')).toBe(true);

    // Verify R2 object exists with correct metadata
    const r2Obj = await env.ASSETS_BUCKET.get(data.assetKey);
    expect(r2Obj).not.toBeNull();
    expect(r2Obj!.httpMetadata?.contentType).toBe('image/png');
  });
});

// TC-11: POST to never-created board id -> 404; malformed id -> 404; nothing in R2
describe('TC-11: POST to unknown or malformed board returns 404', () => {
  it('returns 404 for never-created valid board id', async () => {
    const boardId = newBoardId();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_FIXTURE,
    });
    expect(res.status).toBe(404);

    // Nothing stored for this board
    const listed = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    expect(listed.objects).toHaveLength(0);
  });

  it('returns 404 for malformed board id', async () => {
    const res = await SELF.fetch(`http://localhost/api/boards/abc/assets`, {
      method: 'POST',
      body: PNG_FIXTURE,
    });
    expect(res.status).toBe(404);
  });
});

// TC-12: POST over limit -> 413 nothing stored; exactly IMAGE_MAX_BYTES valid -> 201
describe('TC-12: size limit enforcement', () => {
  it('returns 413 for IMAGE_MAX_BYTES + 1 and stores nothing', async () => {
    const boardId = await createBoardId();
    const total = IMAGE_MAX_BYTES + 1;
    const body = new Uint8Array(total);
    body.set(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG magic

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body,
    });
    expect(res.status).toBe(413);

    const listed = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    expect(listed.objects).toHaveLength(0);
  });

  it('returns 201 for exactly IMAGE_MAX_BYTES valid JPEG', async () => {
    const boardId = await createBoardId();
    const total = IMAGE_MAX_BYTES;
    const body = new Uint8Array(total);
    body.set(new Uint8Array([0xff, 0xd8, 0xff])); // JPEG magic

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body,
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { assetKey: string; contentType: string };
    expect(data.contentType).toBe('image/jpeg');
  });
});

// TC-13: POST renamed PDF and SVG -> 415, nothing stored
describe('TC-13: rejects disguised and SVG files', () => {
  it('returns 415 for PDF renamed to .png with Content-Type image/png', async () => {
    const boardId = await createBoardId();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PDF_FIXTURE,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(res.status).toBe(415);

    const listed = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    expect(listed.objects).toHaveLength(0);
  });

  it('returns 415 for SVG', async () => {
    const boardId = await createBoardId();

    const res = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: SVG_FIXTURE,
      headers: { 'Content-Type': 'image/svg+xml' },
    });
    expect(res.status).toBe(415);

    const listed = await env.ASSETS_BUCKET.list({ prefix: boardId + '/' });
    expect(listed.objects).toHaveLength(0);
  });
});

// TC-15: R2 put throws -> 500
describe('TC-15: storage failure returns 500', () => {
  it('returns 500 when R2 put fails', async () => {
    const { handleUpload } = await import('../../src/worker/assets');

    const mockEnv = {
      BOARD_ROOM: {
        idFromName: (name: string) => name,
        get: () => ({ exists: async () => true }),
      },
      ASSETS_BUCKET: {
        put: async () => {
          throw new Error('injected R2 failure');
        },
      },
    } as unknown as Parameters<typeof handleUpload>[1];

    const req = new Request('http://localhost/api/boards/test/assets', {
      method: 'POST',
      body: PNG_FIXTURE,
    });

    const boardId = newBoardId();
    const res = await handleUpload(req, mockEnv, boardId);
    expect(res.status).toBe(500);
  });
});

// TC-16: GET stored key -> 200 with headers; GET missing -> 404; GET malformed -> 404
describe('TC-16: serving assets', () => {
  it('GET stored key returns 200 with correct headers', async () => {
    const boardId = await createBoardId();

    const postRes = await SELF.fetch(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: PNG_FIXTURE,
    });
    expect(postRes.status).toBe(201);
    const { assetKey } = (await postRes.json()) as { assetKey: string };

    const getRes = await SELF.fetch(`http://localhost/api/assets/${assetKey}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('Content-Type')).toBe('image/png');
    expect(getRes.headers.get('Cache-Control')).toMatch(/immutable/);
    expect(getRes.headers.get('Cache-Control')).toMatch(/max-age=31536000/);
    expect(getRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getRes.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
  });

  it('GET missing key returns 404', async () => {
    const id1 = newBoardId();
    const id2 = newBoardId();
    const res = await SELF.fetch(`http://localhost/api/assets/${id1}/${id2}`);
    expect(res.status).toBe(404);
  });

  it('GET malformed key (too short) returns 404', async () => {
    const res = await SELF.fetch(`http://localhost/api/assets/a/b`);
    expect(res.status).toBe(404);
  });
});
