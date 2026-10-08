import { sniffImageType, ASSET_KEY_PATTERN } from '../shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';

/** Runtime env as seen by Worker handlers */
export interface AssetsEnv {
  BOARD_ROOM?: {
    get(name: string): { initialize(): Promise<'created' | 'exists'>; exists(): boolean };
    idFromName(name: string): string;
  };
  ASSETS_BUCKET?: R2Bucket;
}

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Handle POST /api/boards/:boardId/assets upload */
export async function handleUpload(
  request: Request,
  env: AssetsEnv,
  boardId: string,
): Promise<Response> {
  // Validate board id format
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  // Check board exists via RPC
  if (env.BOARD_ROOM) {
    try {
      const namespace = env.BOARD_ROOM;
      const roomId = namespace.idFromName(boardId);
      const room = namespace.get(roomId);
      const exists = await room.exists();
      if (!exists) {
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      }
    } catch {
      return new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 });
    }
  } else {
    // No BOARD_ROOM binding — allow uploads for testing
  }

  // Check Content-Length before reading body
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });
  }

  // Read body
  const bytes = await request.arrayBuffer();
  const uint8 = new Uint8Array(bytes);

  // Byte length check
  if (uint8.length > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), { status: 413 });
  }

  // Sniff image type
  const head = uint8.slice(0, Math.min(uint8.length, 12));
  const detectedType = sniffImageType(head);
  if (!detectedType || !ACCEPTED_TYPES.includes(detectedType)) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), { status: 415 });
  }

  // Store in R2
  if (!env.ASSETS_BUCKET) {
    return new Response(JSON.stringify({ error: 'storage_not_configured' }), { status: 500 });
  }

  try {
    const assetId = newBoardId();
    const key = `${boardId}/${assetId}`;
    await env.ASSETS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: detectedType },
    });
    return new Response(JSON.stringify({ assetKey: key, contentType: detectedType }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failure' }), { status: 500 });
  }
}

/** Handle GET /api/assets/:boardId/:assetId serve */
export async function handleServe(
  request: Request,
  env: AssetsEnv,
  key: string,
): Promise<Response> {
  // Validate key format
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response(JSON.stringify({ error: 'bad_key' }), { status: 404 });
  }

  if (!env.ASSETS_BUCKET) {
    return new Response(JSON.stringify({ error: 'storage_not_configured' }), { status: 404 });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'");

  return new Response(obj.body, {
    status: 200,
    headers,
  });
}
