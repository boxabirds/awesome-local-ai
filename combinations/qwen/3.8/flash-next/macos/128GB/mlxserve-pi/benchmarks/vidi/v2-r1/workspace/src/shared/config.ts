/**
 * Product settings for vidi6. Every named setting that design/system docs call
 * "a product setting that can be changed in one place without redesign" lives
 * here. Stories 2-5 add their own settings to this file.
 */

// --- Camera / zoom -----------------------------------------------------------

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies/divides the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor produced by a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// --- Board geometry ----------------------------------------------------------

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far (in world units) the unbounded-pan guarantee is tested. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes ------------------------------------------------------------

/** A sticky note's width and height in world units (it is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on a note's text length, in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/**
 * The six selectable note colours. The key is the persisted colour name; the
 * value is the fill. Keys double as the accessible/tooltip colour names.
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

/** The colour a freshly created note gets. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Selecting and transforming several objects at once (story 7) ------------

/** Selection handles are this many screen pixels across, at any zoom. */
export const HANDLE_SIZE_PX = 8;

/**
 * The shortest edge a selection may squeeze a sticky note to. Resize handles on
 * the selection box, and any drag that ends up shrinking a note, stop at this
 * size, so the text is never squeezed to nothing.
 */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * The largest edge any object may be given, by dragging a resize handle outwards
 * or by any other route. Keeps a runaway drag inside the range the board can
 * render and pan back to.
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** How far one arrow key press moves a selection, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** How far one Shift + arrow key press moves a selection, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Undo / redo (story 8) ---------------------------------------------------

/**
 * The typing pause that ends a burst: consecutive keystrokes in a note's text
 * that arrive less than this long apart are one undo step; a pause of this long
 * or longer starts a new one. `UndoController.boundary()` closes the window
 * immediately for gestures, edits and toolbar actions.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** How many undo steps one person's history keeps; older steps are dropped. */
export const UNDO_MAX_STEPS = 200;

// --- Free text (story 9) -----------------------------------------------------

/**
 * The widest a text object that is sizing itself to its content may get. A line
 * longer than this wraps; the box never stretches across the whole board.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a text object may be given by dragging a side handle. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Hard limit on a text object's length, in characters. */
export const TEXT_MAX_CHARS = 5000;

/**
 * The four text sizes, in board units (the font size at 100% zoom). The keys are
 * the persisted size names and the button labels.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a freshly created text object gets. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line boxes are this many times the font size tall — the same everywhere. */
export const TEXT_LINE_HEIGHT = 1.3;

/**
 * The board's standard sans-serif, spelled the way a measurement context can be
 * told: the element and the canvas are both given exactly this, so the width a
 * client lays out with is the width it draws with. A stack a canvas could not
 * resolve would silently measure at its own default face, and that is a different
 * box on every machine.
 */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// --- Live collaboration (story 3) --------------------------------------------

/**
 * How many people a board is designed and tested for while they all edit at
 * the same time. This is a soft target: it is never enforced — a 6th person is
 * connected and can edit like anyone else (PRD live.over_capacity). Every test
 * that needs "full capacity" reads this setting instead of a literal number.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Change-delivery budget: the time from a change appearing on the sender's
 * screen to it appearing on every other connected screen (PRD live.propagate).
 * Reported (not asserted) by the e2e suite, which shares one machine with the
 * model and the server; see design.md "Timing policy".
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the reconnect backoff while the connection is down. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used by the catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait used by every e2e story when waiting for something that
 * another participant (or the runtime) makes happen. Latency is measured and
 * logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted here.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Persistence (story 4) ---------------------------------------------------

/**
 * Compact the board's update log once this many rows are above the last
 * snapshot. Lowering it is the first escalation when a large board loads
 * slower than BOARD_LOAD_BUDGET_MS (design: persist.room).
 */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or once the log rows hold this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Snapshot chunk size. Every row stays well under the per-row size limit of
 * SQLite-backed Durable Objects (1 MiB today; this is a quarter of it).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A room that failed to load its board retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

/** Version number of the *storage* tables (the document schema has its own). */
export const STORAGE_SCHEMA_VERSION = 1;

/** Board size the large-board requirement is tested at (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;

/**
 * Time a saved board of PERSIST_TESTED_NOTES notes is meant to be fully shown
 * in, on a typical broadband connection (PRD persist.large_board).
 *
 * The end-to-end number is reported by the e2e suite and never asserted — the
 * model, the browsers and the server share one machine (design: Timing policy).
 * What is asserted is the part this machine can say something about: the time the
 * store takes to read a board that size back together (TC-08).
 */
export const BOARD_LOAD_BUDGET_MS = 3_000;

// --- Share links (story 5) ---------------------------------------------------

