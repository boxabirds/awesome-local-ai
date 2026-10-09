/**
 * Unit tests for the worker's asset handlers (story 12, TC-16 handler-level):
 * handleServe and handleUpload against stubbed R2/room bindings. This proves
 * the handler's own guards — in particular that a literal '../x' path is a
 * 404 — that the platform's dot-segment normalization would otherwise hide
 * at the wire level.
 */
import { describe, expect, it } from 'vitest';
import { handleServe, handleUpload, injectAssetPutFailureForTests } from '../../src/worker/assets';
import type { Env } from '../../src/worker/index';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';

const boardId = newBoardId();
const pngHead = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

interface StubObj {
  httpMetadata: { contentType: string };
  size: number;
  data: Uint8Array;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

function stubEnv(objects: Record<string, StubObj>, opts: { boardExists?: boolean; putFails?: boolean } = {}): {
  env: Env;
  puts: Array<{ key: string; bytes: ArrayBuffer; contentType: string }>;
} {
  const putFails = opts.putFails ?? false;
  const puts: Array<{ key: string; bytes: ArrayBuffer; contentType: string }> = [];
  const env = {
    ASSETS_BUCKET: {
      async get(key: string): Promise<StubObj | null> {
        const o = objects[key];
        if (o === undefined) return null;
        return { ...o, arrayBuffer: async () => o.data.buffer.slice(o.data.byteOffset, o.data.byteOffset + o.data.byteLength) };
      },
      async put(key: string, value: ArrayBuffer, opts: { httpMetadata: { contentType: string } }): Promise<void> {
        if (putFails) throw new Error('injected put failure');
        puts.push({ key, bytes: value, contentType: opts.httpMetadata.contentType });
      },
    },
    BOARD_ROOM: {
      idFromName: (id: string) => id,
      get: () => ({
        exists: async () => opts.boardExists ?? true,
      }),
    },
  } as unknown as Env;
  return { env, puts };
}

const pngBody = new Uint8Array([...pngHead, 1, 2, 3]);

describe('handleServe', () => {
  it('serves a stored object with immutable headers and the stored content type', async () => {
    const key = `${boardId}/${newBoardId()}`;
    const { env } = stubEnv({ [key]: { httpMetadata: { contentType: 'image/png' }, size: 4, data: pngBody } });
    const res = await handleServe(env, boardId, key.slice(boardId.length + 1));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe(
      `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
    );
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(pngBody);
  });

  it('404 for a missing object', async () => {
    const { env } = stubEnv({});
    const res = await handleServe(env, boardId, newBoardId());
    expect(res.status).toBe(404);
  });

  it('404 for traversal and malformed ids (the handler-level guarantee)', async () => {
    const { env } = stubEnv({ [`${boardId}/${newBoardId()}`]: { httpMetadata: { contentType: 'image/png' }, size: 4, data: pngBody } });
    expect((await handleServe(env, '..', 'x')).status).toBe(404);
    expect((await handleServe(env, boardId, '..')).status).toBe(404);
    expect((await handleServe(env, boardId, 'a-b-c'))).toBeDefined();
    expect((await handleServe(env, boardId, 'a-b-c')).status).toBe(404);
    expect((await handleServe(env, `../${'x'.repeat(21)}`, newBoardId())).status).toBe(404);
  });
});

describe('handleUpload', () => {
  it('201 for a valid PNG on an existing board; the put receives the sniffed type', async () => {
    const { env, puts } = stubEnv({}, { boardExists: true });
    const req = new Request('http://x/api/boards/whatever/assets', { method: 'POST', body: pngBody });
    const res = await handleUpload(req, env, boardId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.assetKey.startsWith(`${boardId}/`)).toBe(true);
    expect(body.contentType).toBe('image/png');
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(body.assetKey);
    expect(puts[0].contentType).toBe('image/png');
    expect(new Uint8Array(puts[0].bytes)).toEqual(pngBody);
  });

  it('413 above the limit (Content-Length and real length), 404 unknown board, 415 non-image, 500 on put failure', async () => {
    const over = new Uint8Array(IMAGE_MAX_BYTES + 1);
    over[0] = 0x89; over[1] = 0x50; over[2] = 0x4e; over[3] = 0x47;
    const reqOver = new Request('http://x/api/boards/x/assets', { method: 'POST', body: over });
    const { env: envA } = stubEnv({}, { boardExists: true });
    expect((await handleUpload(reqOver, envA, boardId)).status).toBe(413);

    const { env: envB } = stubEnv({}, { boardExists: false });
    const reqBoard = new Request('http://x/api/boards/x/assets', { method: 'POST', body: pngBody });
    expect((await handleUpload(reqBoard, envB, boardId)).status).toBe(404);

    const pdf = new TextEncoder().encode('%PDF-1.4\nwhatever');
    const reqPdf = new Request('http://x/api/boards/x/assets', { method: 'POST', body: pdf, headers: { 'content-type': 'image/png' } });
    const { env: envC } = stubEnv({}, { boardExists: true });
    expect((await handleUpload(reqPdf, envC, boardId)).status).toBe(415);

    const { env: envD } = stubEnv({}, { boardExists: true, putFails: true });
    const reqFail = new Request('http://x/api/boards/x/assets', { method: 'POST', body: pngBody });
    expect((await handleUpload(reqFail, envD, boardId)).status).toBe(500);
  });

  it('the injected fault seam (TC-15 path) also yields 500 and is clearable', async () => {
    const { env, puts } = stubEnv({}, { boardExists: true });
    injectAssetPutFailureForTests(new Error('injected R2 put failure'));
    try {
      const req = new Request('http://x/api/boards/x/assets', { method: 'POST', body: pngBody });
      expect((await handleUpload(req, env, boardId)).status).toBe(500);
    } finally {
      injectAssetPutFailureForTests(null);
    }
    const req2 = new Request('http://x/api/boards/x/assets', { method: 'POST', body: pngBody });
    expect((await handleUpload(req2, env, boardId)).status).toBe(201);
    expect(puts).toHaveLength(1);
  });
});
