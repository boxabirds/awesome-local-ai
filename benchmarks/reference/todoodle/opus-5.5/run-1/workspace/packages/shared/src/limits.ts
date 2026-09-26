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

// ---------------------------------------------------------------- story 2: workspaces

/** Random bytes in a workspace secret (256 bits; base64url-encoded to 43 chars). */
export const WORKSPACE_SECRET_BYTES = 32;
/** Length of the base64url-encoded secret (no padding). */
export const WORKSPACE_SECRET_LENGTH = 43;
/** Name given to every new workspace. */
export const DEFAULT_WORKSPACE_NAME = 'My Todoodle';
/** Longest workspace name, after trimming. */
export const WORKSPACE_NAME_MAX = 120;

/** Name of the HttpOnly cookie that remembers this browser's workspaces (id + secret). */
export const REMEMBERED_COOKIE_NAME = 'tdl_ws';
/** Most workspaces the remembered cookie holds; the oldest is dropped beyond this. */
export const MAX_REMEMBERED_WORKSPACES = 50;
/** Remembered cookie lifetime: 400 days, the browser maximum. */
export const REMEMBERED_COOKIE_MAX_AGE_S = 34_560_000;

/** How long 'Name can't be empty' stays under the name field. */
export const NAME_HINT_MS = 2_500;
/** How long 'Copied' stays on the Share panel's Copy link button. */
export const COPY_CONFIRM_MS = 2_000;
/** Below this viewport width the Share panel becomes a full-width bottom sheet. */
export const MOBILE_BREAKPOINT_PX = 640;
/** Minimum height/width of tappable controls on touch devices. */
export const MIN_TOUCH_TARGET_PX = 44;
