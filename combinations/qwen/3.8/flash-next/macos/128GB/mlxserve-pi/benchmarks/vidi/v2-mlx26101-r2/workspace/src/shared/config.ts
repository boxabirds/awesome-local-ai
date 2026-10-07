/**
 * Product settings for vidi6. Every tunable number in the app lives here so it
 * can be changed in one place without a redesign (design "Named settings").
 * Stories 2-5 add their own settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit) — shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is verified to work without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------- sticky notes */

/** A sticky note is a square of this many world units (board units). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the characters of text a sticky note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in board units, so it scales with the board zoom. */
export const STICKY_FONT_MAX_PX = 24;

/**
 * Smallest note font size, in board units. Below this the text is not shrunk
 * any further: the overflow is hidden and the note shows a fade instead.
 */
export const STICKY_FONT_MIN_PX = 10;

/** Padding between a note's edge and its text, in world units. */
export const STICKY_TEXT_PADDING_WORLD = 12;

/**
 * How far the pointer has to travel after a pointerdown before the gesture
 * becomes a drag instead of a select (screen pixels).
 */
export const DRAG_THRESHOLD_PX = 3;

/**
 * How long a second click may arrive after a first one and still be the same
 * gesture (screen milliseconds). The board needs the number itself, not only the
 * browser: a click that placed a text object must not also be the first half of a
 * double-click that creates a note, and the pairing expires - a double-click half a
 * minute later is a new intention, not the old one arriving late.
 */
export const DOUBLE_CLICK_WINDOW_MS = 500;

/* ------------------------------------------------------- selection (story 7) */

/**
 * The resize handles are drawn this wide and tall in *screen* pixels, so they
 * stay grabbable at every zoom level; the transform gesture counter-scales them
 * by 1/zoom.
 */
export const HANDLE_SIZE_PX = 8;

/**
 * The smallest a sticky note may be resized to, in world units. Sticky notes are
 * square, so this is both their minimum width and minimum height; the registry
 * hands it to `clampScale` as sticky's `minSize`.
 */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * The largest any single object may be resized to, in world units. Unlike the
 * minimum (which each type declares in the registry) the maximum is one number
 * shared by every object type (`sel.size_limits`).
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** How far one arrow-key press moves the selection, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** How far one Shift+arrow press moves the selection, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** The six note colours a user may choose from (sticky.color). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour of a newly created note (sticky.create_dblclick). */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Every colour name in `STICKY_COLORS` (used for validation and the toolbar). */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Is `value` one of the six colour names? Unknown names are rejected. */
export const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);

/* ------------------------------------------------------------------ free text (story 9) */

/**
 * The widest a text object with *automatic* width may get, in world units. The
 * box widens with the longest line until it reaches this, and a line longer than
 * this wraps (`text.auto_width`).
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/**
 * The narrowest a text object may be, in world units: what dragging a side
 * handle inwards stops at, and the clamp of `setTextWidthFixed`.
 */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Hard limit on the characters a text object may hold (`text.limit`). */
export const TEXT_MAX_CHARS = 5000;

/**
 * The four sizes, in board units of font size, so a heading can be made to look
 * more important than a detail (`text.size`). The keys are what the document
 * stores and what the text toolbar shows.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size of newly created text (`text.create`: "a size M text object"). */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Every size name in `TEXT_SIZES`, small to large (for the text toolbar). */
export const TEXT_SIZE_NAMES = Object.keys(TEXT_SIZES) as TextSize[];

/** Is `value` one of the four size names? An unknown key is rejected. */
export const isTextSize = (value: unknown): value is TextSize =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);

/**
 * Line height as a multiple of the font size. The height of a text object is
 * always `lines x font size x TEXT_LINE_HEIGHT` (`text.height`), which is why it
 * is a setting rather than something the CSS happens to say.
 */
export const TEXT_LINE_HEIGHT = 1.3;

/** The font text is drawn and measured with (`Readability`: the board's sans-serif). */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * The slack added to an automatic width beyond the measured longest line, in
 * world units. Without it a glyph whose advance is measured tight sits exactly on
 * the edge of the box and the caret at the end of the line looks cut off; a line
 * that had to wrap makes the box {@link TEXT_MAX_AUTO_WIDTH_WORLD} wide whatever
 * this is.
 */
export const TEXT_AUTO_WIDTH_PADDING_WORLD = 8;

/**
 * How wide an average character is, as a fraction of the font size, for the one
 * case where no text measurement is possible at all: no canvas (a server-side
 * create, a headless test environment). The greedy wrapping, and so the height,
 * is computed from the estimate too, so a box made from an estimate is the right
 * shape even when it is not the right size (`text.layout`: "measurer unavailable
 * -> estimate, never throws").
 */
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

