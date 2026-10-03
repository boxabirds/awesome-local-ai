/**
 * vidi6 product settings.
 *
 * Every tunable that the product owns lives here so it can be changed in one
 * place without a redesign (story 1 PRD, "Settings"). Stories 2-5 add to this
 * file.
 */

/** Smallest allowed zoom (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** The board must stay usable at least this far from the starting point. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;

/* Sticky notes (story 2) ---------------------------------------------------- */

/** A sticky note is a square of this many world units. */
export const STICKY_SIZE_WORLD = 200;

/** Longest note text; characters beyond this are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in world units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) that turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, in toolbar order. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* Live collaboration (story 3) ----------------------------------------------*/

/**
 * How many people a board is designed and tested for, editing at the same
 * time. A soft target: nothing refuses or slows down a 6th person, the number
 * only drives the design and the tests.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * How long a change may take to appear on every other connected screen
 * (measured from when it shows on the sender's screen). E2E tests report the
 * measurement against this budget rather than failing on it, because the model,
 * the browsers and the server share one machine.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Longest wait between reconnection attempts (the provider's backoff cap). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** The interruption length the catch-up test uses (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * How long an end-to-end test waits for a functional outcome (a change to
 * appear, states to converge). Used by every story; latency is logged against
 * `LIVE_UPDATE_LATENCY_BUDGET_MS`, never asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/**
 * Nightly stability run: how long a board is left completely idle before the run
 * checks it is still connected and still live (prd §Testing, workflow 1 stability).
 */
export const NIGHTLY_STABILITY_MINUTES = 45;

/** Nightly capacity soak: how long the run lasts at `MAX_CONCURRENT_EDITORS`. */
export const NIGHTLY_CAPACITY_MINUTES = 60;

/** Nightly capacity soak: a person drops and re-joins on this clock… */
export const NIGHTLY_REJOIN_EVERY_MINUTES = 1;

/** …for this long at the start of the run, then the run just keeps editing. */
export const NIGHTLY_REJOIN_WINDOW_MINUTES = 10;

/**
 * How much `NIGHTLY_SHORT=1` compresses the nightly durations, so the nightly
 * tests can be checked in seconds. The nightly job itself does not set it.
 */
export const NIGHTLY_SHORT_SCALE = 60;

/* Persistence (story 4) ------------------------------------------------------*/

/** Compact the update log when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or when the update log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Keeps every row well under the per-row size limit of
 * SQLite-backed Durable Objects, which is far larger than this in every figure
 * Cloudflare has published (see NOTES.md).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A room in `load-failed` retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/* Sharing (story 5) ----------------------------------------------------------*/

/**
 * How long creating a board may take, from the click on New board to the empty board
 * on screen (prd `share.create`). E2E reports the measurement against it rather than
 * failing on it, as with every other wall-clock budget here.
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's "Link copied" confirmation stays up. */
export const LINK_COPIED_MS = 2000;

/**
 * The first wait before re-checking whether a board exists; each failed check doubles
 * it, up to `RECONNECT_MAX_BACKOFF_MS`, which is the cap the WebSocket connection
 * already uses for the same kind of "the service is not answering" wait.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/** The board size the PRD tests (prd §Large boards open quickly). */
export const PERSIST_TESTED_NOTES = 2000;

/** How long opening a board of `PERSIST_TESTED_NOTES` notes may take (reported, not asserted). */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** The version of the room's SQLite tables, kept in `storage_meta`. */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * How long one update may take to reach storage before the room says so in the log
 * (`storage-write-slow`). The design calls it "the budget a live update is meant to
 * fit inside", which is the same storage seen from the other side: writing one change
 * should cost a fraction of opening a whole board, so it is a quarter of
 * `BOARD_LOAD_BUDGET_MS`. Reported, not enforced: a write that has landed is not
 * thrown away, and the room cannot stop a write that has already begun.
 */