/**
 * How long creating a board is meant to take, measured from the click on
 * "New board" to the empty board being on screen (PRD share.create). A board is
 * one id generation plus one Durable Object RPC plus one small SQLite write, so
 * it fits comfortably inside this. TC-26 logs the real click-to-board time in a
 * browser against it and never asserts it (design: Timing policy).
 */
export const CREATE_BUDGET_MS = 2000;

/**
 * How long the "Link copied" confirmation stays on the Copy link button before
 * it reverts (PRD share.copy). Boundary-tested at LINK_COPIED_MS - 1 (still
 * shown) and LINK_COPIED_MS (reverted) in TC-22.
 */
export const LINK_COPIED_MS = 2000;

/**
 * The first wait before a board-existence check is retried while the service
 * cannot be reached (PRD share.unreachable). Each later wait doubles, capped at
 * RECONNECT_MAX_BACKOFF_MS (the same ceiling story 3's reconnect uses).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Shapes and connectors (story 10) ----------------------------------------

/** The kinds a shape may be. The Shape tool's menu offers exactly these. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * The fill palette (`shape.style`): the shape UI spec's six colours plus 'none',
 * which is the real "no fill" — the board shows the shapes' outlines over the dot
 * grid. Keys are the persisted names and the swatch labels.
 */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
export type ShapeFill = keyof typeof SHAPE_FILL_COLORS;

/** The stroke palette (`shape.style`) — the shapes' outlines, six of them. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type ShapeStroke = keyof typeof SHAPE_STROKE_COLORS;

/** The fill a freshly created shape gets (`shape.default_fill`). */
export const DEFAULT_SHAPE_FILL: ShapeFill = 'white';

/** The stroke a freshly created shape gets (`shape.default_stroke`). */
export const DEFAULT_SHAPE_STROKE: ShapeStroke = 'dark';

/**
 * The size a shape gets when it is clicked into existence instead of dragged
 * (`shape.default_size`) — square, because a shape dropped without a drag has no
 * direction to be wider in. Board units.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * The smallest a shape may be squeezed, by resize handles or by a drag. A drag
 * smaller than this is a click, and the shape gets `SHAPE_DEFAULT_SIZE_WORLD`
 * (`shape.min_size`). Board units, and the model's per-kind resize floor.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** How thick a shape's outline is drawn, in board units (`shape.stroke_width`). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Hard limit on a shape's label, in characters (`shape.label_max_chars`). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** A shape's label font size in board units (the size at 100% zoom). */
export const SHAPE_LABEL_FONT_SIZE_WORLD = 16;

/**
 * The shortest arrow a drag may create (`connector.min_length_world`): a drag
 * shorter than this is a click, and `createConnector` returns null. Board units.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How long an arrowhead is, in board units (`connector.arrowhead_size_world`). The
 * arrow is drawn with the same length of gap at its pointed end, so the tip lands on
 * the anchored object's edge instead of on the anchor point behind it.
 */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** How thick an arrow is drawn, in board units (`connector.stroke_width_world`). */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** The colour every arrow is drawn in. Story 10 gives arrows no style of their own. */
export const CONNECTOR_COLOR = '#3C4043';

/**
 * How close to an arrow the pointer has to come for it to be hit (`connector.
 * hit_tolerance_px`), in *screen* pixels — divided by zoom to become board units.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** How wide a connection dot is, in *screen* pixels (`connector.hover_points`). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Freehand strokes (story 11) ---------------------------------------------

/**
 * The six colours the Pen tool offers (`pen.options`). The key is the persisted name
 * and the accessible name of the swatch; the value is what the stroke is drawn with.
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

/**
 * The three thicknesses, in *board* units (`pen.options`). Board units rather than
 * pixels on purpose: a stroke is as thick relative to the board at every zoom, the
 * way a shape's outline is.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** The colour a stroke is drawn in when nobody picked one (`pen.options`). */
export const DEFAULT_PEN_COLOR: PenColor = 'black';

/** The thickness a stroke is drawn with when nobody picked one (`pen.options`). */
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/**
 * How far a finished stroke may lie from the path that was drawn, in *screen* pixels
 * at the zoom the drawing happened at (`pen.smooth`). Ramer-Douglas-Peucker is run
 * with this tolerance divided by the zoom, in board units, which is what makes the
 * smoothing faithful at any zoom instead of coarser as you go in.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * How many recorded points one stroke may hold (`pen.long_stroke`). A drag that
 * reaches it commits what it has and carries on as a new stroke from the same point,
 * so a very long sketch is several strokes that join with no gap rather than one
 * object nobody can render quickly.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How close to a stroke's line the pointer has to come for it to be hit
 * (`pen.select`), in *screen* pixels — divided by the zoom to become board units, the
 * one zoom-aware thing about a hit test. Half the stroke's own thickness wins when it
 * is thicker than this.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/**
 * The smallest a stroke's box may be squeezed to (`pen.resize`). A stroke that is a
 * flat underline still has a box this tall to grab.
 */
export const STROKE_MIN_SIZE_WORLD = 4;
