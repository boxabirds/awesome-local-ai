/**
 * Story 12 — Asset upload and serving handlers.
 *
 * POST /api/boards/:boardId/assets → uploads an image to R2
 * GET  /api/assets/:boardId/:assetId → serves a stored image
 */
import { isValidBoardId } from '@/shared/board-id';
import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '@/shared/image-format';
import { IMAGE_MAX_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '@/shared/config';

// Minimal env interface for this module only
export interface AssetsEnv {
  ASSETS_BUCKET: R2Bucket;
  BOARD_ROOM: any;
}


/**
 * Handle an image upload request.
 * Verifies: board existence, size limit, magic-byte type sniffing, stores to R2.
 */
export async function handleUpload(
  req: Request,
  env: AssetsEnv,
  boardId: string,
): Promise<Response> {
  // Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify board exists via BoardRoom RPC
  try {
    const room = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    const exists = await room.exists();
    if (!exists) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check Content-Length before reading body
  const contentLength = req.headers.get('Content-Length');
  if (contentLength !== null && parseInt(contentLength, 10) > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Read full body into memory for type sniffing
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await req.arrayBuffer());
  } catch {
    return new Response(JSON.stringify({ error: 'read_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Second size check on actual byte length
  if (bytes.length > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Sniff type from magic bytes
  const sniffedType = sniffImageType(bytes);
  if (!sniffedType) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate unique asset key using newBoardId
  const { newBoardId } = await import('@/shared/board-id');
  const assetId = newBoardId();
  const assetKey = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(assetKey, bytes, {
      httpMetadata: { contentType: sniffedType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ assetKey, contentType: sniffedType }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Handle serving a stored image.
 * Returns immutable cache headers, nosniff, and CSP to prevent execution.
 */
export async function handleServe(
  env: AssetsEnv,
  key: string,
): Promise<Response> {
  // Validate key format
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Prevent directory traversal
  if (key.includes('../') || key.includes('..\\')) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const obj = await env.ASSETS_BUCKET.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ error: 'not_found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
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
