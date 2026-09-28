/**
 * Product settings shared by the client and (later) the worker.
 * Every tunable number for story 1 lives here; stories 2-5 add their own.
 */

/** Smallest allowed zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom applied by one button / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to still work (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel `deltaMode === DOM_DELTA_LINE`: pixels per line. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Wheel `deltaMode === DOM_DELTA_PAGE`: pixels per page (fraction of viewport height). */
export const WHEEL_PAGE_HEIGHT_FRACTION = 0.9;

/** Conversions used by the zoom indicator. */
export const PERCENT_PER_ZOOM = 100;

/**
 * `zoomStep` snaps the resulting zoom to the nearest `ZOOM_STEP_FACTOR^n`
 * within this relative epsilon, so a step in followed by a step out returns
 * to exactly the previous zoom (no floating-point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// ----------------------------------------------------------- sticky notes (story 2)

/** Sticky note width and height in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters in a sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Character counter appears when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;

/** Minimum pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Six preset sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour for newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ----------------------------------------------------------- live collaboration (story 3)

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1 second budget for change delivery. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ----------------------------------------------------------- persistence (story 4)

/** Number of un-compacted update rows that triggers a snapshot compaction. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Total bytes of un-compacted update rows that triggers a snapshot compaction. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Snapshot rows are written in chunks of this size so a single row never comes
 * near the SQLite-backed Durable Object row size limit. Chunk size is the first
 * escalation knob if a row-size limit is ever hit.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** How long a room remembers a failed board load before retrying on a new connection. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** Board size the persistence path is tested at; also the large-board load test size. */
export const PERSIST_TESTED_NOTES = 2000;

/** Client-side budget from navigation to full render at PERSIST_TESTED_NOTES. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version recorded in `board_meta`; future migrations branch on it. */
export const STORAGE_SCHEMA_VERSION = 1;

// ----------------------------------------------------------- share / create (story 5)

/** Maximum boards a visitor may create within BOARD_CREATE_PERIOD_SECONDS. */
export const BOARD_CREATE_LIMIT = 10;

/** Rate limit window in seconds; must match wrangler.jsonc ratelimits. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** Maximum ID collision retries when creating a board. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create budget from click to board open (ms). */
export const CREATE_BUDGET_MS = 2000;

/** Duration "Link copied" is shown before reverting (ms). */
export const LINK_COPIED_MS = 2000;

/** Base delay for board existence check retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ----------------------------------------------------------- selection & transforms (story 7)

/** Resize-handle edge length in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;

/** Smallest a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any board object may be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ----------------------------------------------------------- undo (story 8)

/** Typing pause (ms) that ends an undo capture window (groups typing bursts). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum number of undo steps retained per tab. */
export const UNDO_MAX_STEPS = 200;

// ----------------------------------------------------------- free text (story 9)

/** Maximum automatic width of a text object in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum fixed width of a text object in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum number of characters in a text object. */
export const TEXT_MAX_CHARS = 5000;

/** Four size presets for text objects. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Default size for newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line-height multiplier for text objects. */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// ----------------------------------------------------------- shapes (story 10)

/** Allowed shape kinds. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Standard shape size (both dimensions) when created by a click (world units). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** Below this in either dimension a drag becomes a click (world units). */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Maximum label length in characters. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Stroke width for shape outlines (world units). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Shape fill colour palette. */
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

/** Shape stroke colour palette. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Default fill for new shapes. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';

/** Default stroke for new shapes. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

// ----------------------------------------------------------- connectors (story 10)

/** Minimum connector length below which the drag is rejected (world units). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** Click tolerance for selecting a connector (screen pixels). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Connector line width (world units). */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Arrowhead size (world units). */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Connection dot radius on hover (screen pixels). */
export const CONNECTOR_DOT_RADIUS_PX = 4;
