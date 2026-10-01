/**
 * Product settings shared by the client and (later) the worker.
 * Stories 2-5 add to this file. Every tunable value the design names lives here.
 */

/** Minimum zoom level (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the unbounded board is tested, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiply a zoom by this to get a whole-number percentage label. */
export const PERCENT = 100;

/** Wheel deltaMode: one delta unit is one line of text. */
export const WHEEL_DELTA_MODE_LINE = 1;

/** Wheel deltaMode: one delta unit is one page. */
export const WHEEL_DELTA_MODE_PAGE = 2;

/** Pixels per wheel "line" delta unit (matches Chrome's default line height). */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Pixels per wheel "page" delta unit (a typical viewport height). */
export const WHEEL_PAGE_HEIGHT_PX = 800;

/**
 * Step zoom snaps to the nearest power of ZOOM_STEP_FACTOR when within this
 * distance, so 1.25 followed by 0.8 returns exactly 1.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/* Sticky notes (story 2) -------------------------------------------------- */

/** A sticky note is a square of this many world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters of text kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (px at 100% zoom; scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size before the overflow fades out. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky note colours. */
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

/* Live collaboration (story 3) ------------------------------------------- */

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1-second budget for change delivery. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* Persistence (story 4) ---------------------------------------------------- */

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

/** Storage schema version for the DO SQLite tables. */
export const STORAGE_SCHEMA_VERSION = 1;

/* Share links (story 5) -------------------------------------------------- */

/** PRD share.create: budget from click to board visible. */
export const CREATE_BUDGET_MS = 2000;

/** Duration of the "Link copied" confirmation. */
export const LINK_COPIED_MS = 2000;

/** Backoff base for board existence check retries. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* Selection and transform (story 7) --------------------------------------- */

/** Resize handle size in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;

/** Minimum sticky note size in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Maximum object size in world units (any type). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* Undo (story 8) ----------------------------------------------------------- */

/** Typing pause (ms) that ends a capture window and starts a new undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum number of undo steps kept per user per session. */
export const UNDO_MAX_STEPS = 200;

/* Free text (story 9) ------------------------------------------------------- */

/** Maximum automatic width in world units before lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum fixed width in world units when dragging a side handle. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters in one text object. */
export const TEXT_MAX_CHARS = 5000;

/** Text size presets in world-unit font sizes. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height multiplier (relative to font size). */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/* Shapes (story 10) -------------------------------------------------------- */

export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];

export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;

export const SHAPE_FILL_COLORS = { none: 'transparent', white: '#FFFFFF', blue: '#BBDEFB', green: '#C8E6C9', yellow: '#FFF9C4', pink: '#F8BBD0', grey: '#E0E0E0' } as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

export const SHAPE_STROKE_COLORS = { dark: '#263238', blue: '#1E88E5', green: '#43A047', orange: '#FB8C00', red: '#E53935', grey: '#9E9E9E' } as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/* Connectors (story 10) ---------------------------------------------------- */

export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* Pen / Stroke (story 11) ------------------------------------------------- */

export const PEN_COLORS = { black: '#212121', blue: '#1E88E5', red: '#E53935', green: '#43A047', orange: '#FB8C00', purple: '#8E24AA' } as const;
export type PenColor = keyof typeof PEN_COLORS;

export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
export const STROKE_MAX_POINTS = 5000;
export const STROKE_HIT_TOLERANCE_PX = 6;
export const STROKE_MIN_SIZE_WORLD = 4;

/* Images (story 12) -------------------------------------------------------- */

export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_MAX_FILES_PER_ADD = 20;
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
export const IMAGE_MIN_SIZE_WORLD = 16;
export const IMAGE_LAYOUT_GAP_WORLD = 24;
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
export const IMAGE_SNIFF_BYTES = 12;
