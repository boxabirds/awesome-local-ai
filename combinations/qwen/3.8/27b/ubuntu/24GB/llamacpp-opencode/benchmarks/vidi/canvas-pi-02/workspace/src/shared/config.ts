/**
 * Product settings shared across the app. Stories 2-5 add to this file.
 */

/** Minimum board zoom: 10% of the default (100%) scale. */
export const ZOOM_MIN = 0.1;

/** Maximum board zoom: 400% of the default (100%) scale. */
export const ZOOM_MAX = 4;

/** Multiplicative step applied by the zoom buttons and Ctrl/Cmd +/- shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a Ctrl/Cmd+wheel event = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Farthest distance (in world units) that navigation is verified to stay exact. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes (story 2) -----------------------------------------------

/** Side length of a sticky note, in world units. Notes are square. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows once the note is within this many characters of STICKY_TEXT_MAX_CHARS. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size (world px, at 100% zoom), for short text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size; below this, overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky note colours, keyed by product name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) -----------------------------------------

/** Soft capacity: the number of simultaneous editors the product is designed and tested for. Never enforced (a 6th person is not turned away). */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD `live.propagate`: a change must appear on every other screen within this budget, measured sender-side to receiver-side. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to the y-websocket provider's `maxBackoffTime`: longest pause between reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays visible after a reconnection before it hides. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD `live.catch_up` verification: the outage length used by the catch-up tests. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Board persistence (story 4) ------------------------------------------

/** Compact the update log when this many rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** ... or when the log's total bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Snapshot chunk row size: keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A LoadFailed room retries its load at most this often (new connections before the interval are closed 4500 without a reload attempt). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** PRD `persist.large_board`: the board size persistence is tested at. */
export const PERSIST_TESTED_NOTES = 2000;

/** PRD `persist.large_board`: a saved board of PERSIST_TESTED_NOTES notes must open within this. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the storage tables (storage_meta.storage_schema_version). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing (story 5) -------------------------------------------------------

/** Maximum boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS. */
export const BOARD_CREATE_LIMIT = 10;

/** Rate-limit window for board creation (must match wrangler.jsonc ratelimits). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** How many times createBoard retries when it hits an id collision. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create: board creation budget in ms. */
export const CREATE_BUDGET_MS = 2000;

/** How long "Link copied" stays visible on the Share panel button. */
export const LINK_COPIED_MS = 2000;

/** Base backoff for board existence check retries (doubles each attempt). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Multi-select, group move / resize / nudge / delete (story 7) ----------

/** Small keyboard nudge step, world units (Arrow keys). */
export const NUDGE_STEP_WORLD = 1;

/** Large keyboard nudge step, world units (Shift+Arrow). */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** A note resized by a group gesture never shrinks below this (world units). */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Group resize never grows any object above this (world units). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Screen-space size of a resize handle (its world-space size is `1 / zoom`). */
export const HANDLE_SIZE_PX = 8;

// --- Per-user undo / redo (story 8) -----------------------------------------

/** Typing pause (ms) that ends a burst: own keystrokes closer together merge into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Undo steps kept per user; the oldest step is dropped beyond this (undo.limit). */
export const UNDO_MAX_STEPS = 200;
