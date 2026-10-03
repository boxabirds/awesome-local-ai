// Shared product settings for vidi6. Stories 2-5 add to this file.
// Everything that a designer might want to tune lives here so it can be
// changed in one place without touching component code.

/** Lowest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Highest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied by one zoom-in step (zoom-out divides). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: zoom factor = Math.exp(-deltaY * sensitivity).
 * A deltaY of one "notch" (~100) yields exp(1) ~= 2.718 at full deflection.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots (and major grid lines) in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * How far from the starting point the board is guaranteed (and tested) to pan
 * without reaching an edge. Doubles keep sub-pixel precision at this range.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky note settings (story 2) ----------------------------------------
// Everything a designer might tune about sticky notes lives here so it can be
// changed in one place without touching component code.

/** Side length of a sticky note in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the number of characters kept in a note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter is shown when remaining chars <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, at 100% zoom) tried by auto-fit. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size tried by auto-fit; below this text overflows. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) beyond which a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by their accessible colour name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour a freshly created note is filled with. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Selection & transform settings (story 7) ------------------------------
// The one place to tune how a selection looks and how far it moves and grows.
// Every object type shares these; a type only declares its own *minimum* size
// through the object registry (see src/client/objects/registry.tsx).

/** On-screen size (CSS px) of a selection resize handle, at any zoom. */
export const HANDLE_SIZE_PX = 8;

/** Smallest side a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest side any object may be resized to, in world units (global maximum). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Distance one arrow key nudges the selection, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Distance Shift + an arrow key nudges the selection, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Live collaboration settings (story 3) ---------------------------------
// The single place to tune how the board syncs between people.

/**
 * Soft capacity: the number of simultaneous editors the board is designed and
 * tested for. It is never enforced — the Worker and the BoardRoom count no
 * participants, so a 6th person joins and edits like anyone else.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Latency budget for live.propagate: the time from a change appearing on the
 * sender's screen to appearing on every other connected screen. e2e tests
 * measure and report against it; they do not assert it (one shared machine).
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Exponential backoff ceiling handed to WebsocketProvider (`maxBackoffTime`). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used by the live.catch_up verification (TC-27). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Generous functional wait used by every e2e test in the project: states are
 * awaited until they converge, wall-clock latency is only logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/**
 * WebSocket close code used by tests to simulate the room going away: 1011
 * ("internal server error"), which a reconnecting client treats as retryable.
 */
export const CLOSE_SERVER_ERROR = 1011;

/**
 * Guard used where a test must not wait forever for a change that is supposed to
 * arrive: the LIVE_UPDATE_LATENCY_BUDGET_MS budget plus allowance for a shared,
 * loaded machine. Measured latency is logged against the budget itself, so the
 * guard only fails a test that is properly broken, not one on a slow CI runner.
 */
export const E2E_PROPAGATION_GUARD_MS = 2_000;

// --- Persistence settings (story 4) ----------------------------------------
// How the board is saved, compacted and reloaded. Everything a designer might
// tune about durability lives here so the storage engine and the tests agree.

/** Compact the update log into a snapshot once this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Or once the log reaches this many bytes (whichever threshold is reached first). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Snapshot chunk size. Chunks keep every SQLite row well under the platform's
 * per-row size limit; the value is chosen far below any documented limit known
 * at design time (re-check the Cloudflare Durable Object SQLite limits when the
 * platform changes).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A LoadFailed room re-attempts its load at most this often (new connections). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/**
 * The board size the PRD's persist.large_board guarantees against (and the
 * fixtures generate): a saved board must open with all of these notes present.
 */
export const PERSIST_TESTED_NOTES = 2000;

/**
 * Wall-clock budget for opening a `PERSIST_TESTED_NOTES` board. e2e tests log
 * the measured navigation-to-rendered time against it; they do not assert it
 * (the model, browsers and server share one machine).
 */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the Durable Object SQLite table layout (not the Yjs document). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Sharing settings (story 5) ---------------------------------------------
// How a board is created, how its link reads, and how the client behaves when the
// service cannot be reached. `BOARD_ID_BYTES` (story 3, 16 bytes = 128 bits) is
// already the link-code strength behind share.unguessable.

/**
 * Budget for share.create: clicking **New board** until the empty board is on
 * screen. The e2e workflow logs the measured click-to-board time against it
 * rather than asserting it (one shared machine).
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's button reads "Link copied". */
export const LINK_COPIED_MS = 2000;

