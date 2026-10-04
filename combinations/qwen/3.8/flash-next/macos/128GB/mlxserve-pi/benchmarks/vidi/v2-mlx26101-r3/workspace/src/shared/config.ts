/**
 * Product settings for vidi6, in one place (stories 2-5 add to this file).
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd + scroll and pinch sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid lines, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values are snapped to the nearest ZOOM_STEP_FACTOR^n within this relative epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier that turns a zoom level into the displayed whole-number percentage. */
export const PERCENT = 100;

/** WheelEvent.deltaMode values. */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/** Pixels per line for wheel events reported in lines. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Dot-grid dot radius in screen pixels (does not scale with zoom). */
export const GRID_DOT_RADIUS_PX = 1;

/* Sticky notes (story 2). -------------------------------------------------- */

/** A sticky note is a square of this many board (world) units. */
export const STICKY_SIZE_WORLD = 200;
/** Space between the note's edge and its text, in board units (text box = size - 2x). */
export const STICKY_PADDING_WORLD = 12;
/** Hard limit on the characters of text a note holds. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears once this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (24 px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows into a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel before a press on a note becomes a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * The six note colours, in toolbar order. The key is the name stored in the document
 * (and later on the wire), the value the fill colour.
 */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** New notes are yellow. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* Live collaboration (story 3). --------------------------------------------- */

