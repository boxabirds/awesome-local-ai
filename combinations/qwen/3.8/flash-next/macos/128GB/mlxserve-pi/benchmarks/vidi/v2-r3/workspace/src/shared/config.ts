// Shared product settings. Stories 2-5 add their own settings to this file.
import type { Point } from './geometry';

/** Minimum zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies (or divides) the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * How far (in board units) the app is tested to pan from the starting point
 * without hitting an edge. Used by tests; the camera itself is unbounded.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note size in world (board) units; notes are square. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below it text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six selectable sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 9: free text objects --------------------------------------------
//
// A size is stored as its key and never as a pixel number, so changing these
// numbers leaves documents written before the change readable.

/** The four text sizes: the stored key mapped to its world font size. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a new text object starts at. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/**
 * How a text object decides its width: the text decides it, and the box grows to
 * its longest line until it has to wrap; or a person decided it, by dragging a
 * side handle or pressing the width button, and the height follows the number of
 * lines the words need inside it.
 */
export type TextWidthMode = 'auto' | 'fixed';

/** Display names used for the size buttons' accessible labels (e.g. "Large text"). */
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

/** Line boxes are this multiple of the font size, in the layout and in CSS alike. */
export const TEXT_LINE_HEIGHT = 1.3;

/** The font the layout measures with, which is the font the text is drawn in. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/** A text object holds this many characters; further input is ignored. */
export const TEXT_MAX_CHARS = 5000;

/** An auto-width box grows to this and then wraps (world units). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest box a text object may have, in auto or in fixed mode (world units). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/**
 * An auto-width box is grown this much wider than its longest line, so that the
 * words in it are not pressed against its selection outline. The box is never
 * wider than TEXT_MAX_AUTO_WIDTH_WORLD.
 */
export const TEXT_BOX_PAD_WORLD = 4;

// --- Story 3: live collaboration -------------------------------------------

/**
 * Simultaneous editors the product is designed and tested for. This is a soft
 * capacity: it is never enforced (a 6th person joins normally), it is the
 * single named setting behind the capacity claims and the capacity tests.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** Change-delivery budget: sender screen -> every other screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Exponential backoff ceiling handed to the WebSocket provider (y-websocket). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used by the catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait in every e2e test. Wall-clock latency is measured and
 * logged against LIVE_UPDATE_LATENCY_BUDGET_MS there, never asserted: the
 * model, the browsers and the server all share one machine while testing.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Display names used for the swatch accessible labels (e.g. "Pink colour"). */
export const STICKY_COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

