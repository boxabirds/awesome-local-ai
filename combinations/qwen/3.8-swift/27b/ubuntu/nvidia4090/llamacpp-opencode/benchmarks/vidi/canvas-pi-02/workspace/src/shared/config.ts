// Named product settings for vidi6. All stories add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom step multiplies/divides the zoom by this factor (125%). */
export const ZOOM_STEP_FACTOR = 1.25;
/**
 * Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
 * for a wheel event with ctrl/cmd held.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest distance (in world units) the board is tested to pan to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiplier converting a zoom to its percentage label (1.0 -> 100). */
export const PERCENT = 100;
/**
 * After a step zoom, snap the result to the nearest ZOOM_STEP_FACTOR^n when
 * within this absolute epsilon, so repeated in/out steps return exactly.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Pixel size used when a wheel event reports deltaMode LINE. */
export const WHEEL_DELTA_LINE_PX = 16;
/** Wheel deltaMode values (DOM spec). */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/**
 * Fallback flush delay (ms) for rAF-batched camera updates: guarantees a
 * flush when the environment produces no paint frames (headless WebKit).
 * In normal browsers the rAF (next paint) always wins over this timer.
 */
export const CAMERA_FLUSH_FALLBACK_MS = 32;

/* --- Story 2: sticky notes --- */

/** Sticky note side length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters of text a sticky note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note text size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note text size (px at 100% zoom); overflow fades below it. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) before a press on a note becomes a drag. */
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
/** Colour of a newly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* --- Story 3: live collaboration --- */

/** Soft capacity: the number of simultaneous editors the board is designed
 *  and tested for. Deliberately never enforced — a 6th person is never
 *  refused (PRD live.capacity / live.over_capacity). */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change must appear on every other screen within this. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Maximum backoff (ms) between reconnection attempts, passed to the
 *  WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long (ms) the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up: the outage length used by the catch-up verification. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** The room pings every open socket at this cadence (ms) so the y-websocket
 *  30 s no-message watchdog never drops an idle connection. Must stay well
 *  under the watchdog; 10 s leaves a 3x margin. */
export const KEEP_ALIVE_INTERVAL_MS = 10_000;

/* --- Story 4: persistence --- */

/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size: keeps every row well under the platform per-row size
 *  limit of SQLite-backed Durable Objects. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries loading at most this often (ms) on a new
 *  connection. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: the board size that must open within budget. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: the open-time budget (ms). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the storage tables (storage_meta.storage_schema_version). The
 *  Yjs document schema version is separate and unchanged. */
export const STORAGE_SCHEMA_VERSION = 1;

/* --- Story 5: share a board with others using a link --- */

/** PRD share.rate_limit: boards one visitor may create per period. */
export const BOARD_CREATE_LIMIT = 10;
/** Creation window in seconds. Must match the BOARD_CREATE_LIMITER entry in
 *  wrangler.jsonc (TC-03 asserts the two cannot drift). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** Id-collision attempts per creation (share.unique): a taken code gets a
 *  different one, up to this many. */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** PRD share.create: a new board must open within this (ms). */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel shows "Link copied" before reverting (ms). */
export const LINK_COPIED_MS = 2000;
/** First retry delay after a failed board existence check (ms); the backoff
 *  doubles per attempt, capped at BOARD_CHECK_RETRY_MAX_DELAY_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
/** Delay cap (ms) for the existence-check backoff (PRD share.check: about a
 *  minute of total retries). */
export const BOARD_CHECK_RETRY_MAX_DELAY_MS = 5000;
/** Existence-check attempts (including the first) before the board is
 *  declared missing (share.check: an object-storage hiccup must not show
 *  "not found" for a board that exists). */
export const BOARD_CHECK_MAX_RETRIES = 8;

/* --- Story 7: select, move, resize and delete several objects at once --- */

/** Screen-space size (px) of the 8 resize handles on the selection box. */
export const HANDLE_SIZE_PX = 8;

/** Minimum side length (world units) of a sticky note on resize. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** No object may be resized larger than this (world units). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step (world units). */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge step (world units). */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* --- Story 8: undo and redo my own changes --- */

/** Typing pause (ms) that ends a typing burst: consecutive typing within
 *  this window is one undo step (undo.typing). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum steps a personal undo history keeps; the oldest step is
 *  discarded beyond this (undo.limit). */
export const UNDO_MAX_STEPS = 200;

