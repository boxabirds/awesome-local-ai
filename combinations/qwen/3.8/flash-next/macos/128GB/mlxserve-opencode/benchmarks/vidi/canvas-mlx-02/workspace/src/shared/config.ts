// Product / navigation settings. Stories 2-5 add to this file.
// Changing these must not require a redesign elsewhere.

// Zoom limits (screen pixels per world unit).
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

// One zoom step multiplies/divides the zoom by this factor (buttons + Ctrl/Cmd +/-).
export const ZOOM_STEP_FACTOR = 1.25;

// Wheel/pinch zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Dot grid spacing in world units (screen spacing = GRID_SPACING_WORLD * zoom).
export const GRID_SPACING_WORLD = 24;

// How far a test pans from the start to prove the board is effectively unbounded.
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// zoomPercent = Math.round(zoom * ZOOM_PERCENT_SCALE).
export const ZOOM_PERCENT_SCALE = 100;

// A zoom value this close to ZOOM_STEP_FACTOR^n snaps exactly to that power,
// so a step in then out returns to exactly 1.0 (avoids float drift).
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Wheel deltaMode unit conversions to CSS pixels (named to avoid magic numbers).
export const WHEEL_DELTA_LINE_PX = 16; // one "line" unit in pixels
export const WHEEL_DELTA_PAGE_PX = 800; // one "page" unit in pixels

// --- Sticky notes (story 2) -------------------------------------------------

// Sticky note size in world units (a square note).
export const STICKY_SIZE_WORLD = 200;

// Hard limit on the number of characters kept in a note's text.
export const STICKY_TEXT_MAX_CHARS = 1000;

// The character counter shows only when the remaining characters are <= this.
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

// Text auto-fit range in CSS pixels (at 100% zoom, screen px == world units).
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;

// A pointer must move more than this many screen pixels to start a drag
// (a shorter press is a select, not a drag).
export const DRAG_THRESHOLD_PX = 3;

// The six selectable note colours. Names are stable product settings; the hex
// values may change without touching components.
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) ------------------------------------------

// Soft simultaneous-editor capacity: the design + test target the board is
// built and verified for. It is NEVER enforced — a 6th person joins normally.
export const MAX_CONCURRENT_EDITORS = 5;

// PRD live.propagate: change must reach every other screen within this budget
// (ms), measured on the sender's DOM update to the receiver's DOM update.
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

// Passed to WebsocketProvider as maxBackoffTime: the exponential reconnect
// backoff is capped at this many milliseconds.
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

// How long the green "Connected" confirmation badge is shown after a
// reconnection before it hides.
export const CONNECTED_CONFIRMATION_MS = 2000;

// The outage length used by the live.catch_up verification (PRD): disconnect
// one participant for this long while their page stays open.
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Persistence (story 4) --------------------------------------------------

// Compaction trigger: this many update rows that are not yet folded into a
// snapshot. Cross it and the room rewrites the snapshot in one transaction.
export const COMPACTION_UPDATE_COUNT = 500;

// Compaction trigger: this many bytes of un-compacted update log.
export const COMPACTION_BYTES = 2 * 1024 * 1024;

// The snapshot payload is stored as BLOB rows of at most this many bytes, so no
// single row holds a whole large board (TC-08 asserts more than one row for a
// board over this size).
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

// A room that failed to load its board answers new connections with close code
// 4500 until this long has passed since the failed read, so a client that
// reconnects quickly cannot hammer the failing storage read.
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

// The load-duration assertion used by the tests (TC-21): a board seeded with
// PERSIST_TESTED_NOTES notes must be fully rendered within this budget.
export const BOARD_LOAD_BUDGET_MS = 3_000;

// Number of notes the tested large board is seeded with.
export const PERSIST_TESTED_NOTES = 2_000;

// The storage layout version written by BoardStore.migrate(). Not the board's
// data version (board-model's schemaVersion lives in the Y.Doc) and not the app
// version.
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing by link (story 5) ----------------------------------------------

// How many boards ONE visitor may create per BOARD_CREATE_PERIOD_SECONDS.
// These two values are the product rule; `wrangler.jsonc`'s `ratelimits`
// binding must mirror them (TC-03 asserts the equality, because a drift would
// silently change the product rule while every test still passed).
export const BOARD_CREATE_LIMIT = 10;
export const BOARD_CREATE_PERIOD_SECONDS = 60;

// How many candidate ids one board creation may try before giving up. A try is
// only made against a code that is already taken (`share.unique`), so three is
// ample for 128-bit codes and bounds the work a single request can do.
export const CREATE_ID_MAX_ATTEMPTS = 3;

// PRD share.create: a new board must be open within this many ms.
export const CREATE_BUDGET_MS = 2000;

// How long the Share panel's button reads "Link copied".
export const LINK_COPIED_MS = 2000;

// First retry interval for the board page's existence check. Each retry
// doubles it, capped at RECONNECT_MAX_BACKOFF_MS (story 3), so a service that
// comes back is picked up without the person reloading.
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Multi-select, move, resize (story 7) -----------------------------------

// Resize handles on the selection's bounding box are this many SCREEN pixels,
// at any zoom (the overlay inverts the zoom so they stay this size).
export const HANDLE_SIZE_PX = 8;

// A sticky note may never be resized smaller than this many board (world)
// units on a side.
export const STICKY_MIN_SIZE_WORLD = 50;

// No board object may be resized larger than this many world units on a side.
export const MAX_OBJECT_SIZE_WORLD = 20_000;

// An arrow key nudges the selection this many world units.
export const NUDGE_STEP_WORLD = 1;

// Shift+arrow nudges this many world units.
export const NUDGE_LARGE_STEP_WORLD = 10;
