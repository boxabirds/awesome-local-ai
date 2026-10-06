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
