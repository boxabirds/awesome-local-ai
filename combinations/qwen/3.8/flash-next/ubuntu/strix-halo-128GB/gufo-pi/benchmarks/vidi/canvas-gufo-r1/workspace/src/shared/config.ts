// Shared product settings for vidi6.
// Stories 2-5 add further settings to this file.
//
// Story 1 (Pan and zoom around an infinite board) owns the camera / grid settings.

/** Minimum zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit). 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative size of a single zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Pan distance (world units) the board must handle without edges or distortion. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ─── Story 2: Sticky notes ───────────────────────────────────────────────────

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters allowed in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Maximum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Minimum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;

/** Distance in screen pixels before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset colours for sticky notes. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour applied to newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ─── Story 3: Live collaboration ────────────────────────────────────────────

/** Soft capacity: design + test target for simultaneous editors, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** Latency budget for change delivery (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Maximum reconnect backoff passed to WebsocketProvider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Duration of the green "Connected" badge after reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage duration used in catch-up test (PRD live.catch_up verification). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ─── Story 4: Persistence ────────────────────────────────────────────────────

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

/** PRD persist.large_board: open-time target in ms. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Storage schema version for the DO SQLite tables. */
export const STORAGE_SCHEMA_VERSION = 1;

// ─── Story 5: Share a board with others using a link ─────────────────────────

/** Max boards a visitor may create per period. */
export const BOARD_CREATE_LIMIT = 10;

/** Rate-limit window for board creation, in seconds. Must match wrangler.jsonc ratelimits. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** Max id-generation attempts before giving up (collision retry). */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create: time budget from click to board visible (ms). */
export const CREATE_BUDGET_MS = 2000;

/** Duration the "Link copied" confirmation stays visible (ms). */
export const LINK_COPIED_MS = 2000;

/** Base backoff for board existence check retries (doubles up to RECONNECT_MAX_BACKOFF_MS). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ─── Story 7: Select, move, resize and delete several objects at once ────────

/** Size of resize handles in screen pixels. */
export const HANDLE_SIZE_PX = 8;

/** Minimum size for a sticky note in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Maximum size for any object in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ─── Story 8: Undo and redo my own changes ──────────────────────────────────

/** Typing pause (ms) that ends a burst and starts a new undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum undo history length (steps kept per user). */
export const UNDO_MAX_STEPS = 200;

// ─── Story 9: Free text ─────────────────────────────────────────────────────

/** Maximum automatic width in world units before text wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum fixed width in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters allowed in a text object. */
export const TEXT_MAX_CHARS = 5000;

/** Font size presets for text objects (world units). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Default text size for newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height multiplier for text objects. */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// ─── Story 10: Shapes and connectors ────────────────────────────────────────

export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];

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

export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;
export const CONNECTOR_ANCHOR_RADIUS_WORLD = 5;
export const CONNECTOR_ANCHOR_HIT_RADIUS_WORLD = 12;

// ─── Story 11: Sketch freehand with a pen ───────────────────────────────────

export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

export type PenColor = keyof typeof PEN_COLORS;

export const PEN_THICKNESS_WORLD = {
  thin: 2,
  medium: 4,
  thick: 8,
} as const;

export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
export const STROKE_MAX_POINTS = 5000;
export const STROKE_HIT_TOLERANCE_PX = 6;
export const STROKE_MIN_SIZE_WORLD = 4;
