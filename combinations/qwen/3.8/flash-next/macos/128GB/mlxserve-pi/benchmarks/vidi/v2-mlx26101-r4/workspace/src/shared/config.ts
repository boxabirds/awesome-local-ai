/**
 * Product settings for the board. Every tunable number lives here so it can be
 * changed in one place without a redesign (stories 2-5 add to this file).
 */

/** Smallest zoom level the board can be scaled to (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom level the board can be scaled to. */
export const ZOOM_MAX = 4;

/** Multiplier applied by one zoom step (a zoom step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = Math.exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one line unit of a wheel event (`deltaMode === LINES`). */
export const WHEEL_LINE_PX = 16;

/** Fraction of the viewport one page unit of a wheel event represents. */
export const WHEEL_PAGE_VIEWPORT_FRACTION = 1;

/** `WheelEvent.deltaMode` values, named so the conversion reads clearly. */
export const WHEEL_DELTA_MODE_PIXELS = 0;
export const WHEEL_DELTA_MODE_LINES = 1;
export const WHEEL_DELTA_MODE_PAGES = 2;

/* ------------------------------------------------------------- sticky notes -- */

/** Width and height of a sticky note in world units (it is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Longest note text the board accepts; characters beyond it are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows and is faded out. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Space between a note's edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 12;

/* ------------------------------------------------------ selecting objects -- */

/**
 * Side of one resize handle of the selection's bounding box, in *screen* pixels:
 * the handles are the same size on screen at every zoom, so this is not a world
 * measurement.
 */
export const HANDLE_SIZE_PX = 8;

/** Smallest sticky note the board accepts, in world units (it stays a square). */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * Largest object the board accepts in either dimension, in world units. One
 * setting for every object type: a type declares its own minimum in the registry,
 * the maximum is the board's, so a resize cannot make something unrenderable.
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** How far one arrow key moves the selection, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** How far Shift + an arrow key moves the selection, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** The six note colours, keyed by the name used in the document and in labels. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* ------------------------------------------------------- free text (story 9) -- */

/**
 * The four text sizes, in *world* units, keyed by the name a person picks.
 *
 * They are board units rather than screen pixels for the same reason a sticky note's font is: text is
 * part of the board, so it scales with zoom instead of being re-laid-out at every zoom level. The size
 * is stored as the *key* (`'M'`), never as the number, so a board still reads the same if these numbers
 * are ever retuned.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a piece of text is born with, and the one a stored but unknown size key falls back to. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Whether a name is one of the four sizes the board offers. */
export function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TEXT_SIZES, value);
}

/** Longest text the board accepts; characters beyond it are dropped as they are typed or pasted. */
export const TEXT_MAX_CHARS = 5000;

/** How close to `TEXT_MAX_CHARS` the counter starts saying the number out loud. */
export const TEXT_COUNTER_THRESHOLD_CHARS = 50;

/**
 * How wide a line of text may get before it wraps, in world units.
 *
 * This is a limit on the *words*, not on the box: the box a person sees is this plus the padding on both
 * sides (`MAX_TEXT_BOX_WIDTH_WORLD`), and a line that measures exactly this is a line that fits — one line,
 * not an overflow. Keeping the two numbers apart is what lets the DOM wrap where the model says it should:
 * the element is the width of the box, its padding takes off the same amount the model took off, and the
 * words are left with exactly this much room.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/**
 * Narrowest text object the board accepts, in world units. It is the width of the widest word that will
 * ever be typed with the sizes above ("uncharacteristically" at S is about 30 units), so a drag that
 * hits this limit is stopping the box, not the word — a word that does not fit is still drawn, on a line
 * of its own.
 */
export const TEXT_MIN_WIDTH_WORLD = 40;

/**
 * Extra room a text box gives its text on each side, in world units: text pressed against the edge of its
 * own box reads as though it were cut off, and a caret with the selection frame on top of it is hard to
 * look at.
 *
 * It is per side, and it is inside the box rather than outside it — the box is `border-box`, so a stored
 * width of W lays its words out in `W - 2 x TEXT_PADDING_WORLD`. That is the same arithmetic the element
 * does, which is the only reason the two agree about where a line ends.
 */
export const TEXT_PADDING_WORLD = 8;

/** The widest a text box in auto mode is drawn: the widest a line may be, plus the padding either side. */
export const MAX_TEXT_BOX_WIDTH_WORLD = TEXT_MAX_AUTO_WIDTH_WORLD + TEXT_PADDING_WORLD * 2;

/**
 * The narrowest room words may be laid out in, in world units: the narrowest box the board accepts with its
 * padding taken off. A word longer than this is still drawn, on a line of its own.
 */
