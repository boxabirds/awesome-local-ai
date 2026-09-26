// Shared numeric limits and constants. No magic numbers elsewhere: import from here.
// Later stories append their constants to this file.

/** Largest request body the API accepts (1 MB). Requests above this are rejected with 413. */
export const MAX_BODY_BYTES = 1_048_576;

/** Header every mutating request from the web client must carry (CSRF rule). */
export const CLIENT_HEADER_NAME = 'X-Todoodle-Client';
export const CLIENT_HEADER_VALUE = 'web';

/** Total publish attempts made by the release command before giving up. */
export const DEPLOY_RETRY_ATTEMPTS = 3;

/** Port the local dev server (wrangler dev) listens on; e2e tests target it. */
export const LOCAL_DEV_PORT = 8787;
