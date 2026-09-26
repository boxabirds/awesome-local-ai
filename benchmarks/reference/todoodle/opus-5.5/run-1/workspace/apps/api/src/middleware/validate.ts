import { CLIENT_HEADER_NAME, CLIENT_HEADER_VALUE, MAX_BODY_BYTES } from '@todoodle/shared/limits';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.ts';
import { type ErrorCode, errorResponse } from '../lib/errors.ts';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const JSON_MEDIA_TYPE = 'application/json';

export type ValidationResult =
  | { ok: true }
  | { ok: false; status: 403 | 405 | 413 | 415; code: ErrorCode };

/** True when the request carries a body: Content-Length > 0 or any Transfer-Encoding. */
export function hasBody(req: Request): boolean {
  const contentLength = req.headers.get('content-length');
  return (contentLength !== null && Number(contentLength) > 0) || req.headers.has('transfer-encoding');
}

/**
 * Rejects requests before any handler runs. Check order: method -> client header -> size -> content type,
 * so a bodyless mutation is never rejected for its (absent) content type.
 * The body is measured on a clone, so handlers can still read it.
 */
export async function validateRequest(req: Request): Promise<ValidationResult> {
  const method = req.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return { ok: false, status: 405, code: 'method_not_allowed' };
  if (!MUTATING_METHODS.has(method)) return { ok: true };

  if (req.headers.get(CLIENT_HEADER_NAME) !== CLIENT_HEADER_VALUE) {
    return { ok: false, status: 403, code: 'forbidden_client' };
  }
  if (!hasBody(req)) return { ok: true };

  if ((await declaredOrMeasuredSize(req)) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large' };
  }

  const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (mediaType !== JSON_MEDIA_TYPE) return { ok: false, status: 415, code: 'unsupported_media_type' };

  return { ok: true };
}

async function declaredOrMeasuredSize(req: Request): Promise<number> {
  const declared = Number(req.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared >= 0) return declared;
  return measureBody(req.clone(), MAX_BODY_BYTES);
}

/** Reads the body until it ends or exceeds `limit` bytes, then stops (returns at most limit + one chunk). */
async function measureBody(req: Request, limit: number): Promise<number> {
  const reader = req.body?.getReader();
  if (!reader) return 0;
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return total;
    }
  }
}

export const validate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await validateRequest(c.req.raw);
  if (!result.ok) return errorResponse(result.code, result.status);
  await next();
};
