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

/** Random bytes in a workspace secret (256 bits; base64url gives 43 characters). */
export const WORKSPACE_SECRET_BYTES = 32;

/** Most workspaces remembered in this browser's `tdl_ws` cookie; the oldest is dropped beyond it. */
export const MAX_REMEMBERED_WORKSPACES = 50;

/** Lifetime of the `tdl_ws` cookie (400 days, the browser maximum). */
export const REMEMBERED_COOKIE_MAX_AGE_S = 34_560_000;

/** Longest workspace name, after trimming. */
export const WORKSPACE_NAME_MAX = 120;

/** Name given to every new workspace. */
export const DEFAULT_WORKSPACE_NAME = 'My Todoodle';

/** How long 'Name can't be empty' stays under the name field. */
export const NAME_HINT_MS = 2_500;

/** How long 'Copied' stays on the Share panel's copy button. */
export const COPY_CONFIRM_MS = 2_000;

/** Minimum height and width of touch targets, in CSS pixels. */
export const MIN_TOUCH_TARGET_PX = 44;

/** Below this viewport width the layout switches to its phone form (bottom sheet, full-width buttons). */
export const MOBILE_BREAKPOINT_PX = 640;