/**
 * First wait between "does this board exist?" attempts when the service cannot be
 * reached. Each further attempt doubles, capped at RECONNECT_MAX_BACKOFF_MS (the
 * same ceiling the live connection backs off to).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Undo / redo settings (story 8) -----------------------------------------
// How much of a person's own work a single board tab can step back through, and
// how a burst of typing collapses into one undoable step. History lives only in
// this tab's memory: it is never persisted, shared or seen by anyone else.

/**
 * Typing pause that ends an undo step. Consecutive edits to a note's text that
 * arrive less than this apart collapse into one undoable step; a pause of this
 * length or longer starts a new step (undo.typing). Also the Yjs capture window
 * a drag's per-frame writes fall inside, so one gesture is one undo step
 * (undo.steps).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * The most undo steps a person's history keeps. Adding a step beyond this drops
 * the oldest one (undo.limit). Generous enough that experimentation feels safe.
 */
export const UNDO_MAX_STEPS = 200;

// --- Free text settings (story 9) ------------------------------------------
// Everything a designer might tune about free text objects lives here so the
// model, the layout maths and the editor all agree on one set of numbers.

/**
 * The widest an auto-width text box ever grows to, in world units. A line wider
 * than this wraps (text.auto_width); the box width is capped here.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/**
 * Air added to the widest line when an auto-width box sizes itself to its content,
 * in world units: box width = longest line + this, never past TEXT_MAX_AUTO_WIDTH_WORLD.
 * Without it the last glyph of the longest line touches the box edge (and rounding
 * differences make the box flicker between two values while typing).
 */
export const TEXT_AUTO_WIDTH_PADDING_WORLD = 16;

/** The narrowest a fixed-width text box may be dragged to, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Hard limit on the number of characters kept in a text object. */
export const TEXT_MAX_CHARS = 5000;

/** The four text sizes, in board units (font size at 100% zoom), by preset key. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a freshly created text object starts at (text.create). */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line-height multiplier: height = lines × font size × this (text.height). */
export const TEXT_LINE_HEIGHT = 1.3;

/** The board's standard sans-serif stack; keeps text crisp at every zoom. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Average glyph width as a fraction of the font size, used to *estimate* a line's
 * width when no canvas text measurer is available (jsdom, or a browser without
 * OffscreenCanvas). Rough on purpose — it only has to keep the box sane, not be
 * pixel-exact (measurer-unavailable error path, TC-32).
 */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.55;

// --- Shape settings (story 10) ---------------------------------------------
// Everything a designer might tune about the three drawable shapes lives here, so
// the model, the tool and the renderer all agree on one set of numbers.

/** The three shape kinds, in the order the Shape menu lists them (shape.create). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** The kind the Shape tool creates when nothing was picked (shape.create). */
export const DEFAULT_SHAPE_KIND: ShapeKind = 'rect';

/** The Shape menu's accessible names, in SHAPE_KINDS order (shape.menu). */
export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * The size of a shape dropped by a click (shape.create_click), and the side a
 * drag smaller than SHAPE_MIN_SIZE_WORLD grows to.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * A drag this small in either direction is a click, not a shape (shape.create_click).
 * A drag of exactly this size is kept as drawn (the boundary TC-03 asserts).
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Hard limit on the number of characters kept in a shape's label (shape.label). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Outline width of a shape, in world units, at every zoom level. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/**
 * The label font size in world units. Not a product knob the PRD names; one number
 * here keeps the painted label and the wrapped-line arithmetic in agreement.
 */
export const SHAPE_LABEL_FONT_PX = 16;

/** Air inside the label box, in world units, so text never touches the outline. */
export const SHAPE_LABEL_PADDING_WORLD = 8;

/** The seven fill choices: six colours plus 'none' (shape.style). */
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

/** The six outline choices (shape.style). */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** The colours a freshly created shape carries (shape.style). */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** The accessible name of the 'none' fill swatch (shape.style). */
export const SHAPE_NO_FILL_LABEL = 'no fill';

// --- Connector (arrow) settings (story 10) ---------------------------------
// The rules an arrow follows: how short it may be, how close a click has to be to
// select it, and how it is drawn.

/**
 * A connector drag shorter than this (board units) creates nothing
 * (connector.no_accidental). Exactly this long is created (the TC-09 boundary).
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How close to an arrow's line a click has to land to select it, in *screen*
 * pixels (connector.select). The board divides it by the zoom to get board units,
 * so it feels the same at every zoom level.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Line width of an arrow, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Length of the arrowhead's shaft, in world units (connector.arrowhead). */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Radius of a connection dot, in *screen* pixels (connector.hover_points). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/**
 * The size of the handle on a selected arrow's end, in *screen* pixels: its diameter, so
 * the handle is bigger than the dot it covers and is the thing a person aims at when they
 * move an end (connector.handles). Divided by the zoom like every other screen size.
 */
