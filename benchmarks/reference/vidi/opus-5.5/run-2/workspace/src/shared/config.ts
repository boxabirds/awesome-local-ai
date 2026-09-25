/**
 * Named product settings. Every tunable number lives here so it can be changed
 * in one place without redesign. Later stories add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the start point (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/**
 * Smallest on-screen distance between grid dots, in CSS pixels. When zooming out would
 * pack dots closer than this, the grid shows every 2nd (4th, ...) dot instead so it
 * stays readable and cheap to paint. At 100% and above this never applies.
 */
export const GRID_MIN_SCREEN_SPACING = 8;
/** Radius of one grid dot, in CSS pixels (constant on screen at every zoom). */
export const GRID_DOT_RADIUS_PX = 1;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;

// ---- Story 2: sticky notes ----
/** Width and height of a sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when the remaining characters are <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (CSS px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (CSS px) after which a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
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
/** Inner padding of a note's text area, in world units. */
export const STICKY_PADDING_WORLD = 16;
/** Line height of note text, relative to the font size. */
export const STICKY_LINE_HEIGHT = 1.25;
/** Gap between a selected note and its floating toolbar, in screen pixels. */
export const NOTE_TOOLBAR_GAP_PX = 8;

// ---- Story 3: live collaboration ----
/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---- Story 4: persistence ----
/** Compact the update log into a snapshot when this many log rows exist... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's total bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Size of one snapshot row. SQLite-backed Durable Objects limit a row (and a BLOB) to
 * 2 MB at the time of writing; 512 KiB stays far below that.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose board failed to load retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Largest board the open-time guarantee is tested with (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** A board of PERSIST_TESTED_NOTES notes shows all its notes within this time (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (not the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Story 5: share a board with a link ----
/** Boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window; must match wrangler.jsonc `ratelimits` (tests/unit/create-board.test.ts TC-03). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** Fresh ids tried when a generated id already belongs to a board (PRD share.unique). */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Create a board opens the new board within this time (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long "Link copied" shows after Copy link (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Story 7: select, move, resize and delete several objects ----
/** Side of a selection resize handle, in screen pixels (constant at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest width/height a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width/height any object can be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow key nudge, in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift + arrow key nudge, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Story 8: undo and redo my own changes ----
/** A typing pause of at least this long ends one undo step (PRD undo.typing). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Undo steps kept per person; the oldest is dropped beyond this (PRD undo.limit). */
export const UNDO_MAX_STEPS = 200;

// ---- Story 9: free text ----
/** Auto-width text grows up to this width (world units), then wraps (PRD text.auto_width). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest fixed width a side handle can give a text object, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters in one text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in world units (CSS px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height of free text, relative to its font size. */
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * Extra width (world units) an auto-width box gets beyond its longest line, so the caret
 * and sub-pixel rounding never force a wrap. Never makes a box wider than
 * TEXT_MAX_AUTO_WIDTH_WORLD.
 */
export const TEXT_AUTO_WIDTH_PADDING_WORLD = 2;
/** Average glyph width relative to the font size, used when text cannot be measured. */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.55;

// ---- Story 10: shapes and connectors ----
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Width and height of a shape dropped by a click (or a drag smaller than the minimum), in world units. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** A drag smaller than this in either direction creates a default-size shape instead. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum number of characters in a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline width of a shape, in world units. */
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
/** Font size of shape labels, in world units (CSS px at 100% zoom). */
export const SHAPE_LABEL_FONT_PX = 16;
/** Line height of shape labels, relative to the font size. */
export const SHAPE_LABEL_LINE_HEIGHT = 1.3;
/** Space between a shape's label box and its outline, in world units. */
export const SHAPE_LABEL_PADDING_WORLD = 8;
/** A connector drag shorter than this (world units) creates no arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** A click within this many screen pixels of an arrow's line selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Length of the arrowhead, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of a connection dot, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Arrow line colour. */
export const CONNECTOR_COLOR = '#263238';
