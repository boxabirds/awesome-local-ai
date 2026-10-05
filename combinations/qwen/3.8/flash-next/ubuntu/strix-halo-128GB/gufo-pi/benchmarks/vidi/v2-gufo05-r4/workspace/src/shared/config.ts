/**
 * Product settings for vidi6. Every tunable number lives here so it can be
 * changed in one place without a redesign (stories 2+ keep adding to this file).
 */

/** Smallest zoom the user can reach (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom the user can reach. 400%. */
export const ZOOM_MAX = 4;

/** One zoom step: the zoom is multiplied (or divided) by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Radius, in screen pixels, of one dot grid dot. */
export const GRID_DOT_RADIUS_PX = 1;

/** Zoom -> whole-number percentage label. */
export const PERCENT_PER_ZOOM = 100;

/**
 * Zoom steps snap to the nearest exact power of ZOOM_STEP_FACTOR within this
 * relative tolerance, so "zoom in then zoom out" returns to exactly 1.0
 * instead of drifting (1.25 * (1 / 1.25) is not exactly 1 in binary floats).
 */
export const ZOOM_STEP_SNAP_TOLERANCE = 1e-9;

/** Pixels per wheel event unit when WheelEvent.deltaMode is DELTA_MODE_LINE. */
export const WHEEL_DELTA_LINE_PX = 40;

/** Pixels per wheel event unit when WheelEvent.deltaMode is DELTA_MODE_PAGE. */
export const WHEEL_DELTA_PAGE_PX = 800;

/** Width/height, in screen pixels, of the crosshair marking the board start point. */
export const ORIGIN_MARKER_SIZE_PX = 16;

/* ---------------------------------------------------------------- sticky notes (story 2) */

/** Width and height of a sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;

/** A note never holds more characters than this. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in world units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows into a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel, in screen pixels, before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, by name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8'
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Padding inside a note, in world units — text never touches the edge. */
export const STICKY_PADDING_WORLD = 12;

/** Height of the fade shown at the bottom edge when the text overflows. */
export const STICKY_FADE_HEIGHT_PX = 24;

/** Line height of note text, as a multiple of the (auto-fitted) font size. */
export const STICKY_LINE_HEIGHT = 1.35;

/**
 * Gap between a note's top edge and its floating toolbar, in world units.
 * `1 / zoom` is applied to the toolbar, so this gap is a world-unit gap that
 * scales with the note; the toolbar itself keeps a constant screen size.
 */
export const NOTE_TOOLBAR_GAP_WORLD = 8;

/** Toolbar button height, in screen pixels (it does not scale with zoom). */
export const NOTE_TOOLBAR_HEIGHT_PX = 28;

/** Horizontal padding inside the note toolbar, in screen pixels. */
export const NOTE_TOOLBAR_SIDE_PADDING_PX = 6;

/** Colour swatch size inside the note toolbar, in screen pixels. */
export const NOTE_SWATCH_SIZE_PX = 18;

/** Schema version written to `meta.schemaVersion` (story 4 migrates from it). */
export const BOARD_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ live sync (story 3) */

/**
 * Simultaneous editors the board is designed and tested for. Soft capacity:
 * neither the Worker nor the room counts participants, and a 6th person is
 * never turned away — this number only drives the design and the tests.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * How long a change may take to appear on every other connected screen
 * (`live.propagate`). Measured in e2e and reported, never asserted, because the
 * model, the browsers and the server share one machine.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to `WebsocketProvider.maxBackoffTime`: the longest wait between retries. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length of the catch-up test (`live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Generous functional wait in every e2e test: the test waits for the outcome and
 * *logs* how long it took against LIVE_UPDATE_LATENCY_BUDGET_MS instead of
 * failing on the budget.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/**
 * How long two boards sit idle in the nightly connection-stability test. Longer
 * than RECONNECT_MAX_BACKOFF_MS and than any ping the provider sends, so a link
 * that only holds up at first is still caught.
 */
export const NIGHTLY_IDLE_STABILITY_MS = 45_000;

/** How long the nightly capacity soak keeps everyone editing. */
export const NIGHTLY_CAPACITY_SOAK_MS = 60_000;

/* --------------------------------------------------------------- persistence (story 4) */

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or once the log holds this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Keeps every row far below the per-row size limit of
 * SQLite-backed Durable Objects (2 MB today, per the Cloudflare docs — re-check
 * when it changes): a long-lived board's snapshot is one row per chunk, not one
 * row per board.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A board that failed to load retries its load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the product is tested at (`persist.large_board`). */
export const PERSIST_TESTED_NOTES = 2000;

/** How long opening such a board may take (`persist.large_board`). Reported, not asserted. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the storage tables, written to `storage_meta.storage_schema_version`. */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * How long a board may be empty — every socket gone — before the room folds its log
 * and releases the document. Idle boards are then held in storage and nowhere else,
 * which is what "idle costs nothing" means in compute terms (design.md 3.5).
 */
export const BOARD_IDLE_RELEASE_MS = 60_000;

/* ------------------------------------------------------------ sharing (story 5) */

/**
 * How long creating a board may take, from the click on "New board" to an empty board
 * on screen (`share.create`). Reported in e2e, never asserted: the model, the browsers
 * and the server share one machine here, exactly as with the story 3 budgets.
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's "Link copied" confirmation stays up (`share.copy`). */
export const LINK_COPIED_MS = 2000;

/**
 * First wait before re-checking whether a board link exists. Each failure doubles the
 * wait, up to `RECONNECT_MAX_BACKOFF_MS` — the same ceiling the live connection uses,
 * so one unreachable service costs one backoff rhythm however the app is knocking.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
