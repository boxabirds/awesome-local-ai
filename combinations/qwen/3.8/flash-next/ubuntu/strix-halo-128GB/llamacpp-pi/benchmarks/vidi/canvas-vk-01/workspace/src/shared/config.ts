// Product settings for vidi6. Stories 2-5 add their settings to this file.

/** Smallest zoom the user can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the user can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot grid lines, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Sticky note settings (story 2)

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter becomes visible when remaining <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Minimum pointer movement in screen px before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** Available sticky note colours. */
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

/** Selection outline / handle colour. */
export const SELECTION_COLOR = '#2563EB';
/** Marquee fill colour. */
export const MARQUEE_COLOR = 'rgba(59, 130, 246, 0.15)';
/** Marquee border colour. */
export const MARQUEE_BORDER_COLOR = '#3B82F6';

// Live collaboration settings (story 3)

/**
 * Simultaneous-editor capacity: the number of people a board is designed and
 * tested for. Soft: never enforced, a 6th person is never turned away. Tests
 * must use this setting rather than a hard-coded number (PRD live.capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: change-delivery budget in ms (sender screen -> receiver screen). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound of the provider's reconnect backoff (passed to WebsocketProvider). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the PRD live.catch_up verification. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// Persistence settings (story 4)

/** Compact the update log when this many rows exist (PRD persist.large_board). */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot rows are written in chunks of this size, which keeps every row well
 * under the per-row size limit of SQLite-backed Durable Objects.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A `load-failed` room retries loading at most this often (PRD persist.load_failure). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** The board size the persistence work is designed and tested for (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** Opening a `PERSIST_TESTED_NOTES` board must show every note within this (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the storage tables, written to `storage_meta` on migrate. */
export const STORAGE_SCHEMA_VERSION = 1;

// Share settings (story 5)

/** Max boards a single visitor may create within the period. */
export const BOARD_CREATE_LIMIT = 10;
/** Period (seconds) over which the creation limit applies. Must match wrangler.jsonc ratelimits. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** Maximum attempts to find a non-colliding board id before giving up. */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Budget for the create-a-board flow (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;

// Selection & multi-object transform settings (story 7)

/** Side length of a resize handle, in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky-note side, in world units, that a resize can reach. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest object side a resize can reach, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;
/** How long "Link copied" is shown (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** Base backoff for board-existence retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// Undo settings (story 8)

/** Typing pause (ms) that ends a capture group — keystrokes closer together merge into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Maximum number of undo steps kept per user per session. */
export const UNDO_MAX_STEPS = 200;

// Free text settings (story 9)

/** Largest width an auto-width text box grows to, in world units; longer lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest width a fixed (handle-dragged) text width can reach, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets, in board units (px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of a freshly created text object. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Text line height multiplier; height = lines × size × TEXT_LINE_HEIGHT. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif text face. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Extra width added to an auto-width text box so glyphs never touch the edge. */
export const TEXT_WIDTH_PADDING_WORLD = 8;
/**
 * Average glyph width as a fraction of the font size, used for the estimate
 * fallback when no text measurer (canvas) is available. Never accurate, only
 * proportional — good enough for an initial box before the first measurement.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.52;

// Shape settings (story 10)

/** The shape kinds a user can draw; the Shape menu shows them in this order. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** The size of a shape dropped by a click (or a drag under the minimum). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/**
 * Smallest dragged shape side, in world units. A drag smaller than this in
 * either direction counts as a click and drops a standard-size shape.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters in a shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Shape outline width in world units (it scales with the board). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Fill swatch palette; `none` keeps the shape transparent inside. */
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
/** Outline swatch palette. */
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
/** Shape label text, in world units; it scales with the board like the outline. */
export const SHAPE_LABEL_FONT_PX = 16;

// Connector settings (story 10)

/** A connector drag shorter than this, in world units, creates nothing. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** How close to an arrow's line a click has to be, in screen pixels. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead leg length in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of a connection dot, in screen pixels (constant at any zoom). */
export const CONNECTOR_DOT_RADIUS_PX = 4;
