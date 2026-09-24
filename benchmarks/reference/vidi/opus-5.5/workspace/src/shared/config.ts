/**
 * Named product settings. Change values here only; every consumer imports them.
 */

/** Minimum zoom (screen px per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative zoom change per button click / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd-wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ---- Sticky notes (story 2) ----

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters (UTF-16 code units) in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note text size, in world px (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note text size, in world px; below this text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) after which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six note colours, in toolbar order. */
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

// ---- Live collaboration (story 3) ----

/** Soft capacity: the number of simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other connected screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Length of the network outage in the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---- Persistence (story 4) ----

/** Compact the update log into a snapshot when this many log rows exist... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot rows are at most this big. Cloudflare documents a 2 MB maximum string/BLOB/row size
 * for SQLite-backed Durable Objects (checked 2026-09); this stays far below it.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose saved board could not be loaded retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Largest board size tested and guaranteed to open within BOARD_LOAD_BUDGET_MS (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** A board of PERSIST_TESTED_NOTES notes shows all of them within this time of navigating (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the room's SQLite tables (the Yjs document has its own meta.schemaVersion). */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Sharing (story 5) ----

/** Boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window. Must match wrangler.jsonc `ratelimits` (unit test TC-03 asserts equality). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** New ids tried before board creation gives up (a collision of 128-bit ids is practically impossible). */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** A new board opens within this time of clicking Create a board (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long the Copy link button says "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Multi-select, move, resize (story 7) ----

/** Side of each selection resize handle in screen px (the same at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest width/height a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width/height any object can be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow key nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Undo and redo (story 8) ----

/** A typing pause of at least this long ends one undo step (burst) and starts the next. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Each person's undo history keeps at most this many steps; the oldest is dropped first. */
export const UNDO_MAX_STEPS = 200;