/* --- Story 9: free text anywhere on the board --- */

/** Maximum automatic width (board units): auto-width text wraps beyond it. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum width (board units) a fixed width may take (side handle drag). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters a text object may hold (text.limit). */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in board units (text.size). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of a newly created text object. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line-height multiplier (height = lines × size × this). */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif font for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Horizontal padding (board units) inside a text box, each side. */
export const TEXT_PADDING_WORLD = 4;
/** Average glyph width as a fraction of the font size; the measurement
 *  fallback when no canvas is available (jsdom, workers). */
export const TEXT_GLYPH_WIDTH_RATIO = 0.6;

/* --- Story 10: shapes and connectors --- */

/** The shape kinds the Shape tool can draw (shape.create_drag). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Size (world units, per side) of a shape created by a click or a drag
 *  smaller than the minimum (shape.create_click). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Minimum drag size (world units, per dimension) that creates a
 *  drag-sized shape; smaller drags are treated as clicks (shape.create_click). */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters a shape label may hold (shape.label). */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline thickness (world units) of a shape (shape.style). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Fill colours for the shape toolbar, incl. 'none' (six colours + no fill,
 *  shape.style). */
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
/** Outline colours for the shape toolbar (shape.style). */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
/** Fill of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
/** Outline colour of a newly created shape. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Minimum resolved length (world units) for a connector to be created
 *  (connector.no_accidental). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Screen-pixel distance within which a click selects a connector
 *  (connector.select). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Line thickness (world units) of a connector. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size (world units) of a connector. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Screen-pixel radius of the connector's side dots and end handles. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* --- Story 11: sketch freehand with a pen --- */

/** The six pen colours (pen.options). */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** Stroke thicknesses in world units (pen.options); strokes scale with zoom.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
/** The pen's colour presets (keys of PEN_COLORS). */
export const DEFAULT_PEN_COLOR: keyof typeof PEN_COLORS = 'black';
/** Thickness of a newly created stroke (keys of PEN_THICKNESS_WORLD). */
export const DEFAULT_PEN_THICKNESS: keyof typeof PEN_THICKNESS_WORLD = 'medium';
/** RDP simplification tolerance in SCREEN pixels at the drawing zoom
 *  (pen.smooth): no finished point lies farther than this from the drawn
 *  path. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** Raw points per stroke before a continuous stroke is split into
 *  consecutive, seamlessly-joined strokes (pen.long_stroke). */
export const STROKE_MAX_POINTS = 5000;
/** Screen-pixel distance within which a click selects a stroke's line
 *  (pen.select); the larger of this and half the thickness wins. */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Minimum side length (world units) of a stroke's bbox on resize. */
export const STROKE_MIN_SIZE_WORLD = 4;

/* --- Story 12: drop images onto the board --- */

/** The image MIME types accepted for board images (image.types). The
 *  server re-checks by magic bytes; the client pre-filters by File.type. */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Maximum upload size in bytes (10 MB) (image.size_limit). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum files accepted in one add action (image.count_limit). */
export const IMAGE_MAX_FILES_PER_ADD = 20;
/** Longest-side cap (board units) an image is placed at (image.placement_size). */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
/** Minimum side length (board units) of an image on resize (image.aspect_resize). */
export const IMAGE_MIN_SIZE_WORLD = 16;
/** Gap (board units) between images laid out in a row (image.drop). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;
/** An upload in flight longer than this (ms) renders as unfinished
 *  (image.unfinished). */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
/** Auto-retry cadence (ms) for pending image uploads (image.uploads). */
export const IMAGE_UPLOAD_RETRY_INTERVAL_MS = 5_000;
/** PRD image.rate_limit: images one visitor may upload per period. */
export const IMAGE_UPLOAD_LIMIT = 60;
/** Upload rate-limit window in seconds. Must match the ASSET_UPLOAD_LIMITER
 *  entry in wrangler.jsonc (the integration test asserts they cannot drift). */
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;
/** Cache-Control max-age (seconds) for served assets: keys are unguessable
 *  and never change, so serve immutable (image.shared). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
/** Number of head bytes read for magic-byte type sniffing (image.types). */
export const IMAGE_SNIFF_BYTES = 12;
/** ImageObject re-render cadence (ms) while any image is uploading, so the
 *  derived `unfinished` state appears without user interaction. */
export const IMAGE_UPLOAD_TICK_MS = 30_000;
