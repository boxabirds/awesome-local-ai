import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import { ASSET_KEY_PATTERN } from '../../src/shared/image-format';
import worker from '../../src/worker/index';

// workerd has no real file system: synthesize bodies with the right magic bytes.
const bytes = (head: number[], total = 64) => {
  const b = new Uint8Array(total);
  b.set(head);
  return b;
};
const text = (s: string) => new TextEncoder().encode(s);
const FIXTURES: Record<string, Uint8Array> = {
  'small.png': bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'photo.jpg': bytes([0xff, 0xd8, 0xff, 0xe0], 256),
  'renamed-pdf.png': text('%PDF-1.4\n%%EOF\n'),
  'script.svg': text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
};
const fixture = async (n: string) => FIXTURES[n];

async function newBoard(): Promise<string> {
  const res = await exports.default.fetch('http://example.com/api/boards', { method: 'POST' });
  return ((await res.json()) as { id: string }).id;
}
const upload = (id: string, body: BodyInit, type = 'application/octet-stream') =>
  exports.default.fetch(`http://example.com/api/boards/${id}/assets`, { method: 'POST', body, headers: { 'content-type': type } });
const stored = async () => (await env.ASSETS_BUCKET.list()).objects.length;

describe('assets API', () => {
  it('TC-10: a PNG is stored with its sniffed type and an unguessable key', async () => {
    const id = await newBoard();
    const before = await stored();
    const res = await upload(id, await fixture('small.png'), 'text/plain');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assetKey: string; contentType: string };
    expect(body.contentType).toBe('image/png');
    expect(ASSET_KEY_PATTERN.test(body.assetKey)).toBe(true);
    expect(body.assetKey.startsWith(`${id}/`)).toBe(true);
    const obj = await env.ASSETS_BUCKET.head(body.assetKey);
    expect(obj?.httpMetadata?.contentType).toBe('image/png');
    expect(await stored()).toBe(before + 1);
  });

  it('TC-11: unknown and malformed boards are 404 and store nothing', async () => {
    const before = await stored();
    const png = await fixture('small.png');
    expect((await upload(newBoardId(), png)).status).toBe(404);
    expect((await upload('short', png)).status).toBe(404);
    expect(await stored()).toBe(before);
  });

  it('TC-12: IMAGE_MAX_BYTES + 1 is 413, exactly IMAGE_MAX_BYTES of a JPEG is 201', async () => {
    const id = await newBoard();
    const before = await stored();
    const over = new Uint8Array(IMAGE_MAX_BYTES + 1);
    over.set([0xff, 0xd8, 0xff]);
    expect((await upload(id, over)).status).toBe(413);
    expect(await stored()).toBe(before);
    const exact = new Uint8Array(IMAGE_MAX_BYTES);
    exact.set([0xff, 0xd8, 0xff]);
    expect((await upload(id, exact)).status).toBe(201);
  });

  it('TC-13: a renamed PDF and an SVG are 415 and never stored', async () => {
    const id = await newBoard();
    const before = await stored();
    expect((await upload(id, await fixture('renamed-pdf.png'), 'image/png')).status).toBe(415);
    expect((await upload(id, await fixture('script.svg'), 'image/svg+xml')).status).toBe(415);
    expect(await stored()).toBe(before);
  });

  it('TC-15: a failing R2 put is 500', async () => {
    const id = await newBoard();
    const failing = { ...env, ASSETS_BUCKET: { put: async () => { throw new Error('boom'); } } } as unknown as typeof env;
    const res = await worker.fetch(
      new Request(`http://example.com/api/boards/${id}/assets`, { method: 'POST', body: await fixture('small.png') }),
      failing,
    );
    expect(res.status).toBe(500);
  });

  it('TC-16: stored assets are served as images only, immutable; missing and malformed keys are 404', async () => {
    const id = await newBoard();
    const { assetKey } = (await (await upload(id, await fixture('photo.jpg'))).json()) as { assetKey: string };
    const res = await exports.default.fetch(`http://example.com/api/assets/${assetKey}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(await fixture('photo.jpg'));
    const missing = await exports.default.fetch(`http://example.com/api/assets/${id}/${'z'.repeat(22)}`);
    expect(missing.status).toBe(404);
    expect((await exports.default.fetch('http://example.com/api/assets/..%2Fx/y')).status).toBe(404);
    expect((await exports.default.fetch('http://example.com/api/assets/x')).status).toBe(404);
  });
});
