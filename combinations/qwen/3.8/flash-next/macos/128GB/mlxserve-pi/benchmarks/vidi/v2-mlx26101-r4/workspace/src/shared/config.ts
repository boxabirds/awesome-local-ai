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
