// Product settings for the vidi6 board.
// Story 2 onwards add their own named settings to this file.

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** How much one zoom step multiplies/divides the zoom level. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to work without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversion to CSS pixels (deltaMode: 0 = pixels, 1 = lines, 2 = pages).
export const WHEEL_PIXELS_PER_LINE = 16;
export const WHEEL_PIXELS_PER_PAGE = 800;

/** Zoom is reported as a whole-number percentage. */
export const PERCENT_PER_ZOOM = 100;
/** zoomStep snaps to the nearest ZOOM_STEP_FACTOR^n within this tolerance. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Story 2: sticky notes.

/** Sticky note size in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;
/** Longest text a sticky note keeps. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when this many characters (or fewer) are left. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size in board units (at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Screen pixels a pointer must move after a press before it becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset note colours, in toolbar order. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** A new note is yellow. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// Story 3: live collaboration.

/**
 * Simultaneous-editor capacity the board is designed and tested for.
 *
 * Soft on purpose: neither the Worker nor the room counts participants, so a
 * `(MAX_CONCURRENT_EDITORS + 1)`-th person is never refused (`live.over_capacity`).
 * Tests read this setting instead of a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** `live.propagate`: how long a change may take to appear on another screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1_000;
/** Passed to `WebsocketProvider.maxBackoffTime`: the longest wait between retries. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2_000;
/** The outage length the `live.catch_up` verification disconnects a person for. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story: on one shared machine the
 * 1-second `LIVE_UPDATE_LATENCY_BUDGET_MS` is measured and logged, never asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// Story 4: return to a board and find everything as it was left.

/** Compact the update log into a snapshot when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when the log's bytes reach this many. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size; keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A load-failed room retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/**
 * How long the client waits for a socket that has never been opened before showing a
 * load-failure badge. The socket keeps trying; this only decides when the badge tells
 * the truth, and a load slower than this still ends with the board appearing.
 */
export const BOARD_LOAD_TIMEOUT_MS = 5000;
/** `persist.large_board`: the board size the open-time guarantee is tested at. */
export const PERSIST_TESTED_NOTES = 2000;
/** `persist.large_board`: how long opening that board may take. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the storage tables themselves (the document schema has its own). */
export const STORAGE_SCHEMA_VERSION = 1;

// Story 5: share a board with others using a link.

/** `share.create`: how long clicking New board may take before the board is visible. */
export const CREATE_BUDGET_MS = 2_000;
/** `share.copy`: how long the Share panel says "Link copied". */
export const LINK_COPIED_MS = 2_000;
/**
 * `share.unreachable`: the first wait before re-checking a board link; each further
 * failure doubles it, up to story 3's `RECONNECT_MAX_BACKOFF_MS`.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1_000;

// Story 7: select, move, resize and delete several objects at once.

/** The side of a resize handle, in screen pixels (it never scales with zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky note, in board units.
 */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest object of any type, in board units — one global maximum for every type. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** How far one arrow key press moves the selection, in board units. */
export const NUDGE_STEP_WORLD = 1;
/** How far Shift+arrow moves the selection, in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// Story 8: undo and redo of my own changes.

/**
 * The typing pause that ends an undo step (`undo.typing`): keystrokes that follow each
 * other within this many milliseconds are one step to undo.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** How many steps one person's undo history keeps; older steps are discarded. */
export const UNDO_MAX_STEPS = 200;

// Story 9: free text anywhere on the board.

/** How wide an automatic text box may get before its lines wrap, in board units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** The narrowest a text box can be fixed to by a side handle, in board units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Longest text a text object keeps. */
export const TEXT_MAX_CHARS = 5_000;
/** The four text sizes, in board units of font size. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Text created by the Text tool starts at M. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif, shared by the text on screen and the measurer. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * How much room an automatic text box leaves past its longest line, in board units, so a
 * selected text's right handle never sits on top of the last glyph. Capped, together with
 * the measured line, by `TEXT_MAX_AUTO_WIDTH_WORLD`.
 */
export const TEXT_BOX_PADDING_WORLD = 8;

// Story 10: shapes, and the arrows that connect them.

/** The three kinds of shape this board draws, in the order the Shape menu lists them. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** A shape drawn by clicking (or by a drag too small to be a shape) is this big. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** A drag smaller than this in either direction counts as a click; a shape is never smaller. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Longest label a shape keeps. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** The outline of every shape, in board units, so it thickens with the board as everything else does. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** The seven fills the shape toolbar offers: six colours and no fill. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** The six outlines the shape toolbar offers. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type ShapeFillColor = keyof typeof SHAPE_FILL_COLORS;
export type ShapeStrokeColor = keyof typeof SHAPE_STROKE_COLORS;
/** A new shape is a white rectangle with a dark outline (PRD: "a white rectangle with a dark outline"). */
export const DEFAULT_SHAPE_FILL: ShapeFillColor = 'white';
export const DEFAULT_SHAPE_STROKE: ShapeStrokeColor = 'dark';
/** A connector drag shorter than this (board units) is a mis-click, not an arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** How close to an arrow's line (screen pixels) a click has to be to select it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** The arrow's own line width, in board units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** The arrowhead's length and half-width, in board units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** The radius of a connection dot, in screen pixels (it never scales with zoom). */
export const CONNECTOR_DOT_RADIUS_PX = 4;
