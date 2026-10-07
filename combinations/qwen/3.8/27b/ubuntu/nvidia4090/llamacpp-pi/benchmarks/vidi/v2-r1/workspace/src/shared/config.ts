// Product settings for vidi6. Every tunable product value lives here so it
// can be changed in one place without redesign (story 1 "Constraints").

// --- Board navigation (story 1) -------------------------------------------

/** Minimum zoom: 10% (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** The board must remain usable at least this far from the origin. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel deltaMode LINE is converted to pixels with this factor. */
export const WHEEL_DELTA_LINE_PX = 16;
/** Wheel deltaMode PAGE is converted to pixels with this factor. */
export const WHEEL_DELTA_PAGE_PX = 100;
/** Percentage shown for a zoom of 1. */
export const PERCENT_PER_UNIT = 100;
/** Step snapping: zoom is snapped to the nearest ZOOM_STEP_FACTOR^n within this relative epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// --- Sticky notes (story 2) -------------------------------------------------

/** Sticky note side length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters of text in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter is shown when at most this many characters remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size (px at 100% zoom; in world units so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) beyond which a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * The six note colours. Keys are the colour names used in the document
 * schema; values are the fills.
 */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) -------------------------------------------

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: changes appear within this many ms. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green badge duration after reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Board persistence (story 4) -------------------------------------------

/** Compact the update log once it holds this many rows. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once the log's bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Split snapshots into chunks of at most this many bytes, so every row stays
 *  far below the platform per-row size limit of SQLite-backed Durable Objects. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries loading at most this often (per new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: size of the board we test opening. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target for a board of that size (ms). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** PRD persist.broken_board: repair → recovered target (ms); logged, not asserted. */
export const BUDGET_RECOVERY_MS = 5000;
/** Version of the Durable Object storage schema (storage_meta row). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Multi-selection and transform gestures (story 7) -----------------------

/**
 * Square size (screen px) of the eight bounding-box resize handles.
 */
export const HANDLE_SIZE_PX = 8;
/**
 * Minimum side length (world units) of a sticky note; group resize clamps
 * at this (design section "Group resize" / PRD "Group resize with handles").
 */
export const STICKY_MIN_SIZE_WORLD = 50;
/**
 * Hard ceiling (world units) for any object's width or height: the group
 * scale is clamped so no object ever exceeds it (design section "Group
 * resize"; PRD "One consistent behaviour").
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/**
 * Arrow-key nudge step (world units) - independent of zoom (PRD
 * "Arrow-key nudge"; design constants NUDGE_STEP_WORLD / NUDGE_LARGE_STEP).
 */
export const NUDGE_STEP_WORLD = 1;
/**
 * Shift+arrow nudge step (world units).
 */
export const NUDGE_LARGE_STEP_WORLD = 10;


// --- Board sharing (story 5) -----------------------------------------------

/** PRD share.create: a new board must open within this time (ms) on a typical
 *  broadband connection. Reported in e2e, not asserted. */
export const CREATE_BUDGET_MS = 2000;
/** PRD share.copy: the "Link copied" confirmation is shown for this long (ms). */
export const LINK_COPIED_MS = 2000;
/** PRD share.unreachable: base backoff for the board existence check while the
 *  service cannot be reached; doubles per attempt, capped at
 *  RECONNECT_MAX_BACKOFF_MS (story 3). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
