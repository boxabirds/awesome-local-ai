// All named product/settings constants for vidi6 live here.
// Stories 2-5 add to this file.

/** Minimum zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom level. */
export const ZOOM_MAX = 4;
/** Each zoom step multiplies/divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Pan distance (world units) that must remain reachable per PRD "No edges". */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Helper: clamp a value between min and max inclusive. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Number of percentage points per unit of zoom (100 for percent display). */
export const PERCENT_PER_UNIT = 100;

/**
 * Epsilon for snapping zoom steps to the nearest ZOOM_STEP_FACTOR^n.
 * Keeps "in then out" exact despite float drift.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/**
 * deltaMode conversion: pixels per unit for WHEEL deltaMode LINE.
 * One "line" is treated as a typical mouse-line scroll in CSS pixels.
 */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** deltaMode PAGE conversion: pixels per page unit. */
export const WHEEL_PAGE_HEIGHT_PX = 800;

// ---- Story 2: sticky notes -------------------------------------------------

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum note text length in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining chars <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size before text is clipped. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (CSS px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky note colours (name -> fill). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour a freshly created note starts with. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ---- Story 3: live collaboration -------------------------------------------

/**
 * Soft simultaneous-editor capacity: the number of people editing at once the
 * board is designed and tested for. Never enforced — a further joiner is never
 * refused, only the 1 s delivery guarantee stops applying beyond this number.
 * Tests use this setting rather than a hard-coded number (PRD live.capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** Change-delivery latency budget (ms) from sender screen to receiver screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound on the y-websocket provider's exponential reconnect backoff (ms). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Duration the green "Connected" confirmation badge shows after a reconnect (ms). */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the offline catch-up e2e test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---- Story 4: persistence ---------------------------------------------------

/** Compact the update log once this many rows exist (design persist.board_store). */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or once this many log bytes exist. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Snapshot chunk size. Kept well under the per-row size limit of SQLite-backed
 * Durable Objects so every row stays inside the platform limit.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A load-failed room retries loading its board at most this often (ms). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size tested for the large-board open guarantee (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** Time budget to show a PERSIST_TESTED_NOTES board (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version stamped into the storage tables so later stories can migrate them. */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Story 5: sharing a board by link --------------------------------------

/**
 * Boards one visitor may create per period (PRD share.rate_limit). Must match
 * the `BOARD_CREATE_LIMITER` binding in wrangler.jsonc — unit test TC-03 parses
 * that file and asserts equality so the two can never drift.
 */
export const BOARD_CREATE_LIMIT = 10;
/** Length of the creation-rate-limit period, in seconds. Also mirrored in wrangler.jsonc. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/**
 * How many board ids one create request may mint before giving up (share.unique).
 * A minted id that collides with an existing board is never handed out; the
 * creator tries again with a fresh random id, at most this many times.
 */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Time budget for "create a board and open it" (PRD share.create), in ms. */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's button reads "Link copied", in ms (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/**
 * How long to wait for the clipboard write before treating the browser as
 * uncooperative (share.copy_fallback). A clipboard call that never resolves —
 * some browsers leave it pending when the document lacks focus — must not leave
 * the Share panel waiting forever.
 */
export const CLIPBOARD_WRITE_TIMEOUT_MS = 1500;
/**
 * First delay before re-checking a board link whose check could not reach the
 * service (share.unreachable). Doubles per retry, capped at
 * RECONNECT_MAX_BACKOFF_MS — the same ceiling the websocket reconnect uses.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---- Story 7: selecting, moving and resizing several objects ----------------

/**
 * Size of a resize handle in *screen* CSS pixels: handles stay the same size on
 * screen at any zoom, so this is never multiplied by the camera zoom.
 */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky note, in board (world) units (sel.size_limits). */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest side of any board object, in board (world) units (sel.size_limits). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** One arrow-key nudge moves the selection this many board units (sel.nudge). */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudges this many board units (sel.nudge). */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---- Story 8: undo and redo my own changes ---------------------------------

/**
 * How long a pause in typing must be before the next keystroke starts a new undo
 * step (undo.boundaries). Keystrokes closer together than this are one step, so
 * "hello" is undone in one go rather than letter by letter. Every other action
 * (a drag, a delete, a colour) is closed by an explicit `boundary()` instead of
 * by waiting, so unrelated clicks never merge no matter how fast they follow.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/**
 * How many undo steps one tab remembers (undo.limit). The history lives in this
 * tab's memory only; the ceiling keeps a long session's Yjs items from being
 * pinned forever, and the oldest step is the one that goes.
 */
export const UNDO_MAX_STEPS = 200;

// ---- Story 9: free text -----------------------------------------------------

/** Largest width an auto-width text object grows to, in board (world) units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest width a fixed-width text object may be dragged to, in board units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Font sizes (px at 100% zoom) of the four text-size presets, in board units. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** The size a freshly created text object starts with. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height multiplier for text objects. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The font family text objects render and measure with. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// ---- Story 10: shapes and arrows -------------------------------------------

/** The three shape kinds a user can draw (story 10 shape.create). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Size (board units) of a shape dropped by a click, or by a too-small drag. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Smallest shape side, in board units: a drag under it counts as a click. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters in a shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline thickness of a shape, in board units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** The shape fill swatches: six colours plus "no fill". */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** The shape outline swatches (six colours). */
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
/** The fill and outline a freshly drawn shape starts with. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Shortest arrow, in board units: a drag shorter than this creates nothing. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** How close to an arrow's line (screen CSS px) a click still selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line thickness, in board units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size, in board units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of a connection dot, in *screen* CSS pixels (it does not scale). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// ---- Story 11: sketching with a pen ----------------------------------------

/** The six pen colours (name -> paint). */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** The six pen colours, as names. */
export type PenColor = keyof typeof PEN_COLORS;
/** Pen thicknesses in board (world) units, so a stroke scales with the zoom. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
/** The three pen thicknesses, as names. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
/** The colour and thickness a fresh session starts with (never remembered). */
export const DEFAULT_PEN_COLOR = 'black';
export const DEFAULT_PEN_THICKNESS = 'medium';
/**
 * How far a finished stroke may deviate from the path that was drawn, in *screen*
 * CSS pixels (pen.smooth). The Pen tool divides it by the camera zoom, so the
 * tolerance is one screen pixel whatever the scale.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/**
 * Longest stroke one object may hold, in recorded points (pen.long_stroke). At it
 * the stroke is finished and the drawing continues as a new stroke that starts at
 * the same point, so the two join with no visible gap.
 */
export const STROKE_MAX_POINTS = 5000;
/**
 * How close to a stroke's line (screen CSS px) a click still selects it
 * (pen.select). A click inside the stroke's bounding box but farther from its line
 * falls through to whatever is underneath.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest side a stroke may be resized to, in board units (pen.resize). */
export const STROKE_MIN_SIZE_WORLD = 4;

// -----------------------------------------------------------------------------
// Story 12 — images on the board (spec/stories/012-drop-images-onto-the-board).
// Every limit the PRD states is a name here, in the units the board speaks: board
// units for anything geometric, bytes for anything the wire carries.
// -----------------------------------------------------------------------------

/**
 * The image types a board accepts, as MIME types. SVG is deliberately absent: it is
 * an image format that can carry script, and the board serves stored images back to
 * whoever holds the link (PRD constraints.security).
 */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** How much of the file the server reads to name its type: the longest signature (WebP's). */
export const IMAGE_SNIFF_BYTES = 12;

/** One image, at most (PRD size_limit). 10 MB of 1024·1024 bytes. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Images added by one drop, paste or pick (PRD count_limit). */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/** An image is placed no larger than this along its longest side (PRD placement_size). */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/** The shorter side of a resized image stops here (PRD aspect_resize). */
export const IMAGE_MIN_SIZE_WORLD = 16;

/** Gap between images laid out in a row (PRD image.drop). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;

/**
 * How long an upload may stay "uploading" before everyone is told it did not finish
 * (PRD image.unfinished). The uploader's own tab is the only thing that can finish an
 * upload, so this is a wall clock on that tab being there.
 */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

/** Uploads accepted from one visitor per IMAGE_UPLOAD_PERIOD_SECONDS (PRD rate_limit). */
export const IMAGE_UPLOAD_LIMIT = 60;
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;

/** Stored images never change: an asset key belongs to one set of bytes forever. */
export const ASSET_CACHE_MAX_AGE_S = 31536000;

/** How often the uploader's screen re-derives "Uploading… 45%" while an upload runs. */
export const IMAGE_PROGRESS_TICK_MS = 30 * 1000;

/** How long a message about refused files stays on screen. */
export const TOAST_DISMISS_MS = 6000;

/** The toast wording for a visitor who has run out of upload allowance. */
export const IMAGE_UPLOAD_LIMIT_MESSAGE =
  "You're adding images too quickly. Wait a minute and try again.";
