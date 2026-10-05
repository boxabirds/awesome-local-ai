/**
 * vidi6 product settings.
 *
 * These are the single place to change tuning values without a redesign.
 * Stories 2-5 will add further settings to this file.
 */

/** Minimum zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied by one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel / pinch zoom sensitivity.
 * zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Extent (in world units from the starting point) that must remain
 * navigable without reaching an edge or visible grid distortion.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Convert a zoom factor to a whole-number percentage. */
export const PERCENT = 100;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note side length in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest sticky font size, in board units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest sticky font size, in board units (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;

/** Height of the fade band over clipped text, in board units. */
export const STICKY_OVERFLOW_BAND_PX = 36;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky colours, in toolbar order. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration -------------------------------------------

/**
 * Simultaneous-editors capacity. A soft target: it drives the design and the
 * tests, and is never enforced — the 6th person is never turned away.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Time budget for a change to appear on another person's screen once it is
 * visible on the sender's screen (PRD `live.propagate`). e2e reports the
 * measured value against this budget; it is not a pass/fail gate.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the reconnect backoff, passed to `WebsocketProvider`. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" confirmation badge shows after a reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used to verify that offline edits catch up (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Generous functional wait used by every e2e story: tests wait up to this long
 * for an outcome to appear and log the measured latency against
 * {@link LIVE_UPDATE_LATENCY_BUDGET_MS} instead of asserting on it.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Story 4: persistence ---------------------------------------------------

/** Compact the update log once this many rows have piled up in front of it. */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or once this many bytes of updates have piled up (whichever comes first). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Keeps every row far below the per-row size limit of
 * SQLite-backed Durable Objects (2 MB today; re-check the Cloudflare
 * documentation when changing it), so a board of any tested size fits.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A room whose board failed to load retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the persistence story is tested at (PRD `persist.large_board`). */
export const PERSIST_TESTED_NOTES = 2000;

/**
 * Time budget for showing every note of a {@link PERSIST_TESTED_NOTES} board
 * (PRD `persist.large_board`). e2e reports the measured value against it; it is
 * not a pass/fail gate, because model, browsers and server share one machine.
 */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the *storage* tables (the Yjs document schema has its own). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: sharing a board ----------------------------------------------

/**
 * Time budget from clicking "New board" to the empty board being visible
 * (PRD `share.create`). e2e logs the measured click-to-board time against it;
 * it is not a pass/fail gate, because model, browsers and server share one
 * machine.
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's "Link copied" confirmation shows (PRD `share.copy`). */
export const LINK_COPIED_MS = 2000;

/**
 * First retry interval when the board-existence check cannot reach the service
 * (PRD `share.unreachable`). The backoff doubles on each further failure, up to
 * {@link RECONNECT_MAX_BACKOFF_MS}.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: selecting, moving, resizing and deleting objects -------------

/** Size of a resize handle's square, in *screen* pixels at every zoom level. */
export const HANDLE_SIZE_PX = 8;

/** Smallest side a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any board object may be resized to, in world units (every type). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Distance one arrow key press moves the selection, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Distance one Shift+arrow press moves the selection, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Story 8: undo and redo -------------------------------------------------

/**
 * Typing pause (ms) that ends an undo step: keystrokes closer together than
 * this belong to one burst and are undone together (PRD `undo.typing`).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** How many undo steps one person's history keeps before the oldest is dropped. */
export const UNDO_MAX_STEPS = 200;

// --- Story 9: free text -----------------------------------------------------

/** Maximum automatic width of a text object, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum fixed width of a text object, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum number of characters kept in a text object. */
export const TEXT_MAX_CHARS = 5000;

/** Size presets (font size in board units) keyed by name. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a newly created text object receives. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height multiplier applied to each text size. */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
