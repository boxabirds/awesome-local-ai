/**
 * Product settings shared across the app. Stories 2-5 add to this file.
 */

/** Minimum board zoom: 10% of the default (100%) scale. */
export const ZOOM_MIN = 0.1;

/** Maximum board zoom: 400% of the default (100%) scale. */
export const ZOOM_MAX = 4;

/** Multiplicative step applied by the zoom buttons and Ctrl/Cmd +/- shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a Ctrl/Cmd+wheel event = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Farthest distance (in world units) that navigation is verified to stay exact. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes (story 2) -----------------------------------------------

/** Side length of a sticky note, in world units. Notes are square. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows once the note is within this many characters of STICKY_TEXT_MAX_CHARS. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size (world px, at 100% zoom), for short text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size; below this, overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky note colours, keyed by product name. */
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

// --- Live collaboration (story 3) -----------------------------------------

/** Soft capacity: the number of simultaneous editors the product is designed and tested for. Never enforced (a 6th person is not turned away). */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD `live.propagate`: a change must appear on every other screen within this budget, measured sender-side to receiver-side. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to the y-websocket provider's `maxBackoffTime`: longest pause between reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays visible after a reconnection before it hides. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD `live.catch_up` verification: the outage length used by the catch-up tests. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Board persistence (story 4) ------------------------------------------

/** Compact the update log when this many rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** ... or when the log's total bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Snapshot chunk row size: keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A LoadFailed room retries its load at most this often (new connections before the interval are closed 4500 without a reload attempt). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** PRD `persist.large_board`: the board size persistence is tested at. */
export const PERSIST_TESTED_NOTES = 2000;

/** PRD `persist.large_board`: a saved board of PERSIST_TESTED_NOTES notes must open within this. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the storage tables (storage_meta.storage_schema_version). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing (story 5) -------------------------------------------------------

/** Maximum boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS. */
export const BOARD_CREATE_LIMIT = 10;

/** Rate-limit window for board creation (must match wrangler.jsonc ratelimits). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** How many times createBoard retries when it hits an id collision. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create: board creation budget in ms. */
export const CREATE_BUDGET_MS = 2000;

/** How long "Link copied" stays visible on the Share panel button. */
export const LINK_COPIED_MS = 2000;

/** Base backoff for board existence check retries (doubles each attempt). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Multi-select, group move / resize / nudge / delete (story 7) ----------

/** Small keyboard nudge step, world units (Arrow keys). */
export const NUDGE_STEP_WORLD = 1;

/** Large keyboard nudge step, world units (Shift+Arrow). */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** A note resized by a group gesture never shrinks below this (world units). */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Group resize never grows any object above this (world units). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Screen-space size of a resize handle (its world-space size is `1 / zoom`). */
export const HANDLE_SIZE_PX = 8;

// --- Per-user undo / redo (story 8) -----------------------------------------

/** Typing pause (ms) that ends a burst: own keystrokes closer together merge into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Undo steps kept per user; the oldest step is dropped beyond this (undo.limit). */
export const UNDO_MAX_STEPS = 200;

// --- Free text (story 9) ----------------------------------------------------

/** Maximum width of an auto-width text object, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum width for a fixed-width text object, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum number of characters a text object may hold. */
export const TEXT_MAX_CHARS = 5000;

/** Text font sizes (world px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** CSS line-height multiplier for text. */
export const TEXT_LINE_HEIGHT = 1.3;

/** CSS font family used by both the canvas measurer and the rendered text. */
export const TEXT_FONT_FAMILY = 'Inter, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Estimated glyph width ratio (fraction of font size) for the fallback measurer. */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.6;

// --- Shapes and connectors (story 10) ----------------------------------------

/** The three shape kinds. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Standard size (world units) for a click-created or tiny-drag shape. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** Minimum size (world units) in either dimension; below this a click is assumed. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Maximum label length (characters) for a shape. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Stroke width (world units) for shape outlines. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Fill colours for shapes, keyed by product name. */
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

/** Outline colours for shapes, keyed by product name. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Default fill for newly created shapes. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';

/** Default outline for newly created shapes. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** Minimum connector length (world units); shorter drags are rejected. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** Screen-pixel tolerance for selecting a connector by clicking near its line. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Stroke width (world units) for connector lines. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Arrowhead size (world units) for connectors. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Screen-pixel radius of the connection dots shown while the Connector tool is active. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Pen and freehand strokes (story 11) ------------------------------------

/** The six pen colours, keyed by product name. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;

/** Pen thicknesses in world units (strokes scale with zoom like everything else). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** Colour of newly drawn strokes. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';

/** Thickness of newly drawn strokes. */
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/** Smoothing tolerance in screen pixels (divided by the zoom while drawing): every raw point of a finished stroke lies this far or closer to the simplified path (pen.smooth). */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/** Raw-point limit per stroke part: reaching it commits the part and continues as a new stroke from the last point (pen.long_stroke). */
export const STROKE_MAX_POINTS = 5000;

/** Screen-pixel tolerance for selecting a stroke by its line (pen.select). */
export const STROKE_HIT_TOLERANCE_PX = 6;

/** Smallest size (world units) a stroke may be resized to in either dimension. */
export const STROKE_MIN_SIZE_WORLD = 4;

// --- Images (story 12) --------------------------------------------------------

/** Accepted image MIME types (content-sniffed, not just file extension). */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Maximum upload size in bytes (10 MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Maximum number of images added in one action (drop/paste/picker). */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/** Maximum longest side (world units) of a placed image. */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/** Minimum size (world units) an image may be resized to. */
export const IMAGE_MIN_SIZE_WORLD = 16;

/** Gap between images in a row layout (world units). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;

/** An upload older than this (ms) is considered unfinished. */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

/** Maximum image uploads per IP per IMAGE_UPLOAD_PERIOD_SECONDS. */
export const IMAGE_UPLOAD_LIMIT = 60;

/** Rate-limit period for image uploads (seconds). */
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;

/** Cache-Control max-age for served assets (seconds, ~1 year). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** Number of bytes read for content sniffing. */
export const IMAGE_SNIFF_BYTES = 12;

// --- Story 13: offline resilience ------------------------------------------------

/** Maximum number of device copies kept. */
export const LOCAL_BOARD_CACHE_MAX_BOARDS = 50;

/** Storage usage / quota ratio above which pressure eviction triggers. */
export const LOCAL_STORAGE_PRESSURE_RATIO = 0.9;

/** Interval (ms) between storage pressure checks. */
export const STORAGE_CHECK_INTERVAL_MS = 60_000;

/** Budget (ms) for the offline status to appear after connection loss. */
export const OFFLINE_STATUS_BUDGET_MS = 2000;

/** Budget (ms) for opening a device copy. */
export const OFFLINE_OPEN_BUDGET_MS = 1000;

/** Timeout (ms) for waiting on IndexedDB load before continuing connected-only. */
export const LOCAL_LOAD_TIMEOUT_MS = 2000;

/** Number of consecutive WebSocket failures before re-checking board existence. */
export const ORPHAN_RECHECK_AFTER_FAILURES = 3;

/** Format version for device copies. */
export const LOCAL_COPY_FORMAT_VERSION = 1;

/** Prefix for per-board IndexedDB database names. */
export const LOCAL_DB_PREFIX = 'vidi6-board-';

/** Name of the cache index database. */
export const CACHE_INDEX_DB = 'vidi6-cache';

/** Prefix for app shell cache names. */
export const APP_SHELL_CACHE_PREFIX = 'vidi6-shell-';
