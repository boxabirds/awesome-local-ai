// Product settings for vidi6. All numbers that define board behaviour live here.

/** Minimum board zoom (10% of 1 screen pixel per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied per zoom step (buttons, Ctrl/Cmd +/-). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/trackpad zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) the board is verified to support. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Step zoom snaps to the nearest ZOOM_STEP_FACTOR^n within this many "steps". */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Percentage scaling for the zoom label. */
export const PERCENT = 100;
/** Pixels per wheel "line" delta (deltaMode LINE). */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Pixels per wheel "page" delta (deltaMode PAGE). */
export const WHEEL_PAGE_DELTA_PIXELS = 100;

// ---- Sticky notes (story 2) ----

/** Sticky note side length in board (world) units: 200 x 200. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter is visible while remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset sticky colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ---- Live collaboration (story 3) ----

/** Soft simultaneous-editor capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change must appear on other screens within 1 second. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up: verification outage length. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * y-websocket closes a socket that receives no message for 30 s. An idle
 * client sends a tiny awareness "heartbeat" at this interval (well below the
 * 30 s watchdog) so the room's awareness relay keeps the connection alive
 * with no user activity (TC-29).
 */
export const AWARENESS_HEARTBEAT_MS = 10_000;

// ---- Persistence (story 4) ----

/** Compact the update log into a snapshot when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's total byte count reaches this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot rows are split into chunks of this size (below any per-row limit). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries its load at most this often (per new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: the tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: the open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the SQLite tables (storage_meta.storage_schema_version). */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Sharing (story 5) ----

/**
 * Boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS (PRD
 * share.rate_limit: "more than 10 boards within one minute"). Must equal the
 * `ratelimits` entry in wrangler.jsonc (TC-03 asserts equality).
 */
export const BOARD_CREATE_LIMIT = 10;
/** Window for BOARD_CREATE_LIMIT, in seconds. Must match wrangler.jsonc. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/**
 * Id generation attempts per create request before giving up (share.unique:
 * a colliding code is never handed out). 128-bit ids make even one collision
 * astronomically unlikely; this is defence in depth.
 */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** PRD share.create: create + open within 2 s on a typical connection. */
export const CREATE_BUDGET_MS = 2000;
/** How long the Copy link button shows "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/**
 * BoardPage existence-check retry backoff base: delays are
 * BASE, BASE*2, BASE*4, … capped at RECONNECT_MAX_BACKOFF_MS
 * (PRD share.unreachable).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Multi-select and group transforms (story 7) ----

/** Side length (screen px) of the bounding-box resize handles at any zoom. */
export const HANDLE_SIZE_PX = 8;
/** Smallest size (board units) a sticky note may be resized to. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest size (board units) any object may be resized to. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step (board units). */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step (board units). */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Per-user undo and redo (story 8) ----

/** Typing pause (ms) that ends one typing burst (UNDO_CAPTURE_TIMEOUT_MS). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Most recent undo steps kept per user (oldest discarded beyond this). */
export const UNDO_MAX_STEPS = 200;

// ---- Free text objects (story 9) ----

/** Maximum width (board units) of an auto-width text before lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum width (board units) a fixed-width text may be dragged to. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters a text object may hold (text.limit). */
export const TEXT_MAX_CHARS = 5000;
/** The four text size presets, in board units (text.size). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height multiplier (line box = size × TEXT_LINE_HEIGHT). */
export const TEXT_LINE_HEIGHT = 1.3;

// ---- Shapes and connectors (story 10) ----

/** The three shape kinds a user can draw (shape.create_drag). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Standard size (board units) of a shape dropped by clicking (shape.create_click). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Smallest drag (board units) that counts as a drag, not a click (shape.create_click). */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters a shape label may hold (shape.label). */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline thickness (board units) of a shape (shape.style). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Fill swatches of the shape toolbar, including 'none' (shape.style). */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** Outline swatches of the shape toolbar (shape.style). */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
/** Fill of newly created shapes. */
export const DEFAULT_SHAPE_FILL = 'white';
/** Outline of newly created shapes. */
export const DEFAULT_SHAPE_STROKE = 'dark';
/** Minimum length (board units) of a connector; shorter drags create nothing
 *  (connector.no_accidental). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Clicks within this many SCREEN pixels of an arrow's line select it
 *  (connector.select). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Line thickness (board units) of a connector. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size (board units) at the end of a connector. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius (screen px) of the connection dots shown by the Connector tool
 *  (connector.hover_points). */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Standard board font (text objects stay crisp at every zoom). */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * Average glyph width as a fraction of the font size, used to estimate text
 * width when no canvas measurer is available (jsdom, worker, first paint).
 */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.6;

// ---- Pen (story 11) ----

/** The six pen colours (pen.options). */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** The three pen thicknesses, in board units (pen.options). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
/** Colour of newly created strokes. */
export const DEFAULT_PEN_COLOR: keyof typeof PEN_COLORS = 'black';
/** Thickness of newly created strokes. */
export const DEFAULT_PEN_THICKNESS: keyof typeof PEN_THICKNESS_WORLD = 'medium';
/** Smoothing fidelity: finished strokes stay within this many screen pixels
 *  of the drawn path, at the zoom used while drawing (pen.smooth). */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** A stroke being drawn is finished (and a new one started) at this many
 *  recorded points (pen.long_stroke). */
export const STROKE_MAX_POINTS = 5000;
/** Clicks within this many SCREEN pixels of a stroke's line select it
 *  (pen.select). */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest size (board units) a stroke may be resized to. */
export const STROKE_MIN_SIZE_WORLD = 4;

// ---- Images (story 12) ----

/** The raster image types the board accepts (image.types); SVG is excluded
 *  on purpose (it can carry scripts). */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Largest upload (bytes): 10 MB (image.size_limit). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Most files added in one drop/paste/pick action (image.count_limit). */
export const IMAGE_MAX_FILES_PER_ADD = 20;
/** Longest side (board units) of a placed image; longer images scale down
 *  proportionally, shorter ones keep their natural size (image.placement_size). */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
/** Smallest side (board units) an image may be resized to (image.aspect_resize). */
export const IMAGE_MIN_SIZE_WORLD = 16;
/** Gap (board units) between images placed in a row (image.drop). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;
/** An uploading image older than this renders as "unfinished" (image.unfinished). */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
/** Uploads per visitor per IMAGE_UPLOAD_PERIOD_SECONDS (image.rate_limit). Must
 *  equal the ASSET_UPLOAD_LIMITER entry in wrangler.jsonc. */
export const IMAGE_UPLOAD_LIMIT = 60;
/** Window for IMAGE_UPLOAD_LIMIT, in seconds. Must match wrangler.jsonc. */
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;
/** Served assets are immutable (keys are unguessable and never change). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
/** How many leading bytes type sniffing inspects (assets.api). */
export const IMAGE_SNIFF_BYTES = 12;
/** Shared re-render tick (ms) while any image is uploading, so the derived
 *  "unfinished" state appears without interaction (design: 30 s clock). */
export const IMAGE_STATUS_TICK_MS = 30_000;
/** Toast auto-dismiss (ms). */
export const TOAST_DURATION_MS = 4000;
