import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { assetKeyFor, ASSET_KEY_PATTERN, sniffImageType } from '../shared/image-format';
import { getAssetStore } from './asset-store';
import type { Env } from './index';

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/boards/:boardId/assets
 *
 * Order of checks: board id pattern → exists() RPC → Content-Length > limit →
 * read body → byte length > limit → sniff magic bytes → R2 put.
 * Nothing is written on any error path.
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  // 1. Malformed board id → 404
  if (!isValidBoardId(boardId)) {
    return json(404, { error: 'not_found' });
  }

  // 2. Board must exist (story 5 existence rule)
  let exists = false;
  try {
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    const res = await stub.fetch(new Request('http://internal/exists', { method: 'POST' }));
    exists = res.status === 200;
  } catch {
    exists = false;
  }
  if (!exists) {
    return json(404, { error: 'not_found' });
  }

  // 3. Content-Length check (fast path, before reading the body)
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && Number(contentLength) > IMAGE_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }

  // 4. Read the whole body (≤ 10 MB by design) and re-check the real length
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return json(413, { error: 'too_large' });
  }
  if (bytes.length > IMAGE_MAX_BYTES) {
    return json(413, { error: 'too_large' });
  }

  // 5. Sniff the type from magic bytes only — never from the file name or
  //    the client's Content-Type (a renamed PDF or an SVG is refused here).
  const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) {
    return json(415, { error: 'unsupported_type' });
  }

  // 6. Store under an unguessable key (story 5 ids, 128 bits)
  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    if (env.TEST_HOOKS === '1' && req.headers.get('x-test-fail-r2') === '1') {
      throw new Error('simulated R2 storage failure');
    }
    await getAssetStore(env).put(assetKey, bytes, { httpMetadata: { contentType } });
  } catch {
    return json(500, { error: 'storage_failure' });
  }

  return json(201, { assetKey, contentType });
}

/**
 * GET /api/assets/:boardId/:assetId
 *
 * Immutable, nosniff, CSP-locked serving: a stored asset can never be
 * interpreted as anything other than an image.
 */
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return json(404, { error: 'not_found' });
  }
  let object: { body: ReadableStream | null; httpMetadata?: { contentType?: string } | null } | null;
  try {
    object = await getAssetStore(env).get(key);
  } catch {
    return json(500, { error: 'storage_failure' });
  }
  if (!object) {
    return json(404, { error: 'not_found' });
  }
  const contentType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