/* ------------------------------------------------------- shapes (story 10) */

/**
 * The three kinds a shape may be drawn as (`shape.create_drag`). The keys are
 * what the document stores; changing a shape's kind after it is made is out of
 * scope, so this list is only ever asked at creation and by the Shape menu.
 */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Is `value` one of the three kinds? An unknown kind creates nothing. */
/** Is `value` one of the three shape kinds? */
export const isShapeKind = (value: unknown): value is ShapeKind =>
  typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);

/** What each shape kind is called in the interface (`shape.ui`'s kind menu). */
export const SHAPE_KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

/**
 * The size of a shape dropped by a click (`shape.create_click`): a standard
 * square of this many board units, centred on the point that was clicked.
 */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * The smallest a dragged shape may be, in board units *in either direction*: a
 * drag narrower than this is a click that wobbled, and becomes a standard-size
 * shape instead. It is also the registry's `minSize` for the shape type, so
 * resizing stops at the same number.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Hard limit on the characters a shape's label may hold (`shape.label`). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** The outline of a shape, in board units, so it scales with the board. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/**
 * The seven fill swatches (`shape.style`): six colours and "no fill", which is a
 * colour name like any other as far as the document is concerned.
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

/** The six outline swatches (`shape.style`). */
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

/** Is `value` one of the seven fill names (including `none`)? */
export const isFillColor = (value: unknown): value is FillColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_FILL_COLORS, value);

/** Is `value` one of the six outline names? */
export const isStrokeColor = (value: unknown): value is StrokeColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_STROKE_COLORS, value);

/** The fill and outline of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/* ---------------------------------------------------- connectors (story 10) */

/**
 * How far the pointer must travel for a Connector drag to be an arrow at all
 * (`connector.no_accidental`): below this many board units nothing is created.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * How close a click must come to an arrow's line to select it
 * (`connector.select`), in *screen* pixels - so the hit area is this wide at
 * every zoom, which is why the client divides it by the zoom to get board units.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** The arrow's line, in board units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** How big the arrowhead is, in board units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** The radius of the four connection dots, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* ------------------------------------------------------------------- undo (story 8) */

/**
 * The typing pause that ends an undo step (PRD `undo.typing`: "typing that
 * continues without a pause of half a second or more"). Keystrokes closer
 * together than this are one step; a pause of this long or longer starts a new
 * one. It is also what merges the animation-frame writes of one drag into one
 * step, which is why the gestures and the text editor close the window
 * explicitly with `UndoController.boundary()` rather than waiting for a pause.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of a person's own steps one board tab remembers (`undo.limit`). The
 * oldest step is discarded when a new one arrives at the limit; the number is a
 * memory bound, not a feature - nobody is expected to press undo 200 times.
 */
export const UNDO_MAX_STEPS = 200;

/* ------------------------------------------------------- live collaboration */

/**
 * Soft capacity: the number of simultaneous editors the board is designed and
 * tested for. It is never enforced — a 6th person joins and edits normally —
 * but it drives the tests, which read this setting rather than a literal.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * The change-delivery requirement: a change made on one screen must appear on
 * every other screen within this many milliseconds (PRD `live.propagate`).
 * e2e measures against it and reports it, but does not gate on it, because the
 * model, the browsers and the server share one machine in the test setup.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the provider's reconnect backoff (y-websocket `maxBackoffTime`). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" confirmation shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Length of the outage in the catch-up verification (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Generous functional wait in e2e (all stories): tests wait up to this long
 * for a change to arrive, while latency is logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS rather than asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* --------------------------------------------------------------- persistence */

/**
 * How many stored update rows a board may accumulate before the log is folded
 * into a snapshot (persist.board_store). It bounds the work a load does: a load
 * replays one snapshot plus fewer than this many rows, however long the board
 * has been lived in.
 */
export const COMPACTION_UPDATE_COUNT = 500;

/** The same threshold expressed in stored update bytes, for boards of long text. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Snapshot rows are this big at most. Durable Object SQLite limits how large a
 * single row may be, so a board's encoded state is stored in several rows
 * instead of one; 512 KiB is far below every limit documented at design time.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/**
 * A room whose load failed retries at most this often: one load attempt per
 * failed load, not one per reconnect. The client's own retry is the provider's
 * backoff (RECONNECT_MAX_BACKOFF_MS), which is shorter, so this is what keeps a
 * broken board from turning every reconnect into a full storage read.
 */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