/**
 * Simultaneous-editor capacity the product is designed and tested for. Soft: it is a
 * design and test target and is never enforced - a 6th person joins like anyone else.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** How long a change is allowed to take to reach every other screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts; handed to the websocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length the catch-up test uses (live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/* Persistence (story 4). ----------------------------------------------------- */

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once the log rows reach this many bytes, whichever comes first. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Size of a snapshot chunk. Keeps every stored row well under the per-row size limit of
 * SQLite-backed Durable Objects (measured locally at 2,000,000 bytes; see NOTES.md).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room that failed to load its board retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** The board size the product is tested at (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** How long a saved board of PERSIST_TESTED_NOTES notes may take to show (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the room's storage tables; written once into `storage_meta`. */
export const STORAGE_SCHEMA_VERSION = 1;

/* Sharing a board (story 5). -------------------------------------------------- */

/**
 * How long creating a board may take from the click on New board to the empty board being
 * on screen (share.create). Reported by the e2e run, not asserted: the model, the browsers
 * and the server all share one machine.
 */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's "Link copied" confirmation stays up (share.copy). */
export const LINK_COPIED_MS = 2000;
/**
 * First wait before a board-link check is tried again; each further failure doubles it, up to
 * {@link RECONNECT_MAX_BACKOFF_MS} (share.unreachable).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/**
 * Functional wait used by every e2e test. Latency is measured and logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted here: the model, the browsers and the
 * server all share one machine, so wall-clock timing there is not a pass/fail signal.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* Multi-selection (story 7). -------------------------------------------------- */

/** Size of a resize handle in screen pixels; handles stay this big at every zoom level. */
export const HANDLE_SIZE_PX = 8;
/** Smallest a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/**
 * Largest any single object may be resized to, in world units (story 7).
 *
 * One global number rather than one per type, so that the types stories 9 to 12 add stop at
 * the same size as a sticky note instead of inventing their own limit.
 */
export const MAX_OBJECT_SIZE_WORLD = 20000;
/** How far an arrow key moves the selection, in world units. */
export const NUDGE_STEP_WORLD = 1;
/** How far Shift + arrow moves the selection: a nudge that covers ground. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* Undo and redo (story 8). --------------------------------------------------- */

/**
 * How long a pause it takes to end an undo step (spec: `undo.capture_timeout_ms`).
 *
 * A run of changes made within this many milliseconds of each other is one step, which is what
 * makes a burst of typing go back a word rather than a letter, and one drag go back in one go.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** How many steps one person's undo history keeps; older steps are dropped first. */
export const UNDO_MAX_STEPS = 200;

/* Free text (story 9). ------------------------------------------------------- */

/**
 * Widest a text box of its own accord ever gets, in world units: a comfortable line length.
 * A longer line is wrapped rather than drawn wider, which is what "grows then wraps" means.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/**
 * Narrowest a text box can be given with the side handle, in world units. Below this the words
 * would be broken to one letter per line, which is not a width a person meant to choose.
 */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Hard limit on the characters of text a text object holds. */
export const TEXT_MAX_CHARS = 5000;
/**
 * The four text sizes, as the font size in world units (so 20 world units is 20 px at 100% zoom).
 * The key is what the document stores.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/**
 * What each size is called where a person reads it, in the toolbar's button names. The letter on
 * the button is the size; the word is for the screen reader, and for the tooltip.
 */
export const TEXT_SIZE_LABELS: Record<TextSize, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};
/** Text made with the Text tool starts in the middle size. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/**
 * Line height as a multiple of the font size: the box's height is lines x size x this.
 * A line of text needs a little more room than the letters themselves have.
 */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif: text objects are plain text, and this is the font they are in. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/**
 * How wide a character is taken to be when there is no canvas to measure with, as a fraction of
 * the font size. Only a fallback - the estimate exists so a text object still has a box, and so
 * a change is never lost, where `measureText` cannot run (jsdom, and any worker without canvas).
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.5;

/**
 * How a text object's width is decided: `auto` follows the longest line, `fixed` is the width a
 * person dragged the side handle to. Height is never either: height always follows the content.
 */
export type TextWidthMode = 'auto' | 'fixed';

/**
 * True for one of the four size names.
 *
 * A runtime check, because the value comes out of a document that a peer - or an older client,
 * or a hand-written import - may have put anything in. The board model reads a size with it and
 * falls back to the default rather than drawing a text object at a font size the product has not
 * got. It is a setting's own guard, so it sits next to the setting: the model and the text object
 * model both need it, and this is the one module neither has to import through the other.
 */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/** Whether `value` is one of the two width modes; anything else reads back as `'auto'`. */
export function isTextWidthMode(value: unknown): value is TextWidthMode {
  return value === 'auto' || value === 'fixed';
}

/* Shapes and arrows (story 10) ------------------------------------------------
 *
 * The numbers behind "draw a shape, point an arrow at another shape". The sizes
 * are world units - the same units a sticky note is measured in, so a rectangle
 * drawn at 200% zoom is twice as many *pixels* but the same 160 units, and the
 * arrow that joins it is still 2 units thick.
 */

/** The three shapes there are to draw. A shape's kind is chosen as it is made. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

/** One of the three shapes the Shape tool draws. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** What each shape is called in the interface. */
export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * The shape somebody gets when they click without dragging, or drag a line: there
 * is no such thing as a shape of no size, so a drag too small to be one is
 * treated as a click and this is the size it becomes.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** The smallest a shape may be left at, whatever a resize gesture was dragged to. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/**
 * How much a shape's label may hold. It is half what a free text object may hold
 * because the label has to fit *inside* the shape that carries it, and a shape is
 * drawn as a button somebody points at, not as a page.
 */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** How the label is drawn: the font is in world units, so it scales with the board. */
export const SHAPE_LABEL_FONT_WORLD = 20;

/** How thick a shape's outline is drawn, in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** The fills a shape may have. `none` first, because that is the swatch on the left. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

/** The colours a shape's outline may be given. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

/** The name a fill is stored under - `'none'` for a shape with no fill. */
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

/** The name an outline colour is stored under. */
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** A new shape is a white rectangle with a dark outline: what a flowchart box looks like. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** Whether `value` is one of the three shape kinds; anything else reads back as `'rect'`. */
export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/**
 * Whether `value` is one of the fill names. The document stores the *name*, never
 * the hex, so a value that is not one of these is not a colour somebody chose - it
 * is a corruption or a foreign write, and the shape is drawn with the default
 * rather than with whatever string arrived.
 */
export function isFillColor(value: unknown): value is FillColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);
}

