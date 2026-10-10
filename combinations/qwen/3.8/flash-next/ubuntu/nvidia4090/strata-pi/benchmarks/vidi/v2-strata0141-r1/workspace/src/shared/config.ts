/**
 * Product settings for vidi6. Every named setting lives here so later stories
 * can change behaviour without redesign (stories 2-5 add to this file).
 */

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard step). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom percentage is reported as `zoom * PERCENT`, rounded. */
export const PERCENT = 100;

/**
 * `zoomStep` snaps the result to the nearest power of ZOOM_STEP_FACTOR when it
 * is within this distance, so zooming in then out returns exactly the previous
 * zoom (no floating point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** wheel deltaMode constants (wheel events report lines or pages, not pixels). */
export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 800;

/** Numerical tolerance used when comparing camera coordinates. */
export const CAMERA_EPSILON = 1e-6;

/* ---------------------------------------------------------------------------
 * Story 2: sticky notes. Every sticky setting lives here.
 * ------------------------------------------------------------------------ */

/** A new sticky note is a STICKY_SIZE_WORLD x STICKY_SIZE_WORLD square. */
export const STICKY_SIZE_WORLD = 200;
/** Gap between the note edge and its text, in board units. */
export const STICKY_PADDING_WORLD = 16;
/** Maximum number of characters a note's text can hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in board units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below it text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen pixels) before a press becomes a drag. */
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

/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** The six colours in swatch order. */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Accessible label/tooltip for a colour: `Yellow colour`, `Pink colour`, ... */
export function stickyColorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

/* ---------------------------------------------------------------------------
 * Story 3: live collaboration. Every live setting lives here.
 * ------------------------------------------------------------------------ */

/**
 * Soft simultaneous-editor capacity (anchor `live.capacity`).
 *
 * It is a design and test target only: nothing in the product counts
 * participants or turns a 6th person away (`live.over_capacity`). Tests read
 * this setting instead of a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must be visible on every other screen within this many ms. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound of the y-websocket exponential reconnect backoff. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" confirmation stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** The outage length the catch-up requirement is verified with. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story: wall-clock latency is
 * measured and logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted,
 * because the model, the browsers and the server share one machine.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
/**
 * Nightly only (TC-29): how long two boards must sit idle, connected, with no
 * user activity. Longer than the protocol's own keep-alive window, so a
 * connection that only survives because someone is typing would fail.
 */
export const IDLE_STABILITY_TEST_MS = 45_000;
/** Nightly only (TC-30): how long the capacity soak keeps editing. */
export const CAPACITY_SOAK_MS = 60_000;
/**
 * Every live-board request goes under this path prefix, with the board address
 * after it: the Worker routes it to that board's room, the browser opens it as
 * a WebSocket.
 */
export const ROOM_ROUTE_PREFIX = '/api/rooms/';
/** A board someone is on is addressed as `/b/<boardId>`. */
export const BOARD_PATH_PREFIX = '/b/';

/* ---------------------------------------------------------------------------
 * Story 4: boards are kept. Every persistence setting lives here.
 * ------------------------------------------------------------------------ */

/**
 * The update log is compacted into a chunked snapshot once it holds this many
 * rows, so loading a long-lived board never replays every keystroke ever made.
 */
export const COMPACTION_UPDATE_COUNT = 500;
/** ... or once the log reaches this many bytes (whichever comes first). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot chunks are cut to this size, which keeps every row well below the
 * per-row limit of SQLite-backed Durable Objects.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A board that failed to load retries its load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** The board size the "large boards open quickly" requirement is verified with. */
export const PERSIST_TESTED_NOTES = 2000;
/** How long opening that board is allowed to take. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the storage tables, independent of the board document schema. */
export const STORAGE_SCHEMA_VERSION = 1;

/* ---------------------------------------------------------------------------
 * Story 5: sharing a board by link. Every share setting lives here.
 * ------------------------------------------------------------------------ */

/**
 * Clicking **New board** must land the person on the new board within this
 * many milliseconds (`share.create`). Wall-clock time is measured and reported
 * against it, never asserted on a shared machine.
 */
export const CREATE_BUDGET_MS = 2000;
/** How long the "Link copied" confirmation stays on the Copy link button. */
export const LINK_COPIED_MS = 2000;
/**
 * First wait before re-checking whether a board link exists when the service
 * cannot be reached (`share.unreachable`); each later wait doubles, capped at
 * `RECONNECT_MAX_BACKOFF_MS` (story 3).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
/** Every board API call goes under this path prefix. */
export const BOARD_API_PREFIX = '/api/boards';

/* ---------------------------------------------------------------------------
 * Story 7: selecting, moving and resizing objects. Every selection setting
 * lives here (anchor `sel.size_limits`, `sel.nudge`).
 * ------------------------------------------------------------------------ */

/**
 * The side of one resize handle, in **screen** pixels: handles stay this big at
 * any zoom (`sel.resize`).
 */
export const HANDLE_SIZE_PX = 8;
/** The smallest a sticky note can be resized to, in board units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/**
 * The largest any object of any type can be resized to, in board units - one
 * global maximum for every object type (`sel.size_limits`).
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** One arrow-key nudge, in board units. */
export const NUDGE_STEP_WORLD = 1;
/** One Shift+arrow nudge, in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* ---------------------------------------------------------------------------
 * Story 9: free text anywhere on the board. Every text setting lives here
 * (anchors `text.auto_width`, `text.fixed_width`, `text.size`, `text.limit`).
 * ------------------------------------------------------------------------ */

