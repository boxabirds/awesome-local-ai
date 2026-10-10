import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES
} from '../shared/config';
import { ASSET_KEY_PATTERN, assetKeyFor, sniffImageType } from '../shared/image-format';
import type { Env } from './index';

function notFound(): Response {
  return new Response('Not found\n', { status: 404 });
}

// POST /api/boards/:boardId/assets — raw body, Content-Type ignored.
// Order (design): id pattern → exists() RPC → Content-Length → read body →
// byte length → magic-byte sniff → put. Nothing is ever written on an error;
// the body is read fully into memory (≤ 10 MB) so sniffing happens before
// anything is stored.
export async function handleUpload(
  request: Request,
  env: Env,
  boardId: string
): Promise<Response> {
  if (!isValidBoardId(boardId)) return notFound();
  const namespace = env.BOARD_ROOM;
  const exists = await namespace.get(namespace.idFromName(boardId)).exists();
  if (!exists) return notFound();

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    return new Response('Payload too large\n', { status: 413 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response('Payload too large\n', { status: 413 });
  }

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (contentType === null) {
    return new Response('Unsupported media type\n', { status: 415 });
  }

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, {
      httpMetadata: { contentType }
    });
  } catch {
    return new Response('Storage failure\n', { status: 500 });
  }
  return new Response(JSON.stringify({ assetKey, contentType }) + '\n', {
    status: 201,
    headers: { 'content-type': 'application/json' }
  });
}

// GET /api/assets/:boardId/:assetId — immutable because keys never change;
// nosniff and CSP default-src 'none' so a stored file can never execute.
export async function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) return notFound();
  const object = await env.ASSETS_BUCKET.get(key);
  if (object === null) return notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'"
    }
  });
}
