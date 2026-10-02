// tests/integration/assets.test.ts
// TC-10: POST real PNG to existing board → 201
// TC-11: POST to never-created board / malformed id → 404
// TC-12: POST IMAGE_MAX_BYTES + 1 → 413; exactly IMAGE_MAX_BYTES → 201
// TC-13: POST PDF with Content-Type image/png / POST SVG → 415
// TC-15: R2 put throws → 500
// TC-16: GET stored key → 200 with headers; GET missing → 404; GET '../x' → 404

import { describe, it, expect } from 'vitest';
import { handleUpload, handleServe } from '../../src/worker/assets';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';

// Minimal valid PNG bytes (1x1)
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

// Minimal valid JPEG bytes
const JPEG_BYTES = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
  'base64'
);

function makeEnv(overrides?: {
  exists?: boolean;
  putThrows?: boolean;
  storedObjects?: Map<string, { data: ArrayBuffer; contentType: string }>;
}) {
  const stored = overrides?.storedObjects ?? new Map<string, { data: ArrayBuffer; contentType: string }>();
  const putCalls: { key: string; contentType: string }[] = [];

  const env: any = {
    ASSETS_BUCKET: {
      put: async (key: string, value: any, options?: any) => {
        if (overrides?.putThrows) throw new Error('R2 put failed');
        putCalls.push({ key, contentType: options?.httpMetadata?.contentType ?? '' });
        stored.set(key, { data: value, contentType: options?.httpMetadata?.contentType ?? '' });
      },
      get: async (key: string) => {
        const obj = stored.get(key);
        if (!obj) return null;
        return {
          arrayBuffer: async () => obj.data,
          httpMetadata: { contentType: obj.contentType },
        };
      },
      list: async () => ({ objects: [...stored.keys()].map((key) => ({ key })) }),
    },
    BOARD_ROOM: {
      idFromName: (name: string) => ({ toString: () => name }),
      get: () => ({
        exists: async () => overrides?.exists ?? true,
      }),
    },
  };

  return { env, putCalls, stored };
}

function makeRequest(body: ArrayBuffer | Uint8Array, contentType = 'application/octet-stream'): Request {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  return new Request('http://localhost/api/boards/test/assets', {
    method: 'POST',
    body: bytes as unknown as ArrayBuffer,
    headers: { 'content-type': contentType },
  });
}

describe('assets.api integration', () => {
  // TC-10: POST real PNG to existing board → 201; R2 object exists with contentType image/png; key matches pattern
  it('TC-10: POST PNG to existing board returns 201 with valid key', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: true });
    const req = makeRequest(PNG_BYTES);

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(201);

    const data = (await res.json()) as { assetKey: string; contentType: string };
    expect(data.assetKey).toBeDefined();
    expect(data.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(data.assetKey)).toBe(true);

    // R2 object exists
    expect(stored.has(data.assetKey)).toBe(true);
    const storedObj = stored.get(data.assetKey)!;
    expect(storedObj.contentType).toBe('image/png');
  });

  // TC-11: POST to never-created board / malformed id → 404; R2 list empty
  it('TC-11: POST to non-existent board returns 404, nothing stored', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: false });
    const req = makeRequest(PNG_BYTES);

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(404);
    expect(stored.size).toBe(0);
  });

  it('TC-11: POST with malformed board id returns 404', async () => {
    const { env, stored } = makeEnv({ exists: true });
    const req = makeRequest(PNG_BYTES);

    const res = await handleUpload(req, env, 'not-a-valid-id!');
    expect(res.status).toBe(404);
    expect(stored.size).toBe(0);
  });

  // TC-12: POST IMAGE_MAX_BYTES + 1 → 413; exactly IMAGE_MAX_BYTES → 201
  it('TC-12: POST over-limit file returns 413, nothing stored', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: true });

    // Create a body of IMAGE_MAX_BYTES + 1 bytes (starts with PNG magic)
    const overLimit = new Uint8Array(IMAGE_MAX_BYTES + 1);
    overLimit.set(PNG_BYTES);
    const req = makeRequest(overLimit);

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(413);
    expect(stored.size).toBe(0);
  });

  it('TC-12: POST exactly IMAGE_MAX_BYTES valid JPEG returns 201', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: true });

    // Create a body of exactly IMAGE_MAX_BYTES bytes (starts with JPEG magic)
    const exact = new Uint8Array(IMAGE_MAX_BYTES);
    exact.set(JPEG_BYTES);
    const req = makeRequest(exact);

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(201);
    expect(stored.size).toBe(1);
  });

  // TC-13: POST PDF with Content-Type image/png → 415; POST SVG → 415
  it('TC-13: POST PDF with Content-Type image/png returns 415, nothing stored', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: true });

    const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
    const req = makeRequest(pdfBytes, 'image/png'); // Wrong content type header

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(415);
    expect(stored.size).toBe(0);
  });

  it('TC-13: POST SVG returns 415, nothing stored', async () => {
    const boardId = newBoardId();
    const { env, stored } = makeEnv({ exists: true });

    const svgBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const req = makeRequest(svgBytes, 'image/svg+xml');

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(415);
    expect(stored.size).toBe(0);
  });

  // TC-15: R2 put throws → 500
  it('TC-15: R2 put failure returns 500', async () => {
    const boardId = newBoardId();
    const { env } = makeEnv({ exists: true, putThrows: true });
    const req = makeRequest(PNG_BYTES);

    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(500);
  });

  // TC-16: GET stored key → 200 with headers; GET missing → 404; GET '../x' → 404
  it('TC-16: GET stored key returns 200 with correct headers', async () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    const key = `${boardId}/${assetId}`;

    const { env } = makeEnv({
      storedObjects: new Map([[key, { data: PNG_BYTES.buffer, contentType: 'image/png' }]]),
    });

    const res = await handleServe(env, key);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(res.headers.get('cache-control')).toContain('max-age=31536000');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
  });

  it('TC-16: GET missing key returns 404', async () => {
    const boardId = newBoardId();
    const assetId = newBoardId();
    const key = `${boardId}/${assetId}`;

    const { env } = makeEnv({ storedObjects: new Map() });

    const res = await handleServe(env, key);
    expect(res.status).toBe(404);
  });

  it("TC-16: GET '../x' returns 404", async () => {
    const { env } = makeEnv({ storedObjects: new Map() });

    const res = await handleServe(env, 'a1b2c3d4e5f6g7h8i9j0k1/../x');
    expect(res.status).toBe(404);
  });
});
