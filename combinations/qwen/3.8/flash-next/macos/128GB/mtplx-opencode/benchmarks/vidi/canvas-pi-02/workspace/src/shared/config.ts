/**
 * Product settings for the vidi6 board. Stories 2-5 add their own settings to
 * this file. Everything that the design calls a "named setting" lives here so
 * it can be changed in one place without a redesign.
 */

/** Smallest zoom the board allows (10%). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (400%). */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values within this relative distance of a step value snap to it. */
export const ZOOM_STEP_SNAP_RELATIVE_EPSILON = 1e-9;

/** Multiplier turning a LINE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_LINE_PX = 32;

/** Multiplier turning a PAGE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_PAGE_PX = 800;

/** Zoom -> percentage label conversion (100% is a zoom of 1). */
export const PERCENT = 100;

/** Dot-grid dot radius in screen pixels (used by the CSS background). */
export const GRID_DOT_RADIUS_PX = 1.2;

/** Size of the origin crosshair marker, in screen pixels. */
export const ORIGIN_MARKER_SIZE_PX = 16;

/** Sticky note edge length in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters are left. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (world units == screen px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel that turns a press on a note into a drag. */
export const DRAG_THRESHOLD_PX = 3;

/**
 * The six note colours. Keys are the names stored in the document (and later
 * on the wire), values the fill used on screen.
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

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* --------------------------------------------------------------------- *
 * Story 3: live collaboration.
 * --------------------------------------------------------------------- */

/**
 * How many people a board is designed and tested for at the same time. This
 * is a soft number: it sizes the tests and the design, it never refuses a
 * connection (PRD live.over_capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * The change-delivery budget, measured from the moment a change appears on
 * the sender's screen to the moment it appears on a receiver's (PRD
 * live.propagate).
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1_000;

/** Upper bound of the provider's reconnect backoff, in milliseconds. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2_000;

/** The outage a catch-up test cuts, matching the PRD's live.catch_up check. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/* --------------------------------------------------------------------- *
 * Story 4: board persistence.
 * --------------------------------------------------------------------- */

/**
 * How long a room waits for its board before it stops trying.
 *
 * The read is synchronous inside the isolate, so this is not a queue timeout:
 * it is the point where a slow or wedged storage read stops being "slow" and
 * becomes a reason to refuse the connection. By the time it passes, the client
 * has already started its own retries, which is why answering late is no better
 * than answering nothing.
 */
export const LOAD_TIMEOUT_MS = 1_000;

/**
 * How many board updates a room buffers before writing them down.
 *
 * Small boards gain little from buffering and pay for it in risk; large boards
 * write megabytes per checkpoint and cannot afford one per keystroke. Eight is
 * the compromise that is tested, not the number that was guessed.
 */
export const FLUSH_UPDATE_THRESHOLD = 8;

/**
 * How long buffered updates may sit before they are written anyway.
 *
 * A room that goes quiet after one change still has to make that change
 * durable, and its sockets have about ten seconds of hibernation left before
 * the instance is torn down. Half a second keeps the delay far inside that.
 */
export const FLUSH_INTERVAL_MS = 500;

/**
 * The largest frame a room will look at, in bytes.
 *
 * A board update is normally a few hundred bytes; a whole board travels in the
 * reply, not in a request, so a request over this size is either a client that
 * has lost its mind or somebody probing the socket. Refusing it is rule 1, and
 * it is the reason the room never has to reason about a giant buffer.
 */
export const MAX_MESSAGE_BYTES = 128 * 1024;

/* --------------------------------------------------------------------- *
 * Story 5: sharing a board with a link.
 * --------------------------------------------------------------------- */

/** How many boards one visitor may create within the window below. */
export const BOARD_CREATE_LIMIT = 10;

