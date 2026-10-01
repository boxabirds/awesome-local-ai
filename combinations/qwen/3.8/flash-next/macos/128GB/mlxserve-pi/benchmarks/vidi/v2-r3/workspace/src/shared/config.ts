// Shared product settings. Stories 2-5 add their own settings to this file.

/** Minimum zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies (or divides) the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * How far (in board units) the app is tested to pan from the starting point
 * without hitting an edge. Used by tests; the camera itself is unbounded.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note size in world (board) units; notes are square. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below it text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six selectable sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration -------------------------------------------

/**
 * Simultaneous editors the product is designed and tested for. This is a soft
 * capacity: it is never enforced (a 6th person joins normally), it is the
 * single named setting behind the capacity claims and the capacity tests.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** Change-delivery budget: sender screen -> every other screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Exponential backoff ceiling handed to the WebSocket provider (y-websocket). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used by the catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait in every e2e test. Wall-clock latency is measured and
 * logged against LIVE_UPDATE_LATENCY_BUDGET_MS there, never asserted: the
 * model, the browsers and the server all share one machine while testing.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Display names used for the swatch accessible labels (e.g. "Pink colour"). */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

// --- Story 4: persistence ---------------------------------------------------

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Or once the log's bytes reach this total.
 * keeps every stored row well under the platform per-row size limit.
 */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** The size of one snapshot chunk written to storage. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A LoadFailed room retries its load at most this often (persist.load_failure). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the product is tested at (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;

/** The open-time target for a saved board (PRD persist.large_board). Reported
 * by e2e, never asserted: the model, browsers and server share one machine.
 */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** The version of the storage tables (not the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: sharing a board by link --------------------------------------

/**
 * Creation budget (share.create): a click on "New board" must bring up the new
 * empty board within this many milliseconds on a typical broadband connection.
 * Reported and logged by e2e (TC-26), never asserted: the model, the browsers
 * and the server share one machine, so wall-clock timing here is not a
 * pass/fail signal.
 */
export const CREATE_BUDGET_MS = 2000;

/**
 * How long the "Link copied" confirmation stays up in the Share panel
 * (share.copy). Boundary values tested at LINK_COPIED_MS - 1 and exactly
 * LINK_COPIED_MS (TC-22).
 */
export const LINK_COPIED_MS = 2000;

/**
 * First backoff interval when a board link cannot reach the service while
 * opening it (share.unreachable). Doubles on each retry up to
 * RECONNECT_MAX_BACKOFF_MS (story 3), which is the ceiling.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
