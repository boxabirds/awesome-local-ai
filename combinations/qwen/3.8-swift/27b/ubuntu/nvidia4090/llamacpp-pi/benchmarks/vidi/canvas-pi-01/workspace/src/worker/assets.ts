// Asset upload and serving (see spec: assets.api).
//
// POST /api/boards/:boardId/assets
//   - board id must be well-formed (404) and the board must exist (404);
//   - per-visitor (CF-Connecting-IP) rate limit (429);
//   - body ≤ IMAGE_MAX_BYTES (413) — Content-Length first, actual bytes second;
//   - type sniffed from content bytes only (415) — never the client header,
//     so disguised files (PDF renamed .png, SVG with scripts) are refused;
//   - stored under `<boardId>/<assetId>` where assetId is story 5's 128-bit
//     newBoardId() (unguessable, like board links); 201 { assetKey, contentType }.
//   Nothing is written on any error path (the put happens last).
//
// GET /api/assets/:boardId/:assetId
//   - key must match ASSET_KEY_PATTERN (404 for traversal / malformed);
//   - 200 with the stored Content-Type, immutable caching (keys never
//     change) and nosniff + CSP so a stored file can never be interpreted
//     as anything but an image (assets.api security constraint).

import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
} from '../shared/config';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import {
  ASSET_KEY_PATTERN,
  assetKeyFor,
  sniffImageType,
  type AcceptedImageType,
} from '../shared/image-format';
import type { Env } from './index';

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}

/**
 * Upload handler. Order of checks (spec sequence): id pattern → rate limit →
 * exists() → Content-Length → read → byte length → sniff → put.
 */
export function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) {
    return Promise.resolve(json(404, { error: 'not_found' }));
  }
  const key = req.headers.get('CF-Connecting-IP') ?? 'unknown-visitor';
  return env.ASSET_UPLOAD_LIMITER.limit({ key }).then(({ success }) => {
    if (!success) {
      return json(429, { error: 'rate_limited' });
    }
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return stub.exists().then((exists) => {
      if (!exists) {
        return json(404, { error: 'not_found' });
      }
      const contentLength = Number(req.headers.get('Content-Length'));
      if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_BYTES) {
        return json(413, { error: 'too_large' });
      }
      return req.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength > IMAGE_MAX_BYTES) {
          return json(413, { error: 'too_large' });
        }
        const contentType = sniffImageType(bytes.subarray(0, IMAGE_SNIFF_BYTES));
        if (contentType === null) {
          return json(415, { error: 'unsupported_type' });
        }
        const assetKey = assetKeyFor(boardId, newBoardId());
        return env.ASSETS_BUCKET.put(assetKey, bytes, {
          httpMetadata: { contentType },
        })
          .then(() => json(201, { assetKey, contentType: contentType as AcceptedImageType }))
          .catch(() => json(500, { error: 'storage_failed' }));
      });
    });
  });
}

/**
 * Serve handler: pattern guard → R2 get → immutable, nosniff, CSP-locked
 * 200 (or 404 for a malformed/missing key — the client renders
 * "Image unavailable", image.unavailable).
 */
export function handleServe(env: Env, key: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(key)) {
    return Promise.resolve(json(404, { error: 'not_found' }));
  }
  return env.ASSETS_BUCKET.get(key).then((object) => {
    if (object === null) {
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
  });
}
