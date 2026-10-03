/**
 * vidi6 product settings.
 *
 * Every tunable that the product owns lives here so it can be changed in one
 * place without a redesign (story 1 PRD, "Settings"). Stories 2-5 add to this
 * file.
 */

/** Smallest allowed zoom (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** The board must stay usable at least this far from the starting point. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;

/* Sticky notes (story 2) ---------------------------------------------------- */

/** A sticky note is a square of this many world units. */
export const STICKY_SIZE_WORLD = 200;

/** Longest note text; characters beyond this are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in world units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) that turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, in toolbar order. */
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

/* Live collaboration (story 3) ----------------------------------------------*/

/**
 * How many people a board is designed and tested for, editing at the same
 * time. A soft target: nothing refuses or slows down a 6th person, the number
 * only drives the design and the tests.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * How long a change may take to appear on every other connected screen
 * (measured from when it shows on the sender's screen). E2E tests report the
 * measurement against this budget rather than failing on it, because the model,
 * the browsers and the server share one machine.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Longest wait between reconnection attempts (the provider's backoff cap). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** The interruption length the catch-up test uses (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * How long an end-to-end test waits for a functional outcome (a change to
 * appear, states to converge). Used by every story; latency is logged against
 * `LIVE_UPDATE_LATENCY_BUDGET_MS`, never asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/**
 * Nightly stability run: how long a board is left completely idle before the run
 * checks it is still connected and still live (prd §Testing, workflow 1 stability).
 */
export const NIGHTLY_STABILITY_MINUTES = 45;

/** Nightly capacity soak: how long the run lasts at `MAX_CONCURRENT_EDITORS`. */
export const NIGHTLY_CAPACITY_MINUTES = 60;

/** Nightly capacity soak: a person drops and re-joins on this clock… */
export const NIGHTLY_REJOIN_EVERY_MINUTES = 1;

/** …for this long at the start of the run, then the run just keeps editing. */
export const NIGHTLY_REJOIN_WINDOW_MINUTES = 10;

/**
 * How much `NIGHTLY_SHORT=1` compresses the nightly durations, so the nightly
 * tests can be checked in seconds. The nightly job itself does not set it.
 */
export const NIGHTLY_SHORT_SCALE = 60;

/* Persistence (story 4) ------------------------------------------------------*/

/** Compact the update log when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or when the update log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Keeps every row well under the per-row size limit of
 * SQLite-backed Durable Objects, which is far larger than this in every figure
 * Cloudflare has published (see NOTES.md).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A room in `load-failed` retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/* Sharing (story 5) ----------------------------------------------------------*/

/**
 * How long creating a board may take, from the click on New board to the empty board
 * on screen (prd `share.create`). E2E reports the measurement against it rather than
 * failing on it, as with every other wall-clock budget here.
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's "Link copied" confirmation stays up. */
export const LINK_COPIED_MS = 2000;

/**
 * The first wait before re-checking whether a board exists; each failed check doubles
 * it, up to `RECONNECT_MAX_BACKOFF_MS`, which is the cap the WebSocket connection
 * already uses for the same kind of "the service is not answering" wait.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/** The board size the PRD tests (prd §Large boards open quickly). */
export const PERSIST_TESTED_NOTES = 2000;

/** How long opening a board of `PERSIST_TESTED_NOTES` notes may take (reported, not asserted). */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** The version of the room's SQLite tables, kept in `storage_meta`. */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * How long one update may take to reach storage before the room says so in the log
 * (`storage-write-slow`). The design calls it "the budget a live update is meant to
 * fit inside", which is the same storage seen from the other side: writing one change
 * should cost a fraction of opening a whole board, so it is a quarter of
 * `BOARD_LOAD_BUDGET_MS`. Reported, not enforced: a write that has landed is not
 * thrown away, and the room cannot stop a write that has already begun.
 */
export const STORAGE_WRITE_BUDGET_MS = BOARD_LOAD_BUDGET_MS / 4;
