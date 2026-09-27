/**
 * Shared numeric limits and tunables (architecture section 9).
 * No magic numbers elsewhere: import from here. Later stories append.
 */

/** Largest request body the API accepts, in bytes (1 MB). */
export const MAX_BODY_BYTES = 1_048_576;

/** Header every mutating request must carry (CSRF defence). */
export const CLIENT_HEADER = 'X-Todoodle-Client';
export const CLIENT_HEADER_VALUE = 'web';

/** Total publish attempts made by the release command. */
export const DEPLOY_RETRY_ATTEMPTS = 3;

/** Local dev server origin used by wrangler dev and Playwright. */
export const DEV_SERVER_HOST = '127.0.0.1';
export const DEV_SERVER_PORT = 8787;
