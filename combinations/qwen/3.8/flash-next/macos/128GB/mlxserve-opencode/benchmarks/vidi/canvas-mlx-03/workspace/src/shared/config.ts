// All named product/settings constants for vidi6 live here.
// Stories 2-5 add to this file.

/** Minimum zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom level. */
export const ZOOM_MAX = 4;
/** Each zoom step multiplies/divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Pan distance (world units) that must remain reachable per PRD "No edges". */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Helper: clamp a value between min and max inclusive. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Number of percentage points per unit of zoom (100 for percent display). */
export const PERCENT_PER_UNIT = 100;

/**
 * Epsilon for snapping zoom steps to the nearest ZOOM_STEP_FACTOR^n.
 * Keeps "in then out" exact despite float drift.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/**
 * deltaMode conversion: pixels per unit for WHEEL deltaMode LINE.
 * One "line" is treated as a typical mouse-line scroll in CSS pixels.
 */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** deltaMode PAGE conversion: pixels per page unit. */
export const WHEEL_PAGE_HEIGHT_PX = 800;

// ---- Story 2: sticky notes -------------------------------------------------

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum note text length in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining chars <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size before text is clipped. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (CSS px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky note colours (name -> fill). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour a freshly created note starts with. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ---- Story 3: live collaboration -------------------------------------------

/**
 * Soft simultaneous-editor capacity: the number of people editing at once the
 * board is designed and tested for. Never enforced — a further joiner is never
 * refused, only the 1 s delivery guarantee stops applying beyond this number.
 * Tests use this setting rather than a hard-coded number (PRD live.capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** Change-delivery latency budget (ms) from sender screen to receiver screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound on the y-websocket provider's exponential reconnect backoff (ms). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Duration the green "Connected" confirmation badge shows after a reconnect (ms). */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the offline catch-up e2e test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---- Story 4: persistence ---------------------------------------------------

/** Compact the update log once this many rows exist (design persist.board_store). */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or once this many log bytes exist. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot chunk size. Kept well under the per-row size limit of SQLite-backed
 * Durable Objects so every row stays inside the platform limit.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A load-failed room retries loading its board at most this often (ms). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size tested for the large-board open guarantee (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** Time budget to show a PERSIST_TESTED_NOTES board (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version stamped into the storage tables so later stories can migrate them. */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Story 5: sharing a board by link --------------------------------------

/**
 * Boards one visitor may create per period (PRD share.rate_limit). Must match
 * the `BOARD_CREATE_LIMITER` binding in wrangler.jsonc — unit test TC-03 parses
 * that file and asserts equality so the two can never drift.
 */
export const BOARD_CREATE_LIMIT = 10;
/** Length of the creation-rate-limit period, in seconds. Also mirrored in wrangler.jsonc. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/**
 * How many board ids one create request may mint before giving up (share.unique).
 * A minted id that collides with an existing board is never handed out; the
 * creator tries again with a fresh random id, at most this many times.
 */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Time budget for "create a board and open it" (PRD share.create), in ms. */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's button reads "Link copied", in ms (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/**
 * How long to wait for the clipboard write before treating the browser as
 * uncooperative (share.copy_fallback). A clipboard call that never resolves —
 * some browsers leave it pending when the document lacks focus — must not leave
 * the Share panel waiting forever.
 */
export const CLIPBOARD_WRITE_TIMEOUT_MS = 1500;
/**
 * First delay before re-checking a board link whose check could not reach the
 * service (share.unreachable). Doubles per retry, capped at
 * RECONNECT_MAX_BACKOFF_MS — the same ceiling the websocket reconnect uses.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
