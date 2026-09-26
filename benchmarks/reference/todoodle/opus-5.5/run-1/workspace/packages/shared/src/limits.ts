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
/** Below this viewport width dialogs (the Share panel) become full-width bottom sheets (Tailwind `sm`). */
export const SHEET_BREAKPOINT_PX = 640;
/** Minimum height/width of tappable controls on touch devices. */
export const MIN_TOUCH_TARGET_PX = 44;

// ---------------------------------------------------------------- story 4: live updates
// (LIVE_OFFLINE_AFTER_MS is retired: losing the live socket no longer means offline.)

/** Header carrying the web client's per-tab id, so each tab can ignore live echoes of its own changes. */
export const CLIENT_ID_HEADER_NAME = 'X-Todoodle-Client-Id';
/** Live frames are applied once per animation frame; this fallback flushes them if the frame never comes. */
export const LIVE_FRAME_FALLBACK_MS = 100;
/** Reconnect backoff: attempt n waits min(BASE * 2^n, MAX) ± JITTER. Also paces offline health probes. */
export const LIVE_RECONNECT_BASE_MS = 1_000;
/** Longest wait between reconnect attempts (and between offline probes). */
export const LIVE_RECONNECT_MAX_MS = 30_000;
/** Backoff jitter as a fraction: each wait is scaled by a random factor in [1 - J, 1 + J]. */
export const LIVE_RECONNECT_JITTER = 0.2;
/** How often the client pings the live socket; no pong within one interval means the socket is dead. */
export const LIVE_PING_INTERVAL_MS = 20_000;
/** Heartbeat frames. The Durable Object answers them without waking (auto-response). */
export const LIVE_PING = 'ping';
export const LIVE_PONG = 'pong';
/** Target: others' changes appear within this long (prd.live_updates). */
export const LIVE_UPDATE_TARGET_MS = 5_000;
/** After our own save, another person's change within this window still raises a conflict notice. */
export const CONFLICT_RECENT_EDIT_WINDOW_MS = 10_000;
/** Largest serialised live event; bigger events are rejected by broadcast and logged. */
export const LIVE_MAX_EVENT_BYTES = 16_384;
/** WebSocket close code: the workspace is not found (terminal, never retried). */
export const LIVE_CLOSE_NOT_FOUND = 4404;
/** WebSocket close code: bad origin. */
export const LIVE_CLOSE_BAD_ORIGIN = 4403;
/** Screen-reader summaries of others' changes are announced at most once per this interval. */
export const LIVE_ANNOUNCE_THROTTLE_MS = 10_000;
/** The 'Reconnecting…' pill shows once live updates have been down continuously this long. */
export const LIVE_PAUSED_AFTER_MS = 5_000;

// ---------------------------------------------------------------- story 5: tasks and quick add

/** Longest task name, in UTF-16 code units after trimming (String.length, the same on client and server). */
export const TASK_NAME_MAX = 500;
/** Longest task description, in UTF-16 code units after trimming. */
export const TASK_DESCRIPTION_MAX = 5_000;
/** A new task goes this far after the workspace's current largest sort_order (newest last). */
export const TASK_SORT_STEP = 1;
/** Random bytes in a client-generated task id (lowercase hex, 32 chars: the same format as server ids). */
export const TASK_ID_BYTES = 16;
/** Length counters appear once a field reaches this fraction of its limit (450 for names, 4,500 for descriptions). */
export const LENGTH_WARNING_RATIO = 0.9;
/** At most one screen-reader announcement per this interval from a length counter. */
export const COUNTER_ANNOUNCE_THROTTLE_MS = 1_000;
/** The quick-add description grows with its text up to this many lines, then scrolls. */
export const QUICK_ADD_MAX_DESCRIPTION_ROWS = 6;
/** A create request that has not answered after this long is abandoned and the row marked failed. */
export const CREATE_TASK_TIMEOUT_MS = 10_000;
/** Placeholder rows shown while a task list loads for the first time. */
export const SKELETON_ROW_COUNT = 5;
/** Height the browser assumes for an off-screen task row (content-visibility: auto). */
export const TASK_ROW_INTRINSIC_HEIGHT_PX = 44;
/** Opens quick add from anywhere in the workspace (not while typing in a field). */
export const QUICK_ADD_KEY = 'q';
/** Opens the keyboard shortcuts panel. */
export const SHORTCUT_HELP_KEY = '?';
/** Below this viewport width the phone layout applies: sidebar in a drawer, floating add button (Tailwind `md`). */
export const MOBILE_BREAKPOINT_PX = 768;
