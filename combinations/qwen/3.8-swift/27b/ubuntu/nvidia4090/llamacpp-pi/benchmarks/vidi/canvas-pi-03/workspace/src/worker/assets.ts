/**
 * Story 12: image asset API (assets.api).
 *
 * POST /api/boards/:boardId/assets
 *   1. board id valid AND board exists (unknown/malformed → 404, no storage);
 *   2. the visitor (CF-Connecting-IP) is rate-limited to IMAGE_UPLOAD_LIMIT
 *      per IMAGE_UPLOAD_PERIOD_SECONDS (429 when exhausted);
 *   3. the body is at most IMAGE_MAX_BYTES (413);
 *   4. the content is sniffed by magic bytes — never the client header
 *      (image/png|jpeg|gif|webp only, else 415);
 *   5. stored in R2 under the immutable key `<boardId>/<assetId>` (22-char
 *      base64url each) with the sniffed content type; 201 { assetKey }.
 *
 * GET /api/assets/:boardId/:assetId
 *   serves the stored object with the sniffed Content-Type,
 *   `Cache-Control: public, max-age=ASSET_CACHE_MAX_AGE_SECONDS, immutable`
 *   and `X-Content-Type-Options: nosniff`.
 *
 * Local dev/tests run without the platform `ratelimits` binding and the R2
 * object is served from the real R2 binding (workerd emulates it), so both
 * fall back to the same local implementations create-board.ts uses.
 */
import {
  ASSET_CACHE_MAX_AGE_SECONDS,
  IMAGE_MAX_BYTES,
  IMAGE_SNIFF_BYTES,
  IMAGE_UPLOAD_LIMIT,
  IMAGE_UPLOAD_PERIOD_SECONDS,
} from 'src/shared/config';
import { newBoardId, isValidBoardId } from 'src/shared/board-id';
import { assetKeyFor, ASSET_KEY_PATTERN, sniffImageType } from 'src/shared/image-format';
import type { Env } from './index';
import type { Limiter } from './create-board';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Local-runtime fallback for the asset upload limiter (same fixed-window
 * shape as create-board's; local workerd has no `ratelimits` binding).
 */
function localAssetLimiter(): Limiter {
  const periodMs = IMAGE_UPLOAD_PERIOD_SECONDS * 1000;
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit({ key }) {
      const now = Date.now();
      const window_ = windows.get(key);
      if (!window_ || now - window_.start >= periodMs) {
        windows.set(key, { start: now, count: 1 });
        return { success: true };
      }
      if (window_.count >= IMAGE_UPLOAD_LIMIT) return { success: false };
      window_.count += 1;
      return { success: true };
    },
  };
}

let fallbackLimiter: Limiter | null = null;
function assetLimiter(env: Env): Limiter {
  if (env.ASSET_UPLOAD_LIMITER) return env.ASSET_UPLOAD_LIMITER;
  if (!fallbackLimiter) fallbackLimiter = localAssetLimiter();
  return fallbackLimiter;
}

/**
 * Handles POST /api/boards/:boardId/assets. The board must already exist:
 * images are per-board private assets (assets.private).
 */
export async function handleUpload(req: Request, env: Env, boardId: string): Promise<Response> {
  if (!isValidBoardId(boardId)) return json({ error: 'not_found' }, 404);

  const exists = await boardExists(env, boardId);
  if (!exists) return json({ error: 'not_found' }, 404);

  const visitorKey = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const { success } = await assetLimiter(env).limit({ key: visitorKey });
  if (!success) return json({ error: 'rate_limited' }, 429);

  const declared = req.headers.get('Content-Length');
  if (declared !== null && Number(declared) > IMAGE_MAX_BYTES) {
    return json({ error: 'too_large' }, 413);
  }
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength > IMAGE_MAX_BYTES) return json({ error: 'too_large' }, 413);

  const contentType = sniffImageType(body.subarray(0, IMAGE_SNIFF_BYTES));
  if (!contentType) return json({ error: 'unsupported_type' }, 415);

  const assetKey = assetKeyFor(boardId, newBoardId());
  try {
    await env.ASSETS_BUCKET.put(assetKey, body, { httpMetadata: { contentType } });
  } catch {
    return json({ error: 'store_failed' }, 500);
  }
  return json({ assetKey, contentType }, 201);
}

/**
 * Handles GET /api/assets/:boardId/:assetId. Only keys matching
 * ASSET_KEY_PATTERN are looked up — traversal and malformed keys 404.
 */
export async function handleServe(env: Env, assetKey: string): Promise<Response> {
  if (!ASSET_KEY_PATTERN.test(assetKey)) return json({ error: 'not_found' }, 404);
  let obj;
  try {
    obj = await env.ASSETS_BUCKET.get(assetKey);
  } catch {
    return json({ error: 'not_found' }, 404);
  }
  if (!obj) return json({ error: 'not_found' }, 404);
  const contentType = obj.httpMetadata?.contentType ?? 'application/octet-stream';
  return new Response(obj.body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function boardExists(env: Env, boardId: string): Promise<boolean> {
  try {
    const stub = env.BOARD_ROOM.get(env.BOARD_ROOM.idFromName(boardId));
    return await stub.exists();
  } catch {
    return false;
  }
}

/**
 * Test-only R2 inspection ops (enabled only when TEST_HOOKS === '1', i.e. the
 * test/e2e wrangler configs — never in production): inspect(key),
 * list(prefix), deletePrefix(prefix).
 */
export async function handleAssetTestOp(req: Request, env: Env, op: string): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { key?: string; prefix?: string };
  try {
    if (op === 'inspect') {
      const obj = await env.ASSETS_BUCKET.get(body.key ?? '');
      if (!obj) return json({ exists: false });
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      const hex = Array.from(digest)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return json({
        exists: true,
        contentType: obj.httpMetadata?.contentType ?? null,
        byteLength: bytes.length,
        sha256: hex,
      });
    }
    if (op === 'list') {
      const { objects } = await env.ASSETS_BUCKET.list({ prefix: body.prefix ?? '' });
      return json({ keys: objects.map((o) => o.key) });
    }
    if (op === 'deletePrefix') {
      const { objects } = await env.ASSETS_BUCKET.list({ prefix: body.prefix ?? '' });
      await env.ASSETS_BUCKET.delete(objects.map((o) => o.key));
      return json({ ok: true, deleted: objects.length });
    }
    return json({ error: 'unknown_op' }, 400);
  } catch {
    return json({ error: 'op_failed' }, 500);
  }
}
