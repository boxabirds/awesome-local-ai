import { CLIENT_HEADER, CLIENT_HEADER_VALUE, MAX_BODY_BYTES } from '@todoodle/shared/limits';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app';
import { type ErrorCode, errorResponse } from '../lib/errors';

export const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE']);
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
const JSON_MEDIA_TYPE = 'application/json';

export type ValidationResult =
  | { ok: true }
  | { ok: false; status: 403 | 405 | 413 | 415; code: ErrorCode };

/** True when the request declares a body: Content-Length > 0 or any Transfer-Encoding. */
export function hasBody(req: Request): boolean {
  if (req.headers.has('transfer-encoding')) return true;
  const length = Number(req.headers.get('content-length') ?? '0');
  return Number.isFinite(length) && length > 0;
}

/** Reads at most `limit + 1` bytes from a copy of the body and returns how many were read. */
async function boundedBodySize(req: Request, limit: number): Promise<number> {
  const body = req.clone().body;
  if (!body) return 0;
  const reader = body.getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return total;
      total += value.byteLength;
      if (total > limit) return total;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Rejects requests the API must never act on. Check order: method -> client header -> size ->
 * content type, so a bodyless mutation is never rejected for its (absent) content type.
 */
export async function validateRequest(req: Request): Promise<ValidationResult> {
  const method = req.method.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return { ok: false, status: 405, code: 'method_not_allowed' };
  }
  if (!MUTATING_METHODS.has(method)) return { ok: true };

  if (req.headers.get(CLIENT_HEADER) !== CLIENT_HEADER_VALUE) {
    return { ok: false, status: 403, code: 'forbidden_client' };
  }

  // Without a Content-Length (chunked), the body is measured by a bounded read. Any bytes found
  // that way also count as a body for the content-type rule below.
  const declaredLength = req.headers.get('content-length');
  const measured = declaredLength === null ? await boundedBodySize(req, MAX_BODY_BYTES) : 0;
  if (Number(declaredLength ?? measured) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: 'payload_too_large' };
  }

  if (hasBody(req) || measured > 0) {
    const mediaType = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== JSON_MEDIA_TYPE) {
      return { ok: false, status: 415, code: 'unsupported_media_type' };
    }
  }
  return { ok: true };
}

export const validate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await validateRequest(c.req.raw);
  if (!result.ok) return errorResponse(result.code, result.status);
  await next();
};
