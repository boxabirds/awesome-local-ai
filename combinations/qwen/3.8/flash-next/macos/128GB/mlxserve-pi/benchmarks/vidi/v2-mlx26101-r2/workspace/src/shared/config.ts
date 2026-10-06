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
