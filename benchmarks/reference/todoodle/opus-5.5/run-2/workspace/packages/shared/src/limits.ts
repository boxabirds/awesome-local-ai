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

/** How long 'Name can't be empty' stays under the name field (workspace name and task name). */
export const NAME_HINT_MS = 3_000;

/** How long 'Copied' stays on the Share panel's copy button. */
export const COPY_CONFIRM_MS = 2_000;

/** Minimum height and width of touch targets, in CSS pixels. */
export const MIN_TOUCH_TARGET_PX = 44;

/**
 * Below this viewport width the workspace uses its phone layout (story 5): the sidebar becomes a
 * drawer behind a menu button and a floating add button appears. Tailwind `md`.
 */
export const MOBILE_BREAKPOINT_PX = 768;

/* Live updates (story 4). Socket loss only pauses live updates; it never means offline. */

/** Reconnect / offline-probe backoff: attempt n waits min(BASE * 2^n, MAX) +/- JITTER. */
export const LIVE_RECONNECT_BASE_MS = 1_000;
export const LIVE_RECONNECT_MAX_MS = 30_000;
export const LIVE_RECONNECT_JITTER = 0.2;

/** Client heartbeat: a `ping` every interval; no `pong` within one interval means the socket is dead. */
export const LIVE_PING_INTERVAL_MS = 20_000;

/** Continuous connecting/reconnecting time before the "Reconnecting…" pill shows. */
export const LIVE_PAUSED_AFTER_MS = 5_000;

/** Others' changes should appear within this time. */
export const LIVE_UPDATE_TARGET_MS = 5_000;

/** Largest serialised live event the broadcast helper sends. */
export const LIVE_MAX_EVENT_BYTES = 16_384;

/** WebSocket close codes. */
export const LIVE_CLOSE_NOT_FOUND = 4404;
export const LIVE_CLOSE_BAD_ORIGIN = 4403;

/** At most one screen-reader announcement of others' changes per window. */
export const LIVE_ANNOUNCE_THROTTLE_MS = 10_000;

/** After our own save, another person's change within this window is a conflict. */
export const CONFLICT_RECENT_EDIT_WINDOW_MS = 10_000;

/* Tasks (story 5). */

/** Longest task name and description, in UTF-16 code units (String.length), after trimming. */
export const TASK_NAME_MAX = 500;
export const TASK_DESCRIPTION_MAX = 5_000;

/** Gap between the sort_order of consecutive new tasks. */
export const TASK_SORT_STEP = 1;

/** Random bytes in a client-generated task id (32 lowercase hex characters). */
export const TASK_ID_BYTES = 16;

/** A length counter appears once a field reaches this share of its limit (ceil(limit * ratio)). */
export const LENGTH_WARNING_RATIO = 0.9;

/** Keyboard shortcuts: open quick add, and show the shortcuts panel. */
export const QUICK_ADD_KEY = 'q';
export const SHORTCUT_HELP_KEY = '?';

/** Placeholder rows shown while a task list loads for the first time. */
export const SKELETON_ROW_COUNT = 5;

/** Estimated row height for `contain-intrinsic-size` (off-screen rows skip layout). */
export const TASK_ROW_INTRINSIC_HEIGHT_PX = 44;

/** A length counter's screen-reader announcements are throttled to at most one per interval. */
export const COUNTER_ANNOUNCE_THROTTLE_MS = 1_000;

/** The quick-add description grows with its text up to this many lines, then scrolls. */
export const QUICK_ADD_MAX_DESCRIPTION_ROWS = 6;

/** A task create with no answer within this time is marked failed (Retry resends the same id). */
export const CREATE_TASK_TIMEOUT_MS = 10_000;

/* Task lifecycle (story 6). */

/**
 * How long Undo stays available after completing or deleting a task, in unpaused time (owner
 * decision 2026-09-25: 10 s, paused while the toast is hovered or focused).
 */
export const UNDO_WINDOW_MS = 10_000;

/** A completed task stays in the open list this long (ticked) before leaving; 0 under reduced motion. */
export const COMPLETE_ANIMATION_MS = 250;
