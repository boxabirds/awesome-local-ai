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
