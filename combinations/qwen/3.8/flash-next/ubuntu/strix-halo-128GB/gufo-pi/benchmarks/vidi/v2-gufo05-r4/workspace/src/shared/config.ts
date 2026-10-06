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

/* ------------------------------------------------------------------ free text (story 9) */

/**
 * How wide a text box may grow on its own (`text.auto_width`): the longest line is
 * measured and the box follows it until this, then lines wrap inside it.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a text box may be given by dragging a side handle (`text.fixed_width`). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** A text object never holds more characters than this (`text.limit`). */
export const TEXT_MAX_CHARS = 5000;

/**
 * The counter appears once free text is within this many characters of the limit, so it is
 * there when the user has to start counting and not before — the rule story 2 set for
 * notes, scaled to this limit.
 */
export const TEXT_COUNTER_THRESHOLD_CHARS = 500;

/** The four text sizes, in world units of font size, so they scale with the board zoom. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The four presets in the order the toolbar shows them: quietest to loudest. */
export const TEXT_SIZE_ORDER: readonly TextSize[] = ['S', 'M', 'L', 'XL'];

/** The size of newly created text. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height of free text, as a multiple of the font size. Height always follows content. */
export const TEXT_LINE_HEIGHT = 1.3;

/** The board's standard sans-serif, so text stays crisp at every zoom level. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * How wide one character is guessed to be when there is no way to measure text at all
 * (no canvas), as a fraction of the font size. Only the fallback path uses it: an
 * estimate keeps a usable box where a measurement would have put one.
 */
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

/* ------------------------------------------------------- selecting and resizing (story 7) */

/**
 * Side length of one resize handle, in *screen* pixels: a handle is the same size
 * on screen at every zoom, so it stays grabbable when the board is far out.
 */
export const HANDLE_SIZE_PX = 8;

/** The smallest a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * The largest any board object may become, in world units — one setting for every
 * object type, so a giant shape cannot be made by resizing a sticky note through
 * a loophole.
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** One arrow-key press moves the selection this many world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift plus an arrow key moves the selection this many world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** Schema version written to `meta.schemaVersion` (story 4 migrates from it). */
export const BOARD_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ undo (story 8) */

/**
 * The pause in typing that ends an undo step (`undo.typing`): keystrokes closer
 * together than this collapse into one step, a pause of at least this opens a new
 * one. Passed to `Y.UndoManager.captureTimeout`, and the reason a whole burst of
 * typing undoes as one.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of the person's own steps one undo history keeps (`undo.limit`). The
 * oldest is dropped when a new one would push it past this.
 */
export const UNDO_MAX_STEPS = 200;

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

/* --------------------------------------------------------- shapes and arrows (story 10) */

/** The three kinds of shape the board draws, in the order the Shape menu lists them. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** A shape dropped by a click, or by a drag too small to be a shape. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** A drag smaller than this in either direction counts as a click, not a shape. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** A shape label never holds more characters than this. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Outline width of a shape, in world units, so it scales with the board's zoom. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** The seven fills: six colours and "no fill". */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0'
} as const;

export type FillColor = keyof typeof SHAPE_FILL_COLORS;

/** The six outline colours. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E'
} as const;

export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** The fill and outline of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** Label font size, in world units, so it scales with the board's zoom. */
export const SHAPE_LABEL_FONT_WORLD = 16;

/** Gap between a label and the shape's edge, in world units. */
export const SHAPE_LABEL_PADDING_WORLD = 8;

/** An arrow shorter than this is a mis-drag, not an arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** How close, in screen pixels, a click has to be to an arrow's line to select it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Arrow line width, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Length of an arrowhead, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Radius of one connection dot, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* ------------------------------------------------------------- freehand pen (story 11) */

/** The six pen colours, by name — a stroke stores the name, never the hex. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA'
} as const;

/** The three pen thicknesses, in *board* units, so a stroke scales with the zoom. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;

/** The colour and thickness of a pen that has just been picked up. */
export const DEFAULT_PEN_COLOR = 'black';
export const DEFAULT_PEN_THICKNESS = 'medium';

/**
 * How far, in *screen* pixels at the zoom being drawn at, a finished stroke may stray from the
 * path the hand drew (`pen.smooth`). Ramer-Douglas-Peucker run at this tolerance keeps every
 * recorded point within it of the result, which is what "smoothed but faithful" means.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * How many recorded points one stroke may hold (`pen.long_stroke`). Reaching it finishes the
 * stroke and starts a new one at the same point, so an unbroken hundred-metre scribble costs no
 * more memory than a series of long ones.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How close, in screen pixels, a click has to be to a stroke's line to select it
 * (`pen.select`). Half the stroke's own thickness is the floor, so a thick line stays as easy
 * to hit as it is to see.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/** The smallest a stroke may be resized to, in board units. */
export const STROKE_MIN_SIZE_WORLD = 4;

/**
 * First wait before re-checking whether a board link exists. Each failure doubles the
 * wait, up to `RECONNECT_MAX_BACKOFF_MS` — the same ceiling the live connection uses,
 * so one unreachable service costs one backoff rhythm however the app is knocking.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
