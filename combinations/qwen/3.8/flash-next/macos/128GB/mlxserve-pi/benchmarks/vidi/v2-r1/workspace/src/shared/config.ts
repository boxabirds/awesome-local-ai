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
