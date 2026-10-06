// Product settings for vidi6. Stories 2-5 add their own settings to this file.

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level (screen pixels per world unit) — shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the starting point panning is guaranteed (and tested). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------------ sticky notes (story 2) */

/** Sticky note side length, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Longest note text, in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (= px on screen at 100 % zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size the auto-fit shrinks to. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement that turns a press into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/** Inner padding of a sticky note, in world units (extra to the design list). */
export const STICKY_PADDING_WORLD = 12;
/** The six preset note colours; the key is the name stored in the document. */
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

/* ------------------------------------------------- selecting and transforming objects (story 7) */

/** Side of one resize handle, in screen pixels (the same size at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky note, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest any object may be resized to, in world units; one limit for every type. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** One press of an arrow key moves the selection this many world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift plus an arrow key moves the selection this many world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* ------------------------------------------------------------------ live collaboration (story 3) */

/**
 * Soft simultaneous-editor capacity: the number of people one board is designed
 * and tested for. It is never enforced — a 6th person joins and edits normally —
 * and every capacity test reads this constant instead of a literal.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** Time a change takes to appear on another screen (PRD `live.propagate`). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Where the board rooms live; one board's room is `${ROOM_PATH_PREFIX}/<board id>`. */
export const ROOM_PATH_PREFIX = '/api/rooms';
/** Upper bound of the reconnect backoff (y-websocket `maxBackoffTime`). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/**
 * How often a board asks its room for the room's state, even when nobody is typing.
 *
 * Two reasons, both to do with a board that nobody is touching. The connection gives up on a
 * line it has heard nothing on for `ROOM_SILENCE_LIMIT_MS`, so a board that is merely idle
 * would otherwise show "Reconnecting…" and do it again a few seconds later; and a change that
 * got lost on the way (a reconnect that raced, a room that restarted) is put right by the next
 * exchange instead of waiting for somebody to type. Short enough that a network which has come
 * back is noticed quickly — the board cannot know it is back until it gets an answer.
 */
export const ROOM_RESYNC_INTERVAL_MS = 5_000;
/**
 * How long a connection may go without hearing anything before it is given up on. Has to
 * comfortably exceed `ROOM_RESYNC_INTERVAL_MS`, because an idle board's only traffic is that
 * resync; three beats' worth is the margin.
 */
export const ROOM_SILENCE_LIMIT_MS = 15_000;
/**
 * How long a connection attempt is allowed to sit unfinished before we give up on it and
 * dial again. A dial that neither completes nor fails is not something a provider recovers
 * from on its own: its retry machinery runs when a connection closes, and a socket that is
 * still 'connecting' has not closed and will not close by itself. Half-dead networks —
 * captive portals, a Wi-Fi that has stopped routing, a server that stopped answering the
 * handshake — produce exactly that.
 */
