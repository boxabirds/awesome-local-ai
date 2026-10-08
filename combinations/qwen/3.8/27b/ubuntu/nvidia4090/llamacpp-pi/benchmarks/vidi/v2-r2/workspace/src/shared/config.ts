/**
 * Product settings for vidi6.
 *
 * All named settings live in this file so they can be changed in one place
 * without redesign. Stories 2-5 add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit): 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + =/−. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom factor is exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), where
 * deltaY is in CSS pixels (positive = scroll down / pinch out on most OSes).
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * The board must pan at least this many world units from the starting point
 * in any direction without an edge or visible grid distortion.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Maximum allowed deviation when snapping a step zoom to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Percent value shown per 1.0 of zoom (zoom 1 → "100%"). */
export const PERCENT_PER_ZOOM = 100;

/** Pixels per delta unit for wheel events reported in LINE delta mode. */
export const WHEEL_LINE_DELTA_PX = 16;

// --- Sticky notes (story 2) ---------------------------------------------------

/** Sticky note size in board (world) units: square, width = height. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may contain. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/**
 * The character counter is visible while this many characters or fewer
 * remain until STICKY_TEXT_MAX_CHARS.
 */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size, in board units at 100% zoom (scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size, in board units at 100% zoom. */
export const STICKY_FONT_MIN_PX = 10;

/**
 * Screen pixels a pointer may move after pressing a note before the press
 * becomes a drag. Below this the press is a plain click (selects the note).
 */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky note colour presets. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

/** Name of one of the six sticky note colour presets. */
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Blue outline drawn around the selected note. */
export const STICKY_SELECTION_OUTLINE = '#1a73e8';

/** Padding inside a note around its text, in board units. */
export const STICKY_TEXT_PADDING = 12;

// --- Multi-select: move, resize, delete (story 7) ----------------------------

/** Screen size of the square resize handles on the selection bounding box. */
export const HANDLE_SIZE_PX = 8;

/** Smallest size (either axis) any resized object may reach. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest size (either axis) any object of any type may reach. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Arrow-key nudge step in world units while Shift is held. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Live collaboration (story 3) ------------------------------------------

/**
 * Soft capacity: the number of simultaneous editors the product is designed
 * and tested for. Never enforced — a further person is never turned away.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** Latency budget for a change to reach every other screen (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to the y-websocket provider as `maxBackoffTime` (ms). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection (ms). */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage duration used by the catch-up verification (PRD live.catch_up, ms). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/** Generous functional wait for e2e assertions; latency is logged, not asserted (ms). */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Durable storage (story 4) --------------------------------------------

/** Compact when this many log rows have accumulated (a small load is fast). */
export const COMPACTION_UPDATE_COUNT = 500;

/** Also compact when the log exceeds this many bytes (protects against large single updates). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Snapshots are stored in chunks of at most this many bytes per row. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** Minimum interval between board-load retries for a LoadFailed room (TC-16). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

/** Sticky notes on the e2e large-board load test (TC-21). */
export const PERSIST_TESTED_NOTES = 2_000;

/** Reference budget for loading PERSIST_TESTED_NOTES notes in a browser (logged, not asserted, ms). */
export const BOARD_LOAD_BUDGET_MS = 3_000;

/** Current storage schema version, kept in `storage_meta`. */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Share (story 5) --------------------------------------------------------

/** Click-to-board budget for New board on the home page (PRD share.create, ms). */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel shows "Link copied" after a successful copy (ms). */
export const LINK_COPIED_MS = 2000;

/**
 * Base delay for the board-existence-check backoff while the service is
 * unreachable (share.unreachable): doubles per attempt, capped at
 * RECONNECT_MAX_BACKOFF_MS.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Undo / redo (story 8) ---------------------------------------------------

/**
 * Pause between text inputs, in ms, that ends a typing burst: typing that
 * continues without a pause of at least this length is one undo step
 * (undo.typing). Same value Yjs uses as its default capture timeout.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Most recent undo steps kept per person; the oldest steps are dropped (undo.limit). */
export const UNDO_MAX_STEPS = 200;

// --- Free text (story 9) ------------------------------------------------------

/** Maximum width an auto-width text box may grow to, in world units; longer lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Smallest width a fixed-width text object may be dragged down to, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters a text object may hold; characters beyond the limit are dropped. */
export const TEXT_MAX_CHARS = 5000;

/** Text size presets (world-unit font size at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

/** Name of a text size preset. */
export type TextSize = keyof typeof TEXT_SIZES;

/** Size of newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line box height = font size x TEXT_LINE_HEIGHT (world units). */
export const TEXT_LINE_HEIGHT = 1.3;

/** Standard sans-serif font for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/** The text length counter appears within this many characters of TEXT_MAX_CHARS. */
export const TEXT_COUNTER_NEAR_CHARS = 50;

/**
 * Average glyph width as a fraction of the font size, used to estimate text
 * width when canvas measurement is unavailable (unit tests / non-DOM).
 */
export const TEXT_ESTIMATED_GLYPH_WIDTH_RATIO = 0.55;

/* ------------------------------------------------------------------ */
/* Shape object (story 10, design shape.object)                        */
/* ------------------------------------------------------------------ */

/** The three shape kinds (design shape.object). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Shape label character limit (shared with the shape label editor). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Shape created by a click (no drag / tiny drag), in world units. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** Smallest shape size in world units; smaller drags become the default. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Shape stroke width in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Named fill palette (design shape.object); `none` means no fill. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#ffffff',
  blue: '#c5dcf7',
  green: '#cdeccd',
  yellow: '#f7e8b0',
  pink: '#f6cfe0',
  grey: '#e4e4e0',
} as const;
export type ShapeFillColor = keyof typeof SHAPE_FILL_COLORS;

/** Named outline palette (design shape.object). */
export const SHAPE_STROKE_COLORS = {
  dark: '#3c3c34',
  blue: '#2563eb',
  green: '#16a34a',
  orange: '#ea8a00',
  red: '#dc2626',
  grey: '#9a9a92',
} as const;
export type ShapeStrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Default fill / outline for a freshly created shape (design shape.object). */
export const DEFAULT_SHAPE_FILL: ShapeFillColor = 'white';
export const DEFAULT_SHAPE_STROKE: ShapeStrokeColor = 'dark';

/** Shape label font size, world units at 100% zoom (shape.label). */
export const SHAPE_LABEL_FONT_PX = 16;

/** Padding between a shape's outline and its label box, world units. */
export const SHAPE_LABEL_PADDING_WORLD = 8;

/* ------------------------------------------------------------------ */
/* Connector (story 10, design connector.object)                       */
/* ------------------------------------------------------------------ */

/** Connectors shorter than this are not created (a 7.9 unit drag creates
 *  nothing, an 8 unit drag is allowed). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** Click / hit tolerance around a connector line, in screen pixels at any
 *  zoom (5 px is within the tolerance, 7 px is not). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Connector line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Arrowhead size in world units (head length and half of the base). */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Endpoint dot radius, in screen pixels (connector tool hover / drag). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/** Connector line colour. */
export const CONNECTOR_INK_COLOR = '#3c3c34';