export const MIN_TEXT_CONTENT_WIDTH_WORLD = TEXT_MIN_WIDTH_WORLD - TEXT_PADDING_WORLD * 2;

/** Line height as a multiple of the font size, so a box tall enough for n lines is n times this. */
export const TEXT_LINE_HEIGHT = 1.3;

/**
 * The font text is measured in and drawn in. The same string is handed to the canvas measurer and to the
 * element, which is what makes a measured box and a drawn box agree; there is no webfont, so in practice
 * this resolves to the system UI font on every client.
 */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Average glyph width as a fraction of the font size, used only where there is no canvas to measure
 * with (a server, a test environment without one). It is a guess about Latin text and nothing else, and
 * it is a guess that is only ever used to keep a box from being zero-sized — never to decide where a
 * word wraps on somebody's screen.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.5;

/* ------------------------------------------------------------------- live -- */

/**
 * How many people the board is designed and tested for while they edit at the
 * same time. It is a soft number: nothing in the product refuses a 6th person,
 * and no code may treat it as a limit — only tests and design use it, so the
 * capacity can change here without a redesign.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** How long a change may take to appear on someone else's screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Longest wait the connection makes before retrying a lost board server. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** How long the catch-up test keeps one participant's network down (live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * How long an end-to-end test waits for a change to show up on another screen.
 * Everything in an e2e run shares one machine, so the tests assert that a change
 * *does* arrive within this generous window and report the measured latency
 * against LIVE_UPDATE_LATENCY_BUDGET_MS instead of failing on it.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/**
 * How long a test waits for a board to come back after a connection was cut. The client
 * does not dial again at once: it waits, doubling up to RECONNECT_MAX_BACKOFF_MS, and that
 * wait belongs to the product rather than to the change under test, so a patient reconnect
 * policy does not read as a broken board.
 */
export const RECONNECT_WAIT_MS = 45_000;

/**
 * How long a peer's presence is remembered after the last word about it. This story relays
 * awareness and shows none of it — who is here is story 6 — so the room forwards awareness
 * exactly as it arrives and nothing counts these milliseconds; the setting is here because
 * the room is where a timeout would live when there is something to time out.
 */
export const AWARENESS_TIMEOUT_MS = 30_000;

/**
 * Random bytes in a new board id: 128 bits, which is what makes an address unguessable
 * while the address is the whole of a board's access control.
 */
export const BOARD_ID_BYTES = 16;

// ————— persistence (story 4)

/** Log updates folded into a snapshot at this count (the design allows 300–1000). */
export const COMPACTION_UPDATE_COUNT = 500;

/** Log updates folded into a snapshot once they weigh this much. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** A snapshot is stored in pieces of this size, so no single row gets big. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/**
 * Shortest wait between two tries at a board that failed to load. A board that cannot be
 * read is not re-read once a second for ten minutes: the promise is "retrying", and this is
 * how often the retry is real.
 */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the board is proven to come back at, in notes. */
export const PERSIST_TESTED_NOTES = 2000;

/** What coming back for a board of that size is aimed at, in ms; tests log the real figure. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** The schema `BoardStore.migrate()` brings a board's storage to. */
export const STORAGE_SCHEMA_VERSION = 1;

// ——————————————— sharing a board by link (story 5)

/**
 * How long creating a board may take, from the click on New board to the empty board
 * on screen (share.create). It is a budget for the whole round trip, so the number
 * that matters is the one a person waits for: one id, one write, one page.
 */
export const CREATE_BUDGET_MS = 2000;

/** How long "Link copied" stays on the Copy link button. */
export const LINK_COPIED_MS = 2000;

/**
 * How long the board page waits before its first retry at a board it could not check.
 * Doubles from here up to RECONNECT_MAX_BACKOFF_MS, which is the wait the connection
 * already uses for the same kind of patience.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ——————————————— undoing my own changes (story 8)

/**
 * The pause in typing that ends an undo step (undo.typing).
 *
 * Typing that goes on without a pause of at least this long is one thing to undo — a word, a phrase,
 * however much was typed in that breath. It is also the window that merges the frames of one drag into
 * one step: a drag writes once per animation frame, which is far inside this pause, while two separate
 * actions are a second or more apart. Where an action must not be merged with its neighbour even though
 * it was quick — the click of a colour swatch 200 ms after a drag let go — the code calls the undo
 * controller's `boundary()` instead of trusting the clock.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of this person's own steps one board remembers (undo.limit).
 *
 * Generous on purpose: the point of the history is that experimenting is safe, and a history that runs
 * out after twenty presses is not safe, it is a countdown. It is also the only bound there is — nothing
 * is stored, so the history is as long as this number and as short as the tab being open (see
 * undo.session_only).
 */
export const UNDO_MAX_STEPS = 200;
