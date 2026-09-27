// Product settings for the board. All navigation constants live here so they
// can be tuned in one place without touching component code (PRD "Settings").

/** Smallest allowed zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;
/** Largest allowed zoom. 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot-grid spacing measured in world units. */
export const GRID_SPACING_WORLD = 24;
/** The extent (in world units) the board is verified to pan to without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiplier converting a zoom ratio to a whole-number percentage label. */
export const ZOOM_PERCENT_SCALE = 100;
/** Zooms within this distance of a ZOOM_STEP_FACTOR^n snap to it, killing
 * floating-point drift so step-in then step-out returns exactly 1.0 (TC-09). */
export const ZOOM_SNAP_EPS = 1e-9;

/** Wheel deltaMode=LINE (DOM_DELTA_LINE) converted to CSS pixels. */
export const WHEEL_LINE_HEIGHT = 16;
/** Wheel deltaMode=PAGE (DOM_DELTA_PAGE) converted to CSS pixels. */
export const WHEEL_PAGE_HEIGHT = 600;
// --- Sticky notes (story 2) -------------------------------------------------

/** Sticky note size in world units (a square STICKY_SIZE_WORLD x STICKY_SIZE_WORLD). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters kept in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter is shown when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest sticky-note font size (px, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest sticky-note font size (px, at 100% zoom); below this text overflows. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) beyond which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

// --- Selection & transforms (story 7) ---------------------------------------

/** Resize-handle size in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky-note side in world units (resizing stops here). */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest any single object may be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;
/** Fill colour of the Shift+drag selection rectangle. */
export const MARQUEE_FILL = 'rgba(59,130,246,0.18)';

// --- Undo & redo (story 8) --------------------------------------------------

/** Typing pause that ends a capture window. Transactions closer than this merge
 * into one undo step; a boundary() (gesture start/end, edit start/end) or a
 * pause of at least this long starts a new step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Largest number of undo steps kept per board. Older steps are dropped from
 * the front once the undo stack is longer (the newest edit is never dropped). */
export const UNDO_MAX_STEPS = 200;
/** Border colour of the selection rectangle and bounding box. */
export const SELECTION_STROKE = '#2563eb';

/** The six preset sticky-note colours (accessible by name, not only by colour). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) -------------------------------------------

/** Soft concurrent-editor capacity. A design and test target (boundary
 * 5 / 6 participants), never enforced: over-capacity joins are accepted. */
export const MAX_CONCURRENT_EDITORS = 5;
/** Live propagation budget from PRD live.propagate: one change must be
 * visible on every other screen within this many milliseconds. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider as `maxBackoffTime` (reconnect backoff cap). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Provider `resyncInterval`: how often an otherwise-idle client re-sends
 * SyncStep1 (which the room always answers with a SyncStep2), so the link
 * keeps carrying traffic in BOTH directions. Must stay comfortably under
 * y-websocket's 30-second no-message timeout — 10s keeps at least two
 * full round-trips of margin even when a hop is slow. */
export const IDLE_KEEPALIVE_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnect before the
 * connection counts as fully restored (badge hidden). */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify PRD live.catch_up (Flaky Wi-Fi workflow). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Persistence (story 4) --------------------------------------------------

/** Compact the update log once this many rows have accumulated. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once the log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot blobs are stored in chunks of this size, keeping every row far
 * below the per-row size limit of SQLite-backed Durable Objects. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries its load at most this often (per board). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Largest board size verified for PRD persist.large_board. */
export const PERSIST_TESTED_NOTES = 2000;
/** Budget for showing a PERSIST_TESTED_NOTES board (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the Durable-Object storage tables (NOT the Yjs doc schema, which
 * is versioned separately by `meta.schemaVersion`). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing / board creation (story 5) ------------------------------------

/** Board-creation rate limit per visitor (per period). Mirrors the
 * `BOARD_CREATE_LIMITER` binding in wrangler.jsonc (TC-03 asserts equality). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window in seconds. Must equal the wrangler.jsonc period (TC-03). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** How many id-generation attempts a single create makes before giving up
 * (collision retries). Boundary tested by TC-01 / TC-02. */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Budget for PRD share.create: create + open a board within this many ms. */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel shows "Link copied" before reverting. */
export const LINK_COPIED_MS = 2000;
/** Base backoff for the board-existence retry; doubles up to
 * RECONNECT_MAX_BACKOFF_MS (story 3). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Free text (story 9) -----------------------------------------------------

/** Largest width an auto-width text block may reach, in world units. A longer
 * line wraps instead of growing past this. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest text width (auto or fixed) in world units: a single short word
 * still gets a usable box, and a fixed-width drag stops here. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Text padding on each side of the block, in world units (added to the
 * measured line width when sizing an auto block). */
export const TEXT_PADDING_WORLD = 8;
/** Maximum characters kept in a text block's Y.Text. */
export const TEXT_MAX_CHARS = 5000;
/** The four size presets, in world-unit font sizes (S heading … XL title). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size a new text block starts with. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height multiplier for every text size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** Font family text blocks are measured and rendered in. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Average glyph width as a fraction of the font size, used for the estimate
 * fallback when no canvas context exists to measure with. */
export const TEXT_AVG_GLYPH_RATIO = 0.55;
/** Default tool of the board (Text is entered with T or the toolbar). */
export const DEFAULT_TOOL = 'select';

// --- Shapes & connectors (story 10) -----------------------------------------

/** The three shape kinds a user may draw. There is no triangle/star library. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Size of a shape dropped by a click (or a drag below the minimum size). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Smallest shape a drag may create, in world units; smaller is a click. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters kept in a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Shape outline width in world units (scales with zoom). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Font size a shape label starts with, in world units; it shrinks to fit
 * (see `fitFontSize`), and the label box is the shape's own footprint. */
export const SHAPE_LABEL_FONT_WORLD = 16;

/** The seven fills of the shape toolbar: six colours plus "no fill". */
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

/** The six outline colours of the shape toolbar. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** A connector drag shorter than this (in world units) creates nothing. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Clicking within this many SCREEN pixels of an arrow's line selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead length in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of a connector's hover dots AND end handles, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Pen (story 11) ----------------------------------------------------------

/** The six ink colours of the pen toolbar, by name (the name is what a stroke
 * stores, so the palette can change without rewriting the board). */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;
/** The three thickness presets, in WORLD units: a stroke scales with zoom like
 * every other size on the board. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/** How far a simplified stroke may deviate from what was drawn, in SCREEN
 * pixels; the tool divides it by the zoom, so it stays faithful at any scale. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** Raw points recorded before a stroke is finished and a new one starts. */
export const STROKE_MAX_POINTS = 5000;
/** Clicking within this many SCREEN pixels of a stroke's line selects it. */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest side a stroke's box may be resized to, in world units. */
export const STROKE_MIN_SIZE_WORLD = 4;