export const CONNECTOR_HANDLE_SIZE_PX = 10;

/** The colour of an arrow, its dots and its handles. */
export const CONNECTOR_COLOR = '#263238';

/** The colour of the connection dot an arrow will attach to (highlighted). */
export const CONNECTOR_DOT_HIGHLIGHT_COLOR = '#1E88E5';

/** The four object sides an arrow can attach to, in the order they are drawn. */
export const CONNECTOR_SIDES = ['top', 'right', 'bottom', 'left'] as const;

// --- Pen (freehand stroke) settings (story 11) ------------------------------
// The pens a person can draw with, and the three rules a drawn path is held to: how far it may
// be smoothed, how long one stroke may be, and how close a click has to be to be a hit on it.

/**
 * The pens, as names rather than hex codes: a stroke stores the name it was drawn with and the
 * board looks the colour up, so a palette can be retinted without a migration and a stroke drawn
 * by an older client keeps the ink it was drawn in.
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
 * The nib sizes, in **world units**, so a stroke keeps its weight on the board as the camera
 * zooms: the same pen at 200% is the same line over the same note, twice as many pixels wide.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;

export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** The pen the board picks for someone who has never chosen one. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/**
 * How far a point may stray from the line that replaces it, in *screen* pixels, before the hand
 * that drew it is missed (pen.smooth). The board divides it by the zoom, so the promise is the
 * same size on the screen at every zoom level, exactly like the hit tolerance below.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * The most points one stroke may hold (pen.long_stroke). A path is one array on one object and
 * every commit replaces the whole of it, so a person who scribbles without lifting the pen would
 * be sending an ever-larger payload; past this the path is cut into a second stroke, which is
 * why the cut has to share its point.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How close to a stroke's line a click has to land to select it, in *screen* pixels
 * (pen.select). The same rule story 10 set for arrows, on a polyline with far more points in it.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/**
 * The smallest box a stroke may have, in world units: the thickness square a single dot is drawn
 * in (pen.dot), and the least a resize may leave of a drawing.
 */
export const STROKE_MIN_SIZE_WORLD = 4;

// --- Image settings (story 12) ----------------------------------------------
// What an image file has to be to get onto the board, how big it is placed at, and how long the
// board waits for an upload. One set of numbers for the client that refuses a file, the Worker
// that sniffs its bytes and the model that stores the placeholder.

/**
 * The image types the board accepts (image.accepted_types), in the order the picker lists them.
 * Magic bytes are the authority — this list is what a browser is asked for (`accept`) and the
 * Content-Type stored with the object and answered on every response.
 */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * The extensions each accepted type goes by on a disk. The JPEG entry has two because a person's
 * camera writes one and their phone writes the other, and both are the same file format.
 */
export const IMAGE_FILE_EXTENSIONS: Record<AcceptedImageType, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
};

/**
 * The file input's `accept` string, built from IMAGE_ACCEPTED_TYPES so the picker a person is shown
 * and the rule their choice is checked against cannot drift into disagreeing.
 *
 * Both spellings are listed — the type and the extension — because a picker is not one thing: some
 * grey out files by MIME type, some only know how to match a suffix, and a PDF that was renamed to
 * `.png` (image.types) is exactly the file a suffix-only filter waves through. The MIME types come
 * first so a picker that shows a name for the filter names the four kinds and not four suffixes.
 */
export const IMAGE_INPUT_ACCEPT: string = [
  ...IMAGE_ACCEPTED_TYPES,
  ...IMAGE_ACCEPTED_TYPES.flatMap((type) => [...IMAGE_FILE_EXTENSIONS[type]]),
].join(',');

/**
 * The largest image that is accepted anywhere (image.too_large): 10 MB, counted in bytes, the same
 * number the client checks before uploading and the Worker checks after reading the body.
 */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** How many images one drop, paste or picker run may add (image.max_files). */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/**
 * The longest side an image is ever placed at, in world units (image.place_size): a 4032 x 3024
 * photo comes down to 800 on its long side, a small screenshot is placed at its own size.
 */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/** The smallest an image may be resized to, on either side, in world units. */
export const IMAGE_MIN_SIZE_WORLD = 16;

/** How much board is left between images laid out in a row (image.drop_multiple). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;

/**
 * How long an upload may sit at "uploading" before the board says the upload didn't finish
 * (image.unfinished). The clock is wall time since the placeholder was made, so it reads the same
 * on every board that has the image.
 */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60_000;

/**
 * How long a served image may be cached (image.serve_headers). An asset key is never reused, so a
 * year is honest and not a cache that can go stale.
 */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** How many bytes from the front of a file are read to work out what it is (image.sniff). */
export const IMAGE_SNIFF_BYTES = 12;