export const STORAGE_WRITE_BUDGET_MS = BOARD_LOAD_BUDGET_MS / 4;

/* Selecting and transforming objects (story 7) --------------------------------*/

/**
 * The side of one resize handle, in screen pixels. Handles keep this size at any
 * zoom, which is why the overlay is drawn in screen space rather than in the
 * world layer.
 */
export const HANDLE_SIZE_PX = 8;

/** The smallest a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * The largest any board object may be resized to, in world units. One number for
 * every object type: a type declares its minimum, the maximum is the board's.
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** One press of an arrow key moves the selection this many world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift + an arrow key moves it this many. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* Free text (story 9) --------------------------------------------------------*/

/**
 * How wide a text box grows on its own before it wraps, in world units.
 * A line longer than this is broken into wrapped lines (`text.auto_width`).
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a text box may be dragged to, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Longest text; characters beyond this are dropped (`text.limit`). */
export const TEXT_MAX_CHARS = 5000;

/** The four size presets, in board units of font size (`text.size`). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size of newly created text. */
/**
 * How a text box decides how wide it is (`text.auto_width`, `text.resize_width`).
 *
 * `auto` is the measured width — as wide as the words need, up to the maximum before
 * they wrap; `fixed` is a width a person gave it by dragging, which the text then wraps
 * inside.
 */
export type TextWidthMode = 'auto' | 'fixed';

export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height as a multiple of the font size; height always follows content. */
export const TEXT_LINE_HEIGHT = 1.3;

/** The board's standard sans-serif, so text is crisp at every zoom. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * How much wider a text box is than its longest line, in world units.
 *
 * A box exactly as wide as its text leaves no room for the caret after the last
 * character, and a browser that is a rounding step wider than the measurement
 * would wrap a line that has not finished growing (`text.auto_width`). It is
 * never added past `TEXT_MAX_AUTO_WIDTH_WORLD`, so a wrapped box is exactly that
 * wide.
 */
export const TEXT_BOX_SLACK_WORLD = 2;

/**
 * The average glyph width, as a fraction of the font size, used to size a text
 * box when there is no canvas to measure with. Chosen to be close to the board's
 * font so a fallback box is roughly the right shape; it is never what a person
 * with a working browser sees.
 */
export const TEXT_FALLBACK_GLYPH_RATIO = 0.5;

/* Undo and redo (story 8) ---------------------------------------------------*/

/**
 * How long a pause ends a burst of typing: keystrokes closer together than this are
 * one undo step, and a pause of exactly this long starts a new one (`undo.typing`).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of this person's own steps the history keeps. The oldest is dropped when a
 * new one arrives and the history is full (`undo.limit`); nothing is kept across a
 * reload (`undo.session_only`).
 */
export const UNDO_MAX_STEPS = 200;

/* Shapes (story 10) ---------------------------------------------------------*/

/** The kinds of shape the Shape tool draws, in toolbar order. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The size a shape gets when it is clicked rather than dragged (`shape.create_click`). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * The smallest a dragged shape may be; a drag smaller in either direction becomes a
 * standard shape instead (`shape.create_click`). A drag of exactly this size is kept.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Longest shape label; characters beyond this are dropped (`shape.label`). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** The outline width of a shape, in world units, so it scales with zoom. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** The fill swatches, in toolbar order. `none` draws a shape with no fill. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

export type FillColor = keyof typeof SHAPE_FILL_COLORS;

/** The outline swatches, in toolbar order. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** The fill and outline of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/* Connectors (story 10) -----------------------------------------------------*/

/**
 * The shortest a connector may be; a drag that moved less than this creates nothing
 * (`connector.no_accidental`).
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How close to an arrow's line, in screen pixels, a click has to be to select it
 * (`connector.select`). Divided by zoom to get a distance in board units.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** The width of an arrow's line, in world units, so it scales with zoom. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** The length of the arrowhead's two sides, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** The radius of the connection-point dots, in screen pixels, so they keep their size. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