export const RECONNECT_DIAL_TIMEOUT_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the catch-up test (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Generous functional timeout for every e2e wait (all stories). Latency is
 * measured and logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted:
 * the model, the browsers and the server share one machine.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ persistence (story 4) */

/** Compact a board's update log once this many rows have piled up. */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or once this many bytes of updates have piled up. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/**
 * Size of one snapshot chunk row. Chosen far below the per-row size limit of
 * SQLite-backed Durable Objects (2 MiB as documented when this was written, and
 * 1 MiB in older builds), so a snapshot of any board size is a list of rows that
 * each fit comfortably.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A board that failed to load is loaded again at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** The board size the persistence tests create and measure (PRD `persist.large_board`). */
export const PERSIST_TESTED_NOTES = 2000;
/** How long opening a `PERSIST_TESTED_NOTES` board may take (PRD `persist.large_board`). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the storage tables, kept in `storage_meta.storage_schema_version`. */
export const STORAGE_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ sharing a board by link (story 5) */

/**
 * How long a click on New board may take before the board is on screen (PRD `share.create`).
 * Creation is one id generation plus one Durable Object call plus one small SQLite write, so
 * this is a promise that can be kept; the e2e test measures it and logs it rather than
 * asserting it, because the machine running the test is not a machine to promise timings on.
 */
export const CREATE_BUDGET_MS = 2000;
/** How long the Share panel's button says "Link copied". */
export const LINK_COPIED_MS = 2000;
/**
 * How long a board page waits before checking a link it could not reach. Doubles on every
 * failure, up to `RECONNECT_MAX_BACKOFF_MS` — the same backoff the live connection uses, so
 * a person who opened a link during an outage is retried on the same rhythm as everybody else.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* ------------------------------------------------------------------ undo and redo (story 8) */

/**
 * The pause in typing that ends an undo step: keystrokes closer together than this are one thing the
 * person did, a pause of this long or longer is two.
 *
 * Half a second is roughly where a person stops typing a word and starts deciding what to say next,
 * which is the line the PRD draws ("typing that continues without a pause of half a second or more").
 * A drag needs none of this: it is closed by an explicit boundary when the pointer comes up.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of a person's own steps the board remembers, oldest first to be forgotten.
 *
 * The number is generous because the cost of a step is small (one Yjs inverse range, in this tab's
 * memory only) and the cost of running out is a mistake that cannot be taken back. It is also a
 * bound: a board opened for a whole afternoon does not accumulate history without limit.
 */
export const UNDO_MAX_STEPS = 200;

/* ------------------------------------------------------------------ free text (story 9) */

/** Largest width a text object grows to on its own before its lines wrap, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Narrowest a text object may be dragged to with a side handle, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Longest a text object may become, in characters; extra characters are not added. */
export const TEXT_MAX_CHARS = 5000;
/** The four size presets, in world units — the font size of a size at 100 % zoom. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of a newly created text object. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** One line is `TEXT_SIZES[size] × TEXT_LINE_HEIGHT` world units tall. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The font text objects are measured and drawn in: the board's standard sans-serif. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/* ------------------------------------------------------------------ shapes and connectors (story 10) */

/**
 * The three shape kinds, in the order the Shape menu lists them.
 *
 * A kind is decided when the shape is made and never changed afterwards — "no changing a shape's kind"
 * is the PRD's out-of-scope list, which is why nothing in the model takes a kind after creation.
 */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** The kind the Shape tool is on before anybody picks one. */
export const DEFAULT_SHAPE_KIND: ShapeKind = 'rect';
/** The size a shape is when the pointer clicked instead of dragged, in world units (both sides). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/**
 * Smallest a shape drag may be and still be the rectangle that was dragged.
 *
 * Below this in *either* direction the drag is a click: the shape is the standard size instead, which
 * is what makes a flick of the wrist a shape and not a 4-unit sliver nobody can click on again. It is
 * also the smallest a resize handle may take a shape to.
 */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Longest a shape's label may become, in characters; extra characters are not added. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline width of a shape, in world units — so it scales with the shape, as a drawn line does. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/**
 * The label's font size, in world units.
 *
 * Not in the design's settings list; a label has to be drawn at *some* size, and the size has to be in
 * the document's units rather than measured from the shape, because a label that grew with its shape
 * would be a label nobody asked for when they dragged a corner.
 */
export const SHAPE_LABEL_FONT_SIZE_WORLD = 20;
/** The seven fill names, in toolbar order; `none` is the shape drawn with only its outline. */
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
/** The six outline names, in toolbar order. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
/** Fill of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
/** Outline of a newly created shape. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Label colour of a shape: the darkest outline, so a white shape is readable by default. */
export const SHAPE_LABEL_COLOR = '#263238';

/* ------------------------------------------------------------------ connectors (story 10) */

/**
 * Shortest an arrow may be, in world units.
 *
 * A drag shorter than this is a pointer that was lifted where it was put down: nobody draws an arrow by
 * moving two pixels, and an arrow between an object and itself two pixels away is clutter nobody can
 * pick up again.
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/**
 * How close to an arrow's line a click has to be to be *on* it, in screen pixels.
 *
 * Screen pixels, not world units, on purpose: the tolerance is a statement about what a pointer can
 * aim at, and it has to stay that size when the board is zoomed. The hit test divides it by the zoom to
 * get the world distance a click is allowed to miss by, which is why an arrow is exactly as hard to
 * click at 50 % as at 200 %.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Width of the arrow's line, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/**
 * What an arrow is drawn in.
 *
 * The same ink a shape's label is written in, and for the same reason: a diagram is ink on a board, and a
 * second colour in the palette would be a thing to choose that nobody asked to choose. This build has no
 * UI for arrow colour, so it is a setting and not a field of the document — an arrow written by a client
 * that has one is still drawn in this colour, which is a preference and not a fault.
 */
export const CONNECTOR_COLOR = '#263238';
/** Length of the arrowhead's point, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of the four connection dots the Connector tool shows, in screen pixels. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Radius of the two handles a selected arrow shows at its ends, in screen pixels. */
export const CONNECTOR_HANDLE_RADIUS_PX = 5;

/* ------------------------------------------------------------------ sketching with a pen (story 11) */

/**
 * The six colours the Pen draws with, in toolbar order.
 *
 * Names are what the document stores (`black`, not `#212121`), which is what lets a later change to what
 * `blue` looks like restyle every stroke ever drawn — and what makes a stroke drawn by a client with a
 * bigger palette still readable here (see {@link strokeColorOf}). A stroke keeps the name it was drawn
 * with for ever: changing the pen's colour changes the next stroke and never the last one.
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
/** Every colour name, in the order the pen toolbar draws its swatches. */
export const PEN_COLOR_NAMES = Object.keys(PEN_COLORS) as readonly PenColor[];
/**
 * The three thicknesses, in world (board) units.
 *
 * Board units and not screen pixels, on purpose and in spite of the fact that the pointer that draws the
 * stroke is measured in pixels: a stroke is a mark *on the board*, so it has to be as thick at 50 % as
 * the board it sits on is small, which is what makes a sketched diagram still look like the diagram when
 * it is zoomed out. The three names are what the document stores; the numbers are how they are drawn.
 */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
/** Every thickness name, in the order the pen toolbar draws its buttons. */
export const PEN_THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as readonly PenThickness[];
/** What a stroke is drawn in before anybody has chosen. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
/** How thick a stroke is before anybody has chosen. */
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
/**
 * How far the finished stroke may lie from the path that was drawn, in screen pixels.
 *
 * The smoothing's whole budget, and the PRD's whole sentence about it: no point of the finished stroke is
 * farther than this from the path the person drew. It is divided by the zoom in use while drawing, so it
 * is one *pixel* on that person's screen at any zoom and a finer line at 200 % than at 50 % — which is
 * the right way round: zoomed in, the drawing is being done in more pixels, so it may be kept to fewer.
 */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/**
 * Most points one stroke may hold.
 *
 * A stroke is a plain array in the document, so its size is the document's problem: five thousand points
 * is a stroke that has been drawn for a couple of minutes without lifting the pointer, and a board whose
 * objects can each hold ten thousand numbers is a board that syncs slowly for everybody. Past the limit the
 * stroke is finished and the drawing continues as a new stroke from the same last point, so a two-minute
 * squiggle is two objects that join with no gap rather than one object of unbounded size.
 */
export const STROKE_MAX_POINTS = 5000;
/**
 * How close to a stroke's line a click has to be to be *on* it, in screen pixels.
 *
 * The same rule the arrow was built with, for the reason the arrow was built with it: it is a statement
 * about what a pointer can aim at, so it is stated in pixels and divided by the zoom, and a stroke is
 * exactly as easy to pick up at 50 % as at 200 %. It is also the reason a stroke does not swallow the
 * board: a scribble's bounding box is mostly air, and air is not on the line.
 */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest a stroke may be dragged to, in world units: its dot at the thickest pen, give or take. */
export const STROKE_MIN_SIZE_WORLD = 4;
