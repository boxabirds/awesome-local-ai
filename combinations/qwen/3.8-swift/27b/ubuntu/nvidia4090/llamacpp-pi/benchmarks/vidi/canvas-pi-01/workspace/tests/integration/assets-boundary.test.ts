// The 10 MB size boundary (spec: assets.api, TC-12) lives in its own file:
// the miniflare R2 local runtime accumulates stored objects in the workerd
// process, and 10 MB bodies in the same runtime as the rest of the suite
// overflow it. A dedicated file gets a dedicated runtime.
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { IMAGE_MAX_BYTES } from '../../src/shared/config';
import worker from '../../src/worker';
import { jpegBytes } from '../fixtures/images';

function upload(boardId: string, body: Uint8Array, ip: string): Promise<Response> {
  return worker.fetch(
    new Request(`http://localhost/api/boards/${boardId}/assets`, {
      method: 'POST',
      body: body as unknown as BodyInit,
      headers: { 'CF-Connecting-IP': ip },
    }),
    env,
  );
}

async function createBoard(ip: string): Promise<string> {
  const res = await worker.fetch(
    new Request('http://localhost/api/boards', { method: 'POST', headers: { 'CF-Connecting-IP': ip } }),
    env,
  );
  if (res.status !== 201) throw new Error(`board create failed: ${res.status}`);
  return (await res.json()).id as string;
}

async function r2Keys(prefix: string): Promise<string[]> {
  const result = await env.ASSETS_BUCKET.list({ prefix });
  return result.objects.map((o) => o.key);
}

describe('asset size boundary (assets.api)', () => {
  it('TC-12: IMAGE_MAX_BYTES + 1 → 413 and nothing stored; exactly IMAGE_MAX_BYTES valid JPEG → 201 (boundary)', async () => {
    const boardId = await createBoard('10.9.12.1');
    const over = jpegBytes(IMAGE_MAX_BYTES + 1);
    const tooLarge = await upload(boardId, over, '10.9.12.2');
    expect(tooLarge.status).toBe(413);
    expect(await r2Keys(boardId)).toEqual([]);

    const exact = jpegBytes(IMAGE_MAX_BYTES);
    const res = await upload(boardId, exact, '10.9.12.3');
    expect(res.status).toBe(201);
    const keys = await r2Keys(boardId);
    expect(keys).toHaveLength(1);
    const object = await env.ASSETS_BUCKET.get(keys[0]!);
    expect(object!.httpMetadata?.contentType).toBe('image/jpeg');
    const stored = new Uint8Array(await object!.arrayBuffer());
    // Compare without a full deep-equal: a 10 MB toEqual allocates far too
    // much in this emulated runtime. Length + sampled bytes are enough here
    // (the workerd-side bytes are the same `exact` buffer the test sent).
    expect(stored.byteLength).toBe(exact.byteLength);
    for (const i of [0, 1, 2, 3, 100, 1 << 20, (1 << 20) - 1, exact.byteLength - 1]) {
      expect(stored[i]).toBe(exact[i]);
    }
  });
});
