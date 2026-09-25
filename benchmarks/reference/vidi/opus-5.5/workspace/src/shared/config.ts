/**
 * Named product settings. Change values here only; every consumer imports them.
 */

/** Minimum zoom (screen px per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative zoom change per button click / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd-wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ---- Sticky notes (story 2) ----

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters (UTF-16 code units) in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note text size, in world px (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note text size, in world px; below this text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) after which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six note colours, in toolbar order. */
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

// ---- Live collaboration (story 3) ----

/** Soft capacity: the number of simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other connected screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Length of the network outage in the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---- Persistence (story 4) ----

/** Compact the update log into a snapshot when this many log rows exist... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot rows are at most this big. Cloudflare documents a 2 MB maximum string/BLOB/row size
 * for SQLite-backed Durable Objects (checked 2026-09); this stays far below it.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose saved board could not be loaded retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Largest board size tested and guaranteed to open within BOARD_LOAD_BUDGET_MS (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** A board of PERSIST_TESTED_NOTES notes shows all of them within this time of navigating (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the room's SQLite tables (the Yjs document has its own meta.schemaVersion). */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Sharing (story 5) ----

/** Boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window. Must match wrangler.jsonc `ratelimits` (unit test TC-03 asserts equality). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** New ids tried before board creation gives up (a collision of 128-bit ids is practically impossible). */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** A new board opens within this time of clicking Create a board (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long the Copy link button says "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Multi-select, move, resize (story 7) ----

/** Side of each selection resize handle in screen px (the same at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest width/height a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width/height any object can be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow key nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Undo and redo (story 8) ----

/** A typing pause of at least this long ends one undo step (burst) and starts the next. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Each person's undo history keeps at most this many steps; the oldest is dropped first. */
export const UNDO_MAX_STEPS = 200;

// ---- Free text (story 9) ----

/** Auto-width text grows to its longest line up to this width (world units), then wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Narrowest fixed width a side-handle drag can set (world units). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters (UTF-16 code units) in one text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in world units (px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif font for text objects (CSS font-family). */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * Extra width (world units) an auto-width box gets beyond its longest line, so the caret at the
 * end of the line has room and small font-rendering differences never wrap a line early.
 */
export const TEXT_AUTO_WIDTH_PADDING_WORLD = 4;

// ---- Shapes and connectors (story 10) ----

/** Shape kinds, in Shape menu order. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Width and height of a shape dropped by a click (or a drag below SHAPE_MIN_SIZE_WORLD), world units. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** A drag smaller than this in either direction creates a default-size shape instead; also the resize minimum. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum number of characters (UTF-16 code units) in one shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Shape outline width, world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Shape label font size, world units (px at 100% zoom). */
export const SHAPE_LABEL_FONT_PX = 16;
/** Fill swatches, in toolbar order ('none' = no fill). */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** Outline swatches, in toolbar order. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Arrows shorter than this (world units), or drags that moved less, are not created. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** A click within this many screen px of an arrow's line selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line width, world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead length, world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of the connection dots shown on the object under the pointer, screen px. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Arrow line colour. */
export const CONNECTOR_COLOR = '#263238';

// ---- Freehand pen (story 11) ----

/** The six pen colours, in toolbar order. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** Pen thicknesses (stroke width) in world units, so strokes scale with zoom like everything else. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
/** A finished stroke stays within this many screen px (at the zoom used while drawing) of the drawn path. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** A stroke being drawn is finished and continued as a new stroke when it reaches this many recorded points. */
export const STROKE_MAX_POINTS = 5000;
/** A click within this many screen px of a stroke's line (or half its thickness, if larger) selects it. */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest width/height a stroke can be resized to, in world units. */
export const STROKE_MIN_SIZE_WORLD = 4;

// ---- Images (story 12) ----

/** Image types that can be added (judged by content on the server, by File.type on the client). */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
/** Largest image file that can be added: 10 MB. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** At most this many images are added by one drop, paste or pick; the rest are skipped. */
export const IMAGE_MAX_FILES_PER_ADD = 20;
/** A new image's longest side is scaled down to at most this (world units); never scaled up. */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
/** Smallest width/height an image can be resized to, in world units. */
export const IMAGE_MIN_SIZE_WORLD = 16;
/** Gap between images added side by side in one action, world units. */
export const IMAGE_LAYOUT_GAP_WORLD = 24;
/** An upload still not finished after this long is shown to everyone as unfinished. */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
/** Uploads one visitor may make per IMAGE_UPLOAD_PERIOD_SECONDS. Must match wrangler.jsonc `ratelimits`. */
export const IMAGE_UPLOAD_LIMIT = 60;
/** Upload rate-limit window. Must match wrangler.jsonc `ratelimits`. */
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;
/** Stored images never change (new upload = new key), so they are cached for a year. */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
/** Bytes read from the start of a file to decide its image type. */
export const IMAGE_SNIFF_BYTES = 12;
