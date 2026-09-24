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
