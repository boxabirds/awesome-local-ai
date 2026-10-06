/**
 * Product settings for vidi6.
 *
 * All magic numbers live here so they can be changed in one place without a
 * redesign. Stories 2+ add their settings to this file.
 */

// ---- Board camera (story 1) ----------------------------------------------

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative step used by the +/- buttons and Ctrl/Cmd +/- keys. */
export const ZOOM_STEP_FACTOR = 1.25;
/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Epsilon used when a stepped zoom is snapped to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Camera zoom -> percentage label multiplier. */
export const PERCENT = 100;

/** Wheel deltaMode=LINE (DOM lines) converted to CSS pixels. */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Wheel deltaMode=PAGE (one page) converted to CSS pixels. */
export const WHEEL_PAGE_DELTA_PIXELS = 800;

// ---- Rendering (story 1) -------------------------------------------------

/** Radius of a dot-grid dot, in CSS pixels (screen space). */
export const GRID_DOT_RADIUS_SCREEN = 1.5;
/** Dot-grid dot colour. */
export const GRID_DOT_COLOR = "#c3c8cf";
/** Size of the origin crosshair marker, in world units. */
export const ORIGIN_MARKER_SIZE_WORLD = 16;

// ---- Sticky notes (story 2) ----------------------------------------------

/** Sticky note width and height, in board (world) units. */
export const STICKY_SIZE_WORLD = 200;
/** Longest text a note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in board units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size before text starts to overflow. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement that separates a click-select from a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours. */
export const STICKY_COLORS = {
  yellow: "#FFF59D",
  orange: "#FFCC80",
  green: "#C5E1A5",
  blue: "#90CAF9",
  pink: "#F48FB1",
  violet: "#CE93D8",
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

export const DEFAULT_STICKY_COLOR: StickyColor = "yellow";

/** Blue selection outline drawn around the selected note. */
export const SELECTION_OUTLINE_COLOR = "#2563eb";
/** Padding between the note edge and its text, in board units. */
export const STICKY_TEXT_PADDING_WORLD = 12;
/** Height/width of the text box inside a note (derived from the two above). */
export const STICKY_TEXT_BOX_WORLD = STICKY_SIZE_WORLD - 2 * STICKY_TEXT_PADDING_WORLD;

// ---- Selecting and transforming objects (story 7) ----------------------

/** Edge length of a resize handle, in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Transparent padding around a handle that still counts as hitting it. */
export const HANDLE_HIT_PAD_PX = 6;
/** Smallest side a sticky note may be resized to, in board units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest side any board object may reach, in board units (all types). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** One arrow-key nudge, in board units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift + arrow-key nudge, in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;
/** Fill of the Shift+drag selection rectangle (light blue, translucent). */
export const MARQUEE_FILL_COLOR = "rgba(96, 165, 250, 0.25)";
/** Border of the selection rectangle. */
export const MARQUEE_BORDER_COLOR = "#3b82f6";
/** Border of the bounding box drawn around a multi-object selection. */
export const SELECTION_BOX_COLOR = "#2563eb";

// ---- Live collaboration (story 3) ---------------------------------------

/**
 * Soft capacity: the number of simultaneous editors the board is designed and
 * tested for. Never enforced — a 6th person joins and edits like anyone else.
 * Tests read this setting instead of a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: how fast a change must reach every other screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to `WebsocketProvider.maxBackoffTime`: the reconnect backoff ceiling. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** The interruption length used by the catch-up tests (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story. Wall-clock latency is
 * measured and logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted:
 * the model, the browsers and the server share one machine here.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// ---- Persistence (story 4) ------------------------------------------------

/** Compaction trigger: compact when this many update-log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's byte total reaches this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot rows are kept under this size, which is far below the per-row size
 * limit of SQLite-backed Durable Objects (see NOTES.md: the limit was
 * re-checked against the current documentation during implementation).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed board retries its load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;
/** PRD persist.large_board: the board size the persistence tests are built for. */
export const PERSIST_TESTED_NOTES = 2_000;
/** PRD persist.large_board: how long opening such a board may take. */
export const BOARD_LOAD_BUDGET_MS = 3_000;
/** Version of the room's storage tables (not of the board document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Sharing a board (story 5) -------------------------------------------

/**
 * PRD share.create: New board must land the person on an empty board within
 * this many milliseconds. Reported in e2e (TC-26), never asserted — see the
 * timing policy above.
 */
export const CREATE_BUDGET_MS = 2_000;
/** How long the Share panel's "Link copied" confirmation stays up (share.copy). */
export const LINK_COPIED_MS = 2_000;
/**
 * PRD share.unreachable: the first wait before re-checking a board link.
 * Doubles per attempt, capped at `RECONNECT_MAX_BACKOFF_MS` (story 3).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1_000;
/** A board's own key in `storage_meta`: written once, by `initialize()`. */
export const STORAGE_CREATED_AT_KEY = "created_at";