/** How wide a text object may get before its lines wrap (`text.auto_width`). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** The narrowest a text object may be made with a side handle (`text.fixed_width`). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** How many characters one text object can hold (`text.limit`). */
export const TEXT_MAX_CHARS = 5000;
/** The four text sizes, in board units (`text.size`). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Text created by the Text tool starts at this size. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** The four sizes, in toolbar order. */
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];
/** Accessible name of a size: `Small size`, `Extra large size`, ... */
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};
/** Line spacing multiplier: one line is TEXT_SIZES[size] * TEXT_LINE_HEIGHT tall. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif stack, used for measuring and for rendering. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * Slack added to an automatic text box beyond its widest line, so letters are
 * never flush against the edge a handle is grabbed at. Clamped by
 * TEXT_MAX_AUTO_WIDTH_WORLD, so an automatic box is never wider than the maximum.
 */
export const TEXT_BOX_PADDING_WORLD = 8;
/**
 * Average glyph width as a fraction of the font size, used only when this
 * environment cannot measure text at all (no canvas): an estimate, never a throw.
 */
export const TEXT_ESTIMATED_GLYPH_WIDTH_RATIO = 0.55;

/* ---------------------------------------------------------------------------
 * Story 8: undo and redo of a person's own changes. Every undo setting lives
 * here (anchors `undo.typing`, `undo.limit`).
 * ------------------------------------------------------------------------ */

/**
 * Typing that pauses this long ends the current undo step (`undo.typing`):
 * everything typed inside one burst is undone together, and `boundary()` cuts a
 * step short before this so a drag or a delete is never merged with its
 * neighbours.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/**
 * How many of a person's own steps one board remembers (`undo.limit`). Adding a
 * step beyond this drops the oldest one.
 */
export const UNDO_MAX_STEPS = 200;

/* ---------------------------------------------------------------------------
 * Story 10: shapes and the arrows that stay attached to them. Every shape and
 * connector setting lives here (anchors `shape.kind`, `shape.size`,
 * `shape.label`, `shape.colours`, `connector.endpoints`, `connector.tolerance`,
 * `tool.shortcuts`).
 * ------------------------------------------------------------------------ */

export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Shown in the toolbar kind menu and in each shape's accessible name. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/** A click (no drag) creates this square, centred on the click. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** A drag smaller than this is a click, not a resize; it is also the resize minimum. */
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/**
 * Named colour keys only - a colour is a key into these maps, never a raw CSS
 * string, so both collaborators always resolve the same value (`shape.colours`).
 */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#ffffff',
  blue: '#bcd7f7',
  green: '#c3e9c9',
  yellow: '#fdf3c0',
  pink: '#fbd3e0',
  grey: '#e2e4e8',
} as const;
export type ShapeFillColor = keyof typeof SHAPE_FILL_COLORS;
/** The palette in swatch order: 'no fill' first, then the six fills. */
export const SHAPE_FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as ShapeFillColor[];
export const DEFAULT_SHAPE_FILL: ShapeFillColor = 'white';

export const SHAPE_STROKE_COLORS = {
  dark: '#202124',
  black: '#000000',
  blue: '#1a73e8',
  green: '#188038',
  red: '#d93025',
  grey: '#9aa0a6',
} as const;
export type ShapeStrokeColor = keyof typeof SHAPE_STROKE_COLORS;
export const SHAPE_STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as ShapeStrokeColor[];
export const DEFAULT_SHAPE_STROKE: ShapeStrokeColor = 'dark';

/** Swatch labels: `<colour> fill` / `<colour> outline`; 'none' reads "no fill". */
export function shapeFillLabel(colour: ShapeFillColor): string {
  return colour === 'none' ? 'no fill' : `${colour} fill`;
}
export function shapeStrokeLabel(colour: ShapeStrokeColor): string {
  return `${colour} outline`;
}

/** Endpoints closer than this (world units) are a tap, not an arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Screen-space tolerance for selecting an arrow (`connector.tolerance`). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** How long the arrowhead is (world units); its tip lands on the end point. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** The side-midpoint attach dots stay this big at any zoom (`connector.dot`). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* ---------------------------------------------------------------------------
 * Story 11: freehand pen strokes. Every pen and stroke setting lives here
 * (anchors `pen.draw`, `pen.options`, `pen.smooth`, `pen.select`,
 * `pen.long_stroke`).
 * ------------------------------------------------------------------------ */

/**
 * The six pen colours. Like the shape palette, a colour is a **key** into this
 * map, never a raw CSS string, so both collaborators always draw the same line
 * (`pen.options`).
 */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;
/** The six colours, in swatch order. */
export const PEN_COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];
/** Accessible name of a swatch: `black pen`, `blue pen`, ... */
export function penColorLabel(colour: PenColor): string {
  return `${colour} pen`;
}

/** Pen thicknesses, in **board** units, so a stroke scales with zoom (`pen.options`). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
/** The three thicknesses, in toolbar order. */
export const PEN_THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
export const PEN_THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** What a new stroke is drawn with (`pen.options`). */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/**
 * How far the finished stroke may stray from the path that was drawn, in
 * **screen** pixels (`pen.smooth`): the simplification tolerance is this divided
 * by the zoom held while drawing.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** Recorded points one stroke holds before it is finished and continued (`pen.long_stroke`). */
export const STROKE_MAX_POINTS = 5000;
/** How far from the line a click still counts as on it, in **screen** pixels (`pen.select`). */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** The smallest a stroke may be resized to, in board units. */
export const STROKE_MIN_SIZE_WORLD = 4;

/** Single keys that pick a tool (`tool.shortcuts`); one entry per tool id. */
export const TOOL_SHORTCUTS = {
  v: 'select',
  n: 'sticky',
  t: 'text',
  s: 'shape',
  l: 'connector',
  p: 'pen',
  i: 'image',
  c: 'comment',
} as const;
