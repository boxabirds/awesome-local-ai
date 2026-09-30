/**
 * Product settings for vidi6, in one place so they can be tuned without a
 * redesign. Stories 2+ add their own settings to this file.
 */

// ---- Zoom (story 1: pan and zoom around an infinite board) ----

/** Smallest zoom (screen pixels per world unit) the board can be scaled to. */
export const ZOOM_MIN = 0.1;
/** Largest zoom (screen pixels per world unit) the board can be scaled to. */
export const ZOOM_MAX = 4;
/** One zoom step: `+` multiplies the zoom by this, `-` divides by it. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ---- Live collaboration (story 3: see other people's edits live) ----

/** Soft capacity: design + test target for simultaneous editors, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: budget for a change to reach every other screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// ---- Persistence (story 4: return to a board and find everything as it was left) ----

/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Storage schema version for the board-store tables. */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Sharing (story 5: share a board with others using a link) ----

/** PRD share.create: budget from click to board visible. */
export const CREATE_BUDGET_MS = 2000;
/** Duration "Link copied" is shown after a successful copy. */
export const LINK_COPIED_MS = 2000;
/** Base backoff interval when checking board existence (doubles each attempt). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Selection and transform (story 7: select, move, resize and delete several objects at once) ----

/** Size of each resize handle in screen pixels (stays constant at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Minimum width/height for a sticky note after resize, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum width/height for any board object, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step, in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Undo (story 8: undo and redo my own changes without undoing anyone else's) ----

/** Typing pause that ends a capture burst, in milliseconds. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Maximum number of undo steps kept in memory. */
export const UNDO_MAX_STEPS = 200;

// ---- Free text (story 9: write free text anywhere on the board) ----

/** Maximum automatic width for a text object, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum fixed width for a text object, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Hard limit on the characters a text object keeps. */
export const TEXT_MAX_CHARS = 5000;
/** Size presets for text objects, in world units (font size). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Default size for a newly created text object. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height of text objects, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Average glyph width ratio (used as fallback when canvas is unavailable). */
export const TEXT_AVG_GLYPH_RATIO = 0.6;

// ---- Shapes (story 10: draw shapes and connect them with arrows) ----

export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;

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

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_FILL_COLORS, value);
}

export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.hasOwn(SHAPE_STROKE_COLORS, value);
}

// ---- Connectors (story 10) ----

export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;

// ---- Pen / freehand strokes (story 11: sketch freehand with a pen) ----

export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;

export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
export const STROKE_MAX_POINTS = 5000;
export const STROKE_HIT_TOLERANCE_PX = 6;
export const STROKE_MIN_SIZE_WORLD = 4;

export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.hasOwn(PEN_COLORS, value);
}

export function isPenThickness(value: unknown): value is PenThickness {
  return typeof value === 'string' && Object.hasOwn(PEN_THICKNESS_WORLD, value);
}

/** Zoom step values are snapped to `ZOOM_STEP_FACTOR^n` within this epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a wheel `deltaMode === LINE` delta into CSS pixels. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Multiplier turning a wheel `deltaMode === PAGE` delta into CSS pixels. */
export const WHEEL_PAGE_HEIGHT_PX = 400;

// ---- Sticky notes (story 2: capture ideas and rearrange them) ----

/** Edge length of a new sticky note, in world units (a square). */
export const STICKY_SIZE_WORLD = 200;
/** Hard limit on the characters of text a note keeps. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (so it scales with board zoom). */
export const STICKY_FONT_MAX_PX = 24;
/**
 * Smallest note font size the auto-fit can pick. Below this the text is no
 * longer shrunk: the overflow is hidden and the note's bottom edge fades.
 */
export const STICKY_FONT_MIN_PX = 10;
/** Padding between a note's edge and its text, in world units.
 * (Not in design.md's settings list; needed so text auto-fit and the visible
 * text box agree on one number.) */
export const STICKY_PADDING_WORLD = 16;
/** Line height of note text, as a multiple of the font size. */
export const STICKY_LINE_HEIGHT = 1.3;
/** Pointer travel that turns a press on a note into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours; the key is the name used in the document. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Display name of a note colour, for accessible labels and tooltips. */
export function stickyColorLabel(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** True for one of the six preset colour names, false for anything else. */
export function isStickyColor(value: unknown): value is StickyColor {
  return typeof value === 'string' && Object.hasOwn(STICKY_COLORS, value);
}

// ---- Presentation of the zoom indicator ----

/** Zoom is shown to the user as a whole-number percentage. */
export const PERCENT = 100;

// ---- Story 12: Images ----

export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AcceptedImageMime = typeof IMAGE_ACCEPTED_TYPES[number];

/** Maximum upload size in bytes (10 MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Maximum images per add action. */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/** Longest side of a placed image in world units. */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/** Minimum image size in world units (resize floor). */
export const IMAGE_MIN_SIZE_WORLD = 16;

/** Gap between images placed in a row. */
export const IMAGE_LAYOUT_GAP_WORLD = 24;

/** Time before an uploading image is considered unfinished. */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

/** Cache-Control max-age for served assets (1 year). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** Number of bytes to read for magic-byte type sniffing. */
export const IMAGE_SNIFF_BYTES = 12;