/** The creation window, in seconds. Must match `wrangler.jsonc`'s ratelimit. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** How many id attempts board creation makes before it gives up (500). */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** The create-a-board budget, from click to open board (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;

/** How long the "Link copied" confirmation stays up. */
export const LINK_COPIED_MS = 2000;

/**
 * The first backoff for the "does this board exist" check. It doubles on every
 * retry up to `RECONNECT_MAX_BACKOFF_MS`, the same ceiling story 3's provider
 * uses, so a link check and a socket retry behave alike.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* --------------------------------------------------------------------- *
 * Story 6: presence - who is here, where they are pointing.
 * --------------------------------------------------------------------- */

/**
 * The palette people are drawn in, in order.
 *
 * Its length is a constraint, not a preference: while the board is at its
 * simultaneous-editor capacity, every person must get a different colour, so
 * there have to be at least `MAX_CONCURRENT_EDITORS` entries here. The unit
 * test that reads both constants is what keeps them from drifting apart.
 */
export const PRESENCE_COLORS = [
  '#E53935',
  '#1E88E5',
  '#43A047',
  '#FB8C00',
  '#8E24AA',
  '#00897B',
  '#F4511E',
  '#3949AB',
] as const;

/** How many avatars the stack shows before it collapses the rest into "+N". */
export const MAX_AVATARS_SHOWN = MAX_CONCURRENT_EDITORS;

/**
 * How often one person's cursor may be published.
 *
 * A pointer generates a move every frame; a board with five moving people
 * would otherwise spend its bandwidth on arrows. Fifty milliseconds is twenty
 * updates a second, which is above what the eye resolves and far below the
 * delivery budget below.
 */
export const CURSOR_BROADCAST_INTERVAL_MS = 50;

/** The cursor delivery budget, from one screen to another (PRD presence.cursors). */
export const CURSOR_LATENCY_BUDGET_MS = 500;

/** How far a cursor may be from the point it names, in screen pixels. */
export const CURSOR_POSITION_TOLERANCE_PX = 2;

/** How long a newcomer may take to appear on everyone else's screens. */
export const PRESENCE_JOIN_BUDGET_MS = 1000;

/** How long idle people may take to appear on a newcomer's screen. */
export const PRESENCE_EXISTING_VISIBLE_BUDGET_MS = 2000;

/** How long a person who closed the tab may keep being drawn. */
export const PRESENCE_CLOSE_REMOVAL_BUDGET_MS = 3000;

/**
 * How long a person whose connection died silently may keep being drawn.
 *
 * `y-protocols` forgets a peer thirty seconds after its last update; the extra
 * five seconds is the margin for the clock that measures it, so a test of this
 * budget is a test of the product, not of two timers racing.
 */
export const PRESENCE_STALE_REMOVAL_BUDGET_MS = 35_000;

/**
 * How long the people drawn on a board are held onto after the link to the
 * room drops, before the board is rebuilt from what the room actually says.
 *
 * A wobble in the connection is not a room emptying. While the link is down the
 * names, arrows and outlines stay where they were — a board that loses everyone
 * for a second and gets them back teaches people to distrust the stack — and
 * when the link comes back the board asks the room who is here and corrects
 * itself inside this window, so a person who really did go is not drawn
 * forever. This is the same hundred milliseconds as the join budget, spent in
 * the other direction.
 */
export const PRESENCE_RECONNECT_RECONCILE_MS = 1000;

/** The longest name a person may choose, in characters. */
export const NAME_MAX_CHARS = 32;

/** Where a guest name and colour are kept between visits (per browser). */
export const IDENTITY_STORAGE_KEY = 'vidi6.identity';

/* --------------------------------------------------------------------- *
 * Story 7: select, move, resize and delete several objects at once.
 * --------------------------------------------------------------------- */

/** Handle size in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;

/** Minimum size for a sticky note (world units). */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Maximum size any object can be resized to (world units). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* --------------------------------------------------------------------- *
 * Story 8: undo and redo my own changes.
 * --------------------------------------------------------------------- */

/**
 * How long a typing burst may pause before the next keystroke starts a new
 * undo step (`undo.steps`). Consecutive changes that arrive within this
 * window are one step; the first change after a longer pause is a new step.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many undo steps one person's history holds (`undo.limit`). Oldest
 * steps fall off the front when a new step arrives and the history is full.
 */
export const UNDO_MAX_STEPS = 200;

/* --------------------------------------------------------------------- *
 * Story 9: free text.
 * --------------------------------------------------------------------- */

/** Maximum automatic width for a text object (world units). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum fixed width for a text object (world units). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;

/** Size presets: key → font-size in world units. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Size of a freshly created text object. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line-height multiplier for text objects. */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/* --------------------------------------------------------------------- *
 * Story 10: shapes and connectors.
 * --------------------------------------------------------------------- */

export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const SHAPE_DEFAULT_SIZE_WORLD = 160;
export const SHAPE_MIN_SIZE_WORLD = 20;
export const SHAPE_LABEL_MAX_CHARS = 500;
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
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

export const CONNECTOR_MIN_LENGTH_WORLD = 8;
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* --------------------------------------------------------------------- *
 * Story 11: sketch freehand with a pen.
 * --------------------------------------------------------------------- */

/** The six pen colours. Keys are the names stored in the document. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;

/** Pen thickness in world units, so a stroke scales with zoom. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;

/** Colour and thickness a fresh pen session starts with. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';

/**
 * How far a simplified stroke may stray from what was drawn, in screen
 * pixels at the zoom used while drawing (`pen.smooth`). The tolerance the
 * simplifier actually uses is this divided by the zoom, so it stays one
 * screen pixel at 50%, 100% and 200%.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/**
 * Longest continuous stroke kept before it is split (`pen.long_stroke`).
 * A split is invisible: the next part starts at the last point of the one
 * before it, so the drawn line has no gap.
 */
export const STROKE_MAX_POINTS = 5000;

/**
 * How close to the drawn line a click has to be to select a stroke, in
 * screen pixels (`pen.select`). Closer than this, or closer than half the
 * thickness if the stroke is thicker, and the click is on the drawing.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;

/** Smallest size a stroke's bounding box may be resized to (world units). */
export const STROKE_MIN_SIZE_WORLD = 4;

/* --------------------------------------------------------------------- *
 * Story 12: drop images onto the board.
 * --------------------------------------------------------------------- */

/**
 * The image types the board accepts. A file is judged by its content (the
 * Worker sniffs magic bytes), never by its name or its declared type; this
 * list is what the client trusts for the pre-upload check and the picker
 * filter. SVG is deliberately absent: it can carry scripts.
 */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Most images one drop, paste or picker batch may add. */
export const IMAGE_MAX_FILES_PER_ADD = 20;

/** Longest side of a freshly placed image, in world units (design `imageMaxSide`). */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;

/** Smallest an image may be resized to, in world units (design `imageMinSize`). */
export const IMAGE_MIN_SIZE_WORLD = 16;

/**
 * How long an upload may hang before everyone calls it unfinished.
 * The clock is derived at render time (five minutes after `uploadStartedAt`),
 * never a timer: nobody is there to set a timeout for a browser that closed.
 */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;

/** How often a board with an upload in flight re-renders the clock. */
export const IMAGE_UPLOAD_CLOCK_TICK_MS = 30_000;

/** How many uploads one visitor may start within the window below. */
export const IMAGE_UPLOAD_LIMIT = 60;

/** The upload window, in seconds. Must match `wrangler.jsonc`'s ratelimit. */
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60;

/** Served assets are immutable: keys are random and never reused. */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;

/** Bytes read from the head of a file to decide its type. */
export const IMAGE_SNIFF_BYTES = 12;
