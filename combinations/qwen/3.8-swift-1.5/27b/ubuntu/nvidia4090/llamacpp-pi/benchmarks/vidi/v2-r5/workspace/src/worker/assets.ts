// src/worker/assets.ts
// R2 asset upload and serving handlers.

import { sniffImageType, ASSET_KEY_PATTERN, assetKeyFor } from '../shared/image-format';
import { IMAGE_MAX_BYTES, IMAGE_SNIFF_BYTES, ASSET_CACHE_MAX_AGE_SECONDS } from '../shared/config';
import { isValidBoardId } from '../shared/board-id';
import { newBoardId } from '../shared/board-id';

export interface AssetsEnv {
  ASSETS_BUCKET: {
    put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<void>;
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
    list(opts?: { prefix?: string }): Promise<{ objects: { key: string }[] }>;
  };
  BOARD_ROOM: {
    idFromName(name: string): { toString(): string };
    get(id: { toString(): string }): {
      exists(): Promise<boolean>;
    };
  };
}

/**
 * Handles POST /api/boards/:boardId/assets
 */
export async function handleUpload(req: Request, env: AssetsEnv, boardId: string): Promise<Response> {
  // 1. Validate board id pattern
  if (!isValidBoardId(boardId)) {
    return json404();
  }

  // 2. Check board exists via Durable Object RPC
  let exists = false;
  try {
    const id = env.BOARD_ROOM.idFromName(boardId);
    const stub = env.BOARD_ROOM.get(id);
    exists = await stub.exists();
  } catch {
    return json404();
  }
  if (!exists) {
    return json404();
  }

  // 3. Check Content-Length
  const contentLength = req.headers.get('content-length');
  if (contentLength !== null) {
    const cl = parseInt(contentLength, 10);
    if (Number.isFinite(cl) && cl > IMAGE_MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'too_large' }), {
        status: 413,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  // 4. Read body
  let body: ArrayBuffer;
  try {
    body = await req.arrayBuffer();
  } catch {
    return new Response(JSON.stringify({ error: 'read_failed' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 5. Check actual byte length
  if (body.byteLength > IMAGE_MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'too_large' }), {
      status: 413,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 6. Sniff type from magic bytes
  const head = new Uint8Array(body, 0, Math.min(IMAGE_SNIFF_BYTES, body.byteLength));
  const contentType = sniffImageType(head);
  if (!contentType) {
    return new Response(JSON.stringify({ error: 'unsupported_type' }), {
      status: 415,
      headers: { 'content-type': 'application/json' },
    });
  }

  // 7. Store in R2
  const assetId = newBoardId();
  const key = assetKeyFor(boardId, assetId);

  try {
    await env.ASSETS_BUCKET.put(key, body, {
      httpMetadata: { contentType },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'storage_failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ assetKey: key, contentType }),
    {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }
  );
}

/**
 * Handles GET /api/assets/:boardId/:assetId
 */
export async function handleServe(env: AssetsEnv, key: string): Promise<Response> {
  // Validate key pattern
  if (!ASSET_KEY_PATTERN.test(key)) {
    return new Response('Not Found', { status: 404 });
  }

  let obj: { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null;
  try {
    obj = await env.ASSETS_BUCKET.get(key);
  } catch {
    return new Response('Not Found', { status: 404 });
  }

  if (!obj) {
    return new Response('Not Found', { status: 404 });
  }

  const bytes = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';

  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    },
  });
}

function json404(): Response {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