/** The same for an outline colour. */
export function isStrokeColor(value: unknown): value is StrokeColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);
}

/**
 * The shortest an arrow may be. An arrow shorter than this is not an arrow, it is
 * a stray mark on the board: it cannot show an arrowhead, and it is far more
 * likely to be a slip of the pointer than something somebody meant to draw. A
 * release this close to where it started changes nothing and leaves the tool up.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How close to an arrow a click has to land to select it, in *screen* pixels.
 *
 * The one tolerance in the product that is deliberately not measured in world
 * units: a line two units thick is a hair's width at 200% zoom and a band at 25%,
 * and what a person is aiming at is a number of pixels on their own screen. So the
 * distance is converted to world units by dividing by the zoom when the line is
 * tested, and the same 6 pixels mean 12 world units at 50% zoom and 3 at 200%.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** How thick an arrow is drawn, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** How long the arrowhead's two sides are, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** The radius of the four dots a shape shows on its sides while an arrow is aimed at it. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* ------------------------------------------------------------------ *
 * The pen (story 11)                                                  *
 * ------------------------------------------------------------------ */

/**
 * The six colours the pen draws with, stored in the document by name.
 *
 * These are drawing colours, not sticky note colours: a board has both on it, and a black line on a
 * yellow note is not a colour the note can be. Like the shape palette, the document keeps the name
 * and the hex lives here, so repainting the palette is a change to one file and not a migration.
 */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

/** The name a pen colour is stored under. */
export type PenColor = keyof typeof PEN_COLORS;

/**
 * The three pen widths, in world units - which is what "keeping the thickness" means when a stroke
 * is resized: the line is drawn this thick whatever box it is scaled into.
 */
export const PEN_THICKNESS_WORLD = {
  thin: 2,
  medium: 4,
  thick: 8,
} as const;

/** The name a pen width is stored under. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** What a pen that has never been configured draws with: black, and the middle of the three widths. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/** Whether `value` is one of the six pen colours; anything else reads back as the default. */
export function isPenColor(value: unknown): value is PenColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);
}

/** Whether `value` is one of the three pen widths; anything else reads back as the default. */
export function isPenThickness(value: unknown): value is PenThickness {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value)
  );
}

/**
 * How far a stored path may stray from the captured one, in *screen* pixels.
 *
 * A captured stroke is a point per coalesced pointer sample, which is far more than a drawing needs:
 * most of those points say the same thing as their neighbours to within a pixel. The path is
 * simplified against this tolerance when the stroke is committed, and the tolerance is divided by the
 * zoom - so a person sketching zoomed out is simplified more coarsely, in *world* units, than one
 * sketching zoomed in, and what is thrown away is always about a pixel on their screen. See
 * {@link STROKE_HIT_TOLERANCE_PX}, which is the same argument for clicks.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * How many captured points one stroke may hold, in world units of patience: a stroke longer than
 * this is committed in parts, each part starting at the point the part before it ended at.
 *
 * The limit is not about storage - a Y.Map holds a thousand numbers without complaining - it is about
 * the size of a single transaction. A five-minute stroke on a 240 Hz tablet is tens of thousands of
 * points, and one update carrying all of them is one update nobody can render until it has arrived,
 * on every peer, every time. Committing every {@link STROKE_MAX_POINTS} points keeps each update the
 * size of a stroke segment rather than the size of a drawing session.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How close to a stroke a click has to land to select it, in *screen* pixels.
 *
 * The second instance of the argument story 10 made for arrows ({@link CONNECTOR_HIT_TOLERANCE_PX}),
 * and it is a stronger argument here: a thin stroke is two world units, which at 25% zoom is half a
 * pixel - and a thin stroke is one of the three widths a person is offered. So the tolerance is
 * six pixels converted to world units by dividing by the zoom, and a thin stroke stays clickable at
 * every zoom level.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/** The smallest box a stroke may be resized to, in world units: a dot is already this big. */
export const STROKE_MIN_SIZE_WORLD = 4;
