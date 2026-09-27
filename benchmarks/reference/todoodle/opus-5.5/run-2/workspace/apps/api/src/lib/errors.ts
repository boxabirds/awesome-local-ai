export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'forbidden_client'
  | 'gone'
  | 'internal'
  | 'method_not_allowed'
  | 'unsupported_media_type'
  | 'payload_too_large';

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  validation: 'The request is not valid.',
  not_found: 'Not found.',
  forbidden_client: 'This request must come from the Todoodle app.',
  gone: 'This no longer exists.',
  internal: 'Something went wrong on our side. Please try again.',
  method_not_allowed: 'This method is not allowed here.',
  unsupported_media_type: 'Request bodies must be JSON (Content-Type: application/json).',
  payload_too_large: 'The request is too large.',
};

/** JSON error body `{ error, message }`. Never includes stack traces or request data. */
export function errorResponse(code: ErrorCode, status: number, message?: string): Response {
  return Response.json({ error: code, message: message ?? DEFAULT_MESSAGES[code] }, { status });
}

/** The one body every workspace miss returns (open and auth), so misses are byte-identical. */
export const WORKSPACE_NOT_FOUND_BODY = JSON.stringify(
  Object.freeze({ error: 'not_found', message: 'Workspace not found' }),
);

export function workspaceNotFound(): Response {
  return new Response(WORKSPACE_NOT_FOUND_BODY, {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The only fields the API ever logs. Never bodies, cookies, headers, query strings or fragments. */
export type RequestErrorLog = {
  requestId: string;
  method: string;
  pathname: string;
  status: number;
  errorName: string;
  errorMessage: string;
};

/**
 * Sanitised error logger: every API log line goes through here. `pathname` must be the path only
 * (no query string); the error message is kept because it is written by our code or the platform,
 * never copied from the request.
 */
export function logRequestError(entry: RequestErrorLog): void {
  console.error('request failed', {
    requestId: entry.requestId,
    method: entry.method,
    pathname: entry.pathname,
    status: entry.status,
    errorName: entry.errorName,
    errorMessage: entry.errorMessage,
  });
}
