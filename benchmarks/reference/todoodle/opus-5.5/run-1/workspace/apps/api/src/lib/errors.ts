export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden_client'
  | 'gone'
  | 'internal'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large'
  | 'upgrade_required';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  validation: 'The request is not valid.',
  not_found: 'Not found.',
  forbidden_client: 'This request must come from the Todoodle app.',
  gone: 'This no longer exists.',
  internal: 'Something went wrong on our side.',
  method_not_allowed: 'This method is not allowed.',
  unsupported_media_type: 'Request bodies must be JSON (Content-Type: application/json).',
  payload_too_large: 'The request body is too large.',
  upgrade_required: 'This endpoint only accepts WebSocket upgrades.',
};

/** JSON error body `{error, message}`. Never includes stack traces or request data. */
export function errorResponse(code: ErrorCode, status: number, message?: string): Response {
  return Response.json({ error: code, message: message ?? DEFAULT_MESSAGES[code] }, { status });
}

/**
 * The one 404 body for every workspace miss (unknown, malformed or deleted secret; failed auth).
 * A module-level constant so all misses are byte-identical and reveal nothing.
 */
export const WORKSPACE_NOT_FOUND_BODY = JSON.stringify(Object.freeze({ error: 'not_found', message: 'Workspace not found' }));

export function workspaceNotFound(): Response {
  return new Response(WORKSPACE_NOT_FOUND_BODY, { status: 404, headers: { 'Content-Type': 'application/json' } });
}

/** The only fields the API ever logs about a request. Never bodies, cookies, headers or query strings. */
export type RequestLogEntry = {
  requestId: string;
  method: string;
  pathname: string;
  status: number;
  errorName?: string;
  /** The error's own message (story 1 requires it for diagnosis). Handlers never put request data in messages. */
  errorMessage?: string;
};

/** Sanitised logger: copies only the whitelisted fields, so nothing else can slip into the log. */
export function logRequestError(entry: RequestLogEntry): void {
  const { requestId, method, pathname, status, errorName, errorMessage } = entry;
  console.error('request failed', { requestId, method, pathname, status, errorName, errorMessage });
}