/** The big board the PRD names (persist.large_board): how many notes it holds. */
export const PERSIST_TESTED_NOTES = 2000;

/**
 * Soft budget for opening the big board (PRD `persist.large_board`). e2e reports
 * the measured open time against it and does not gate on it, because the model,
 * the browsers and the server share one machine here.
 */
export const BOARD_LOAD_BUDGET_MS = 3_000;

/**
 * Version of the *storage* layout (the tables), written into `storage_meta` on
 * migration. It is separate from the document's own `meta.schemaVersion`, which
 * describes the board content and does not change when the tables do.
 */
export const STORAGE_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ sharing */

/**
 * How long clicking **New board** may take before it is late (PRD
 * `share.create`: "open it within 2 seconds on a typical broadband connection").
 * e2e logs the measured click-to-board time against it and does not gate on it,
 * for the same reason every other budget here is reported and not asserted.
 */
export const CREATE_BUDGET_MS = 2000;

/**
 * How long the Share panel's **Copy link** button says "Link copied" before it
 * goes back to being a button (PRD `share.copy`).
 */
export const LINK_COPIED_MS = 2000;

/**
 * The first wait before a board link check is retried (PRD `share.unreachable`).
 * It doubles on every failure — 1 s, 2 s, 4 s — and stops doubling at
 * {@link RECONNECT_MAX_BACKOFF_MS}, which is the ceiling the socket's own
 * reconnect already uses: one retry ceiling for the whole app.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* ---------------------------------------------------------------- pen (story 11) */

/**
 * The Pen tool's inks (`src/shared/objects/stroke.ts`, PRD "Sketch freehand with a
 * pen": "colour: six colors").
 *
 * They are *ink* names, not paper names: the sticky palette above is what a note is
 * made of, this is what a drawn line is made of, and the two have nothing to do with
 * each other beyond both being colours. A stroke stores the name and the hex is
 * looked up when it is drawn, which is what keeps one red the same red on every
 * screen - and lets the set of reds change without a migration.
 */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

/** One of the inks. */
export type PenColor = keyof typeof PEN_COLORS;

/** The six, in the order the option buttons show them - black first, as the PRD lists. */
export const PEN_COLOR_LIST: readonly PenColor[] = Object.keys(PEN_COLORS) as PenColor[];

/** What each ink is called in the interface, next to its swatch. */
export const PEN_COLOR_NAMES: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

/** Whether a value is one of the inks. */
export const isPenColor = (value: unknown): value is PenColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_COLORS, value);

/** The ink a stroke is drawn with when nobody chose one (`pen.options`). */
export const DEFAULT_PEN_COLOR: PenColor = 'black';

/**
 * The three pen widths, in world units (`pen.options`: thin 2, medium 4, thick 8).
 *
 * They are widths of the *ink*, so they belong to the stroke rather than to its box:
 * resizing a stroke in proportion makes the line longer and keeps the pen that drew
 * it the same size (`pen.resize`: "thickness unchanged"), which is why the client
 * scales the points and never this number.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;

/** One of the three pen widths. */
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** The three, thin to thick. */
export const PEN_THICKNESS_LIST: readonly PenThickness[] = Object.keys(
  PEN_THICKNESS_WORLD,
) as PenThickness[];

/** What each width is called in the interface. */
export const PEN_THICKNESS_NAMES: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** Whether a value is one of the three pen widths. */
export const isPenThickness = (value: unknown): value is PenThickness =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(PEN_THICKNESS_WORLD, value);

/** The width a stroke is drawn with when nobody chose one (`pen.options`). */
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/**
 * How far a raw point may stray from the line it is simplified into, in *screen*
 * pixels (`pen.smooth`).
 *
 * A screen pixel, not a board unit: a pointer leaves a dozen points per centimetre
 * and most of them say nothing the neighbours have not already said, but how much
 * can be spared depends on how big a centimetre looks on this person's screen. The
 * tool divides it by the zoom, so the same stroke drawn at 400% keeps four times as
 * many points - and looks the same at every zoom, which is what "faithful" means
 * here.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * How many raw points one stroke may hold (`pen.long_stroke`).
 *
 * Five thousand is about a minute of drawing at 80 points a second. The limit is not
 * a performance finding - a simplified stroke of five hundred points draws in no
 * time - it is a ceiling on how big one field of one document can grow from one
 * gesture, because everything about the board travels whole: an uncapped drag would
 * be an uncapped document. A drag past it commits what it has and starts a new stroke
 * from the same point, so the line on the board is unbroken and nothing is thrown
 * away.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How near a drawn line a click has to land to be a click *on* it, in screen pixels
 * (`pen.select`).
 *
 * Six is the width of a fingertip's aim and the same number an arrow already uses,
 * so the two things you draw on the board are equally easy to catch. It is a screen
 * measurement on purpose: a stroke that became easy to select at 400% and impossible
 * at 40% would be two different tools.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/**
 * The smallest a stroke's box may be dragged to, in world units (`pen.resize`).
 *
 * It is smaller than a shape's minimum because a stroke's box is not a box the
 * person drew: it is the room the line happens to occupy, and a straight line drawn
 * on the board is as flat as the hand that drew it was steady.
 */