// --- Story 4: persistence ---------------------------------------------------

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Or once the log's bytes reach this total.
 * keeps every stored row well under the platform per-row size limit.
 */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** The size of one snapshot chunk written to storage. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A LoadFailed room retries its load at most this often (persist.load_failure). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the product is tested at (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;

/** The open-time target for a saved board (PRD persist.large_board). Reported
 * by e2e, never asserted: the model, browsers and server share one machine.
 */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** The version of the storage tables (not the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: sharing a board by link --------------------------------------

/**
 * Creation budget (share.create): a click on "New board" must bring up the new
 * empty board within this many milliseconds on a typical broadband connection.
 * Reported and logged by e2e (TC-26), never asserted: the model, the browsers
 * and the server share one machine, so wall-clock timing here is not a
 * pass/fail signal.
 */
export const CREATE_BUDGET_MS = 2000;

/**
 * How long the "Link copied" confirmation stays up in the Share panel
 * (share.copy). Boundary values tested at LINK_COPIED_MS - 1 and exactly
 * LINK_COPIED_MS (TC-22).
 */
export const LINK_COPIED_MS = 2000;

/**
 * First backoff interval when a board link cannot reach the service while
 * opening it (share.unreachable). Doubles on each retry up to
 * RECONNECT_MAX_BACKOFF_MS (story 3), which is the ceiling.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: select, move, resize and delete several objects at once ------

/** Resize handle size in screen pixels (constant across zoom). */
export const HANDLE_SIZE_PX = 8;

/** Minimum size of a sticky note in world units after resize. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Maximum size of any object in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Nudge step: one arrow key press moves selected objects this many world units. */
export const NUDGE_STEP_WORLD = 1;

/** Large nudge step: Shift+Arrow moves this many world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Story 8: undo and redo ------------------------------------------------

/**
 * Typing pause that ends an undo step (undo.typing): consecutive local text
 * changes made less than this many milliseconds apart are one undo step, so one
 * press of Undo reverses a burst of typing rather than one keystroke. A pause of
 * exactly this long starts a new step (the boundary values are tested at
 * UNDO_CAPTURE_TIMEOUT_MS - 1 and exactly UNDO_CAPTURE_TIMEOUT_MS).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of a person's own undo steps a board keeps (undo.limit). When a new
 * step is added while the history holds this many, the oldest one is discarded.
 * A generous history is what makes experimenting safe.
 */
export const UNDO_MAX_STEPS = 200;

// --- Story 10: shapes and the arrows between them ---------------------------
//
// A shape stores its colours as palette *keys*, exactly as a sticky note stores
// its colour, so changing a palette below leaves documents written before the
// change readable (and readable as the default colour when a key is gone).

/** The three shape kinds the board draws. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Is this value one of the shape kinds the board draws? */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** Names the Shape menu and a screen reader use for the kinds. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * The size of a shape made by a click, or by a drag too small to be a shape
 * (shape.create_click): a square, centred on the point.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * A drag this narrow in either direction is a click and not a shape
 * (shape.create_click). A drag of exactly this size is kept as drawn — the
 * boundary is tested on both sides of it.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** A shape's label holds this many characters; further input is ignored. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Outline width of a shape, in board units, so it scales with the shape. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Font size of a shape's label, in board units. */
export const SHAPE_LABEL_FONT_PX_WORLD = 16;

/** A shape's label is laid out in lines this multiple of its font size. */
export const SHAPE_LABEL_LINE_HEIGHT = 1.3;

/** The fill colours of a shape, `none` being the no-fill swatch. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

export type ShapeFillColor = keyof typeof SHAPE_FILL_COLORS;

/** The outline colours of a shape. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

export type ShapeStrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** A new shape is a white box with a dark outline (shape.create_drag). */
export const DEFAULT_SHAPE_FILL: ShapeFillColor = 'white';

export const DEFAULT_SHAPE_STROKE: ShapeStrokeColor = 'dark';

/** Swatch accessible names: "White fill", "No fill", "Dark outline". */
export const SHAPE_COLOR_LABELS: Record<ShapeFillColor | ShapeStrokeColor, string> = {
  none: 'No fill',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
  dark: 'Dark',
  orange: 'Orange',
  red: 'Red',
};

/**
 * The shortest arrow worth creating (connector.no_accidental): a drag shorter
 * than this, measured in board units between the two ends, is a mis-click and
 * creates nothing.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How close to an arrow's line a click has to be to select it
 * (connector.select), in *screen* pixels: divided by the zoom to get board
 * units, so picking an arrow is equally fine at 50 % and at 200 %.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Width of an arrow's line, in board units, so it scales with the board. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Length of the two sides of an arrow's head, in board units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Radius of a connection dot, in *screen* pixels (connector.hover_points). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/**
 * The side of an object a connector ends at. The middle of a side is on the
 * outline of a rectangle, of an ellipse and of a diamond alike, which is why an
 * anchor is a side rather than a point, and why it can be recomputed whenever
 * the object under it moves.
 */
export type ConnectorSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * One end of a connector: stuck to an object (with the point to draw to if that
 * object stops existing), or a free point in board space.
 */
export type ConnectorEndpoint =
  | { kind: 'attached'; objectId: string; fallback: Point }
  | { kind: 'free'; x: number; y: number };
