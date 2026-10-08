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

// --- Undo / redo (story 8) -------------------------------------------------

/**
 * undo.boundaries: local changes made within this gap (ms) merge into one
 * undo step (e.g. a typing burst, or the frames of one drag gesture).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/**
 * undo.limit: at most this many undo steps are kept per session; the
 * oldest steps are dropped when the limit is exceeded.
 */
export const UNDO_MAX_STEPS = 200;

// --- Free text (story 9) ----------------------------------------------------

/**
 * text.grow_wrap: an auto-width text box grows to the width of its longest
 * line up to this ceiling (world units); beyond it the text wraps.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/**
 * text.fixed_width: a side-handle drag can shrink a text box down to this
 * minimum width (world units).
 */
export const TEXT_MIN_WIDTH_WORLD = 40;
/**
 * text.editing: maximum characters of free text (the editor silently drops
 * characters beyond the limit, like story 2's notes).
 */
export const TEXT_MAX_CHARS = 5000;
/**
 * text.sizes: the four size presets. Values are font sizes in world units
 * (px at 100% zoom; they scale with the camera zoom like everything else).
 */
export const TEXT_SIZES = {
  S: 14,
  M: 20,
  L: 32,
  XL: 56,
} as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of newly created text (text.create: "new text starts at a default size"). */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/**
 * Line height multiplier used when measuring text layout; the rendered text
 * uses the same factor so measured and on-screen line counts agree.
 */
export const TEXT_LINE_HEIGHT = 1.3;
/**
 * Font family of text objects (and their editors). Kept in config so the
 * layout measurer and the CSS render the same font.
 */
export const TEXT_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/**
 * Fallback glyph-width ratio used when no canvas measurer is available
 * (unit tests without canvas): estimated width = char count x font px x
 * this ratio.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.6;
/**
 * Initial width (world units) of a just-created text object: an estimate so
 * the object has selectable bounds before its first measurement.
 */
export const TEXT_INITIAL_WIDTH_WORLD = TEXT_MIN_WIDTH_WORLD;
/**
 * text.create: a new text object gets the top-left corner at the click
 * point; this is the one-line height of the default size (the initial
 * estimate's height).
 */
export const TEXT_INITIAL_HEIGHT_WORLD = TEXT_SIZES[DEFAULT_TEXT_SIZE] * TEXT_LINE_HEIGHT;

// --- Shapes and connectors (story 10) ---------------------------------------

/** The three shape kinds (shape.create_drag / shape.create_click). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Accessible names for the kind menu and announcements. */
export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * shape.create_click: a click (or a drag below SHAPE_MIN_SIZE_WORLD in
 * either direction) drops a SHAPE_DEFAULT_SIZE_WORLD square centred on the
 * click point.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/**
 * shape.create_click boundary: a drag kept as drawn needs at least this
 * width AND height in world units; smaller drags become clicks.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** shape.label: maximum characters of a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** shape.ui: the shape border width in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** The Shape tool's dashed drag-preview border colour (screen space). */
export const SHAPE_STROKE_COLOR_PREVIEW = '#263238';

/**
 * shape.style: the fill palette. 'none' is a transparent fill; keys are the
 * colour names stored in the document schema.
 */
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

/** shape.style: the outline palette. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** The style of newly created shapes (shape.model). */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

// --- Connectors (story 10) ----------------------------------------------------

/**
 * connector.no_accidental: a drag that moved less than this (world units)
 * creates nothing.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/**
 * connector.select: a click within this distance (SCREEN pixels, divided by
 * the zoom to get board units) of the line selects the arrow.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** The arrow line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** The arrowhead size in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** The side-dot radius in screen pixels (connector.hover_points). */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** The arrow line and arrowhead colour. */
export const CONNECTOR_STROKE_COLOR = '#263238';

// --- Freehand pen (story 11) ----------------------------------------------

/**
 * The six pen colours (pen.options). Keys are the colour names used in the
 * document schema; values are the line colours.
 */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

/**
 * The three pen thicknesses (pen.options) in world units: strokes scale
 * with zoom like everything else on the board.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;

/** Colour of newly drawn strokes (pen.options). */
export const DEFAULT_PEN_COLOR = 'black';
/** Thickness of newly drawn strokes (pen.options). */
export const DEFAULT_PEN_THICKNESS = 'medium';

/**
 * pen.smooth: the RDP simplification tolerance in SCREEN pixels at the
 * drawing zoom — no point of the finished stroke lies farther than this
 * from the path the user drew.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/**
 * pen.long_stroke: a stroke being drawn reaching this many recorded points
 * is committed and continued as a new stroke from the same last point.
 */
export const STROKE_MAX_POINTS = 5000;
/**
 * pen.select: a click within this distance (SCREEN pixels, divided by the
 * zoom to get board units) of the line selects the stroke (the larger of
 * this and half the thickness wins).
 */
export const STROKE_HIT_TOLERANCE_PX = 6;
/**
 * Minimum side length (world units) of a stroke's bounding box: the
 * aspect-locked resize clamps at this.
 */
export const STROKE_MIN_SIZE_WORLD = 4;