export const STROKE_MIN_SIZE_WORLD = 4;

/* ----------------------------------------------------------- images (story 12) */

/**
 * The file types a person may add to the board (`image.types`).
 *
 * Four names, and they are only the *client's* first guess: the browser rejects a
 * file whose own reported type is not one of these before it uploads anything, but
 * the server decides from the bytes (`sniffImageType`), because a file's name and
 * its `Content-Type` are both written by the machine that sent them.
 */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Whether a MIME type is one of the four (`image.types`). */
export const isAcceptedImageType = (type: unknown): boolean =>
  typeof type === 'string' && (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);

/**
 * The largest file that may be added, in bytes (`image.size_limit`).
 *
 * Ten megabytes, counted as 10 * 1024 * 1024 because that is the number a person
 * reads as "10 MB" on a file's properties, and it is the same number the server
 * measures `Content-Length` and the body against. The client refuses before any
 * byte is sent; the server refuses again, because the client can be a curl.
 */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * How many files one drop, paste or pick may add (`image.count_limit`).
 *
 * Twenty, and the limit is on the *action* rather than on the board: past it the
 * first twenty are added and the rest are refused with a message, because quietly
 * dropping half of somebody's batch is worse than making them drag twice.
 */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/**
 * The longest side an added image is placed at, at most, in board units
 * (`image.placement_size`).
 *
 * One natural pixel is one board unit, so a screenshot arrives at its own size -
 * until it is bigger than the board's own view, which is what this number is: a
 * 4032 x 3024 photo placed at 4032 units is a photo that fills four screens and
 * pushes the moodboard off it. Both sides are divided by the same factor, so the
 * picture keeps its proportions, and an image smaller than this is never enlarged.
 */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/**
 * The smallest either side of an image may be dragged to, in board units
 * (`image.aspect_resize`).
 *
 * Sixteen, which is what a resize handle is (8 px) doubled: an image smaller than
 * the handle that resizes it cannot be grabbed again, and a 4032-pixel photo
 * dragged to a sliver is a picture nobody can get back.
 */
export const IMAGE_MIN_SIZE_WORLD = 16;

/**
 * The space between images laid out in a row, in board units
 * (`image.drop` / `image.pick`).
 *
 * The same 24 the dot grid is spaced by, so a batch dropped on the board lands on
 * the grid rather than in a heap at one point.
 */
export const IMAGE_LAYOUT_GAP_WORLD = 24;

/**
 * How long an `uploading` image may stay `uploading` before everyone is told it
 * did not finish (`image.unfinished`).
 *
 * Five minutes is longer than any upload this board can produce - ten megabytes on
 * a real connection is seconds - so an image still claiming to upload after that is
 * not uploading: the tab that held the file was closed or reloaded, and the object
 * it left behind will never be updated by anyone. Without this the board keeps a
 * permanent "Uploading…" that nobody can explain and nobody can remove.
 */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

/**
 * How often the board re-renders while an image is uploading, in milliseconds.
 *
 * `IMAGE_UPLOAD_STALE_MS` is a fact about time, and a board that only re-renders on
 * an event would show "Uploading…" forever on a screen that receives nothing. Half
 * a minute is often enough that the change appears "by itself" and rare enough that
 * a board with no uploading images pays nothing (the interval is only running while
 * one exists).
 */
export const IMAGE_STALE_TICK_MS = 30_000;

/**
 * How long a served asset may be cached, in seconds.
 *
 * A year, and `immutable`: an asset key is never reused and never changed, so a
 * cached copy is never stale, and the board's images are the one thing on this site
 * that a browser may keep without asking.
 */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

/**
 * How many bytes of a file decide what it is (`image.types`, server side).
 *
 * Twelve, because that is what the longest signature needs: a WebP is `RIFF`, four
 * ignored bytes and `WEBP`. The signature is read out of the body only - never out
 * of a file name or a `Content-Type` - which is what makes a PDF renamed `.png` and
 * an SVG answered for what they are.
 */
export const IMAGE_SNIFF_BYTES = 12;
