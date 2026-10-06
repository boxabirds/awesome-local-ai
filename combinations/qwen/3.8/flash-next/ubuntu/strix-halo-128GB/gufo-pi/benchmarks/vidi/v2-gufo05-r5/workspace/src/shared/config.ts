/**
 * vidi6 product settings.
 *
 * Every tunable number in the client lives here (stories 2-5 keep adding to this
 * file) so the product can be re-tuned in one place without a redesign.
 */

// ---- Zoom ------------------------------------------------------------------

/** The standard view's zoom, used by Reset view, in screen pixels per world unit. */
export const ZOOM_DEFAULT = 1;

/** Smallest zoom the user can reach, in screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the user can reach, in screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplier applied by one zoom step (one click of the + button). */
export const ZOOM_STEP_FACTOR = 1.25;

/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) for a Ctrl/Cmd wheel or pinch. */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/**
 * Zoom values are conceptually ZOOM_STEP_FACTOR^n. Repeated multiplication by the
 * step factor (and its inverse) accumulates floating point drift, so a computed
 * zoom is snapped to the nearest step value when it is this close (relative).
 */
export const ZOOM_STEP_SNAP_TOLERANCE = 1e-9;

/** Multiplier used to display a zoom level as a percentage. */
export const PERCENT = 100;

// ---- Wheel delta modes -----------------------------------------------------

/** Pixels for one line of wheel delta (`WheelEvent.DOM_DELTA_LINE`). */
export const WHEEL_LINE_MODE_PIXELS = 16;

/** Pixels for one page of wheel delta (`WheelEvent.DOM_DELTA_PAGE`). */
export const WHEEL_PAGE_MODE_PIXELS = 800;

// ---- Grid ------------------------------------------------------------------

/** Distance between dot grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** Size of a grid dot in screen pixels (it does not grow with zoom). */
export const GRID_DOT_SIZE_SCREEN = 2;

/** How far from the start the board is guaranteed to pan without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ---- Sticky notes ----------------------------------------------------------

/** Width and height of a sticky note in world units (a square, like paper). */
export const STICKY_SIZE_WORLD = 200;

/** Longest note text; characters beyond this are never stored. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) are left. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size in world units, used when the text is short. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size in world units; below it the text is clipped instead. */
export const STICKY_FONT_MIN_PX = 10;

/** Padding between the note edge and its text in world units. */
export const STICKY_PADDING_WORLD = 16;

/** Pointer movement that turns a press on a note into a drag (screen pixels). */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours the user can choose from; the key is the stored name. */
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

// ---- Live collaboration (story 3) ------------------------------------------

/**
 * Simultaneous-editor capacity of one board. A soft target: it is never enforced, the
 * 6th person is accepted like anyone else. Tests read this instead of a literal.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * How long a change may take to appear on every other connected screen (PRD
 * live.propagate). Reported in the e2e latency log, never asserted there: model,
 * browsers and server share one machine, so wall-clock timing is not a pass/fail signal.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Largest gap between two reconnection attempts, handed to the WebSocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/**
 * How often a tab re-syncs with its room. A board nobody is editing must not look like a dead
 * connection, so every tab asks the room for anything it is missing regularly; the room answers
 * every request, which is also what lets a tab tell a live room from a silent one (see
 * `CONNECTION_IDLE_TIMEOUT_MS`).
 */
export const RESYNC_INTERVAL_MS = 5000;
/**
 * How long a socket may carry nothing before the tab calls the connection lost. A browser whose
 * network has vanished does not notice by itself - the socket simply stops carrying frames - and
 * the provider's own silence timeout is 30 s and not configurable, so the tab watches the wire
 * and closes the socket itself. That is what makes "Reconnecting…" appear within seconds of an
 * outage instead of after half a minute.
 */
export const CONNECTION_IDLE_TIMEOUT_MS = 8000;

/** Outage length used by the offline catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional waiting budget in the e2e suites of every story: a change must *appear*
 * within this time; how long it actually took is logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS instead of asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// ---- Persistence (story 4) --------------------------------------------------

/**
 * How many update rows a board's log may hold before the room folds it into a fresh
 * snapshot. This is what bounds the work a board has to do when it wakes up: at most one
 * snapshot plus fewer than this many log rows, however long the board has been lived in.
 */
export const COMPACTION_UPDATE_COUNT = 500;

/** Or when the log's bytes reach this, whichever comes first. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Rows are kept small on purpose: SQLite-backed Durable Objects
 * have a per-row size limit (Cloudflare's limits page puts it in the megabytes), and a
 * long-lived board must never grow a row past it. A fifth of a megabyte is far below every
 * number documented while this story was written, and a snapshot is read by concatenating
 * its rows, so chunking costs one extra row per half megabyte.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/**
 * A board whose storage could not be read keeps trying, but no more often than this: a
 * broken board that everybody has open must not hammer the database.
 */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The largest board this product is tested with (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;

/**
 * How long a saved board of `PERSIST_TESTED_NOTES` notes may take to appear (PRD
 * persist.large_board). The e2e suite measures and reports it rather than asserting it:
 * model, browsers and server share one machine.
 */
export const BOARD_LOAD_BUDGET_MS = 3000;

/**
 * The version of the *storage tables* (not of the board document, which has its own
 * `meta.schemaVersion`). Written once into `storage_meta`; a future story that changes the
 * tables bumps it and migrates.
 */
export const STORAGE_SCHEMA_VERSION = 1;

// ---- Share (story 5) -------------------------------------------------------

/**
 * How long board creation may take from click to board visible (PRD share.create).
 * Logged in e2e against real timing, never asserted (shared machine).
 */
export const CREATE_BUDGET_MS = 2000;

/** How long "Link copied" is shown after a successful clipboard write. */
export const LINK_COPIED_MS = 2000;

/**
 * First backoff interval when checking board existence fails due to an unreachable service.
 * Doubles up to RECONNECT_MAX_BACKOFF_MS.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;
