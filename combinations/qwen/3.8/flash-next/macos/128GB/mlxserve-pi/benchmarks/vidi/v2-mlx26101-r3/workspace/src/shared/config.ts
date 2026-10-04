/**
 * Product settings for vidi6, in one place (stories 2-5 add to this file).
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd + scroll and pinch sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid lines, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values are snapped to the nearest ZOOM_STEP_FACTOR^n within this relative epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier that turns a zoom level into the displayed whole-number percentage. */
export const PERCENT = 100;

/** WheelEvent.deltaMode values. */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/** Pixels per line for wheel events reported in lines. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Dot-grid dot radius in screen pixels (does not scale with zoom). */
export const GRID_DOT_RADIUS_PX = 1;

/* Sticky notes (story 2). -------------------------------------------------- */

/** A sticky note is a square of this many board (world) units. */
export const STICKY_SIZE_WORLD = 200;
/** Space between the note's edge and its text, in board units (text box = size - 2x). */
export const STICKY_PADDING_WORLD = 12;
/** Hard limit on the characters of text a note holds. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears once this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (24 px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows into a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel before a press on a note becomes a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * The six note colours, in toolbar order. The key is the name stored in the document
 * (and later on the wire), the value the fill colour.
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
/** New notes are yellow. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* Live collaboration (story 3). --------------------------------------------- */

/**
 * Simultaneous-editor capacity the product is designed and tested for. Soft: it is a
 * design and test target and is never enforced - a 6th person joins like anyone else.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** How long a change is allowed to take to reach every other screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts; handed to the websocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length the catch-up test uses (live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/* Persistence (story 4). ----------------------------------------------------- */

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once the log rows reach this many bytes, whichever comes first. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Size of a snapshot chunk. Keeps every stored row well under the per-row size limit of
 * SQLite-backed Durable Objects (measured locally at 2,000,000 bytes; see NOTES.md).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room that failed to load its board retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** The board size the product is tested at (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** How long a saved board of PERSIST_TESTED_NOTES notes may take to show (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the room's storage tables; written once into `storage_meta`. */
export const STORAGE_SCHEMA_VERSION = 1;

/* Sharing a board (story 5). -------------------------------------------------- */

/**
 * How long creating a board may take from the click on New board to the empty board being
 * on screen (share.create). Reported by the e2e run, not asserted: the model, the browsers
 * and the server all share one machine.
 */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's "Link copied" confirmation stays up (share.copy). */
export const LINK_COPIED_MS = 2000;
/**
 * First wait before a board-link check is tried again; each further failure doubles it, up to
 * {@link RECONNECT_MAX_BACKOFF_MS} (share.unreachable).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/**
 * Functional wait used by every e2e test. Latency is measured and logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted here: the model, the browsers and the
 * server all share one machine, so wall-clock timing there is not a pass/fail signal.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
