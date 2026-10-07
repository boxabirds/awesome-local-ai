// Named product settings for the board. Stories 2–5 add to this file.

/** Minimum zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;
/** Multiplicative step for the +/- buttons and keyboard shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Extent (world units) that must be pannable in any direction without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 2: sticky notes ---------------------------------------------------

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Hard limit on characters stored in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
/** Largest note font size (board units = CSS px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows and is clipped. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) that turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration --------------------------------------------

/**
 * Simultaneous-editor capacity this board is designed and tested for. It is a
 * soft target only: nothing in the Worker or the room counts participants, so a
 * 6th person is never refused (PRD live.over_capacity). Tests read this number
 * instead of a literal.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: change-delivery budget from sender screen to receiver screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound of the reconnect backoff handed to the websocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the offline catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test. Wall-clock latency inside this budget
 * is measured and logged, never asserted: the model, the browsers and the server
 * share one machine (see design "Timing in tests").
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Story 4: saving boards -------------------------------------------------

/** Compact the update log into a snapshot when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's stored bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot chunk size. Keeps every stored row well under the SQLite-backed
 * Durable Object per-row size limit.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries its load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size the PRD persist.large_board tests (and guarantees up to). */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: budget for showing a saved board after navigation. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the Durable Object storage tables (not the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: sharing a board by link ---------------------------------------

/** PRD share.create: budget from clicking New board to the empty board on screen. */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's "Link copied" confirmation stays up. */
export const LINK_COPIED_MS = 2000;
/**
 * PRD share.unreachable: first wait before re-checking a board link. It doubles on
 * every failed check, capped at `RECONNECT_MAX_BACKOFF_MS` (story 3).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: multi-select, transform ---------------------------------------

/** Resize handle size in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky note side in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest any object side can be in world units (global maximum). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;
