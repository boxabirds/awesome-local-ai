import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import worker from '../../src/worker/index';
import { FAKE_PDF, SCRIPT_SVG, TINY_PNG, jpegOfSize } from '../fixtures/images/inline';

const imageBytes = (name: string) => ({ 'small.png': TINY_PNG, 'not-an-image.png': FAKE_PDF, 'script.svg': SCRIPT_SVG })[name]!;
const jpegAtLimit = () => jpegOfSize(IMAGE_MAX_BYTES);
const jpegOverLimit = () => jpegOfSize(IMAGE_MAX_BYTES + 1);

const HOST = 'http://example.com';

async function newBoard(): Promise<string> {
  const res = await SELF.fetch(`${HOST}/api/boards`, { method: 'POST' });
  return ((await res.json()) as { id: string }).id;
}
const post = (boardId: string, body: BodyInit, type = 'application/octet-stream') =>
  SELF.fetch(`${HOST}/api/boards/${boardId}/assets`, { method: 'POST', body, headers: { 'Content-Type': type } });
const stored = async (boardId: string) => (await env.ASSETS_BUCKET.list({ prefix: `${boardId}/` })).objects;

describe('asset API (assets.api)', () => {
  it('TC-10 stores a real PNG with its sniffed content type under an unguessable key', async () => {
    const id = await newBoard();
    const res = await post(id, imageBytes('small.png'), 'text/plain');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${id}/`)).toBe(true);
    const object = await env.ASSETS_BUCKET.head(body.assetKey);
    expect(object?.httpMetadata?.contentType).toBe('image/png');
  });

  it('TC-11 never-created and malformed board ids → 404 and nothing stored', async () => {
    const unknown = newBoardId();
    expect((await post(unknown, imageBytes('small.png'))).status).toBe(404);
    expect((await post('bad-id', imageBytes('small.png'))).status).toBe(404);
    expect(await stored(unknown)).toHaveLength(0);
  });

  it('TC-12 one byte over the limit → 413 and nothing stored; exactly the limit → 201', async () => {
    const id = await newBoard();
    expect((await post(id, jpegOverLimit())).status).toBe(413);
    expect(await stored(id)).toHaveLength(0);
    expect((await post(id, jpegAtLimit())).status).toBe(201);
    expect(await stored(id)).toHaveLength(1);
  });

  it('TC-13 a PDF declared as image/png and an SVG with a script → 415, nothing stored', async () => {
    const id = await newBoard();
    expect((await post(id, imageBytes('not-an-image.png'), 'image/png')).status).toBe(415);
    expect((await post(id, imageBytes('script.svg'), 'image/svg+xml')).status).toBe(415);
    expect(await stored(id)).toHaveLength(0);
  });

  it('TC-15 a failing bucket put → 500', async () => {
    const id = await newBoard();
    const failing = {
      ...env, BOARD_ROOM: env.BOARD_ROOM,
      ASSETS_BUCKET: { put: async () => { throw new Error('r2 down'); } },
    } as never;
    const res = await worker.fetch(
      new Request(`${HOST}/api/boards/${id}/assets`, { method: 'POST', body: imageBytes('small.png') }), failing,
    );
    expect(res.status).toBe(500);
  });

  it('TC-16 serves stored bytes as an immutable, non-sniffable, script-proof image; unknown and malformed keys → 404', async () => {
    const id = await newBoard();
    const { assetKey } = (await (await post(id, imageBytes('small.png'))).json()) as { assetKey: string };
    const res = await SELF.fetch(`${HOST}/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe(`public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(imageBytes('small.png'));
    expect((await SELF.fetch(`${HOST}/api/assets/${id}/${newBoardId()}`)).status).toBe(404);
    expect((await SELF.fetch(`${HOST}/api/assets/..%2Fx`)).status).toBe(404);
    expect((await SELF.fetch(`${HOST}/api/assets/${id}/../x`)).status).toBe(404);
  });
});
