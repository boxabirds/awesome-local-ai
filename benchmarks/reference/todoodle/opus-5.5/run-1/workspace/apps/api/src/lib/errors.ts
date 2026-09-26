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
  internal: 'Something went wrong on our side.',
  method_not_allowed: 'This method is not allowed.',
  unsupported_media_type: 'Request bodies must be JSON (Content-Type: application/json).',
  payload_too_large: 'The request body is too large.',
};

/** JSON error body `{error, message}`. Never includes stack traces or request data. */
export function errorResponse(code: ErrorCode, status: number, message?: string): Response {
  return Response.json({ error: code, message: message ?? DEFAULT_MESSAGES[code] }, { status });
}
