/**
 * Product settings for vidi6. Every tunable number in the app lives here.
 * Stories 2-5 add their own settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step: the zoom multiplier used by the + / - buttons and keys. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the starting point panning is verified to still work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------------ * *
 * Story 2: sticky notes                                                *
 * ------------------------------------------------------------------ */

/** Width and height of a new sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on characters kept in a single note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest auto-fit font size (board units, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest auto-fit font size; below this text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Screen pixels a pointer must move after pointerdown to start a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Inner padding of a sticky note, in world units (text never touches edges). */
export const STICKY_PADDING_WORLD = 16;

/** The six sticky-note colours. Keys are the stored names. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* ------------------------------------------------------------------ * *
 * Story 3: live collaboration                                           *
 * ------------------------------------------------------------------ */

/**
 * Simultaneous-editor capacity: the number of people per board the product is
 * designed and tested for. Soft — never enforced; a 6th person joins and edits
 * normally, the 1-second delivery guarantee simply stops being promised.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Time from a change appearing on the sender's screen to it appearing on every
 * other connected screen (PRD live.propagate).
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the reconnect backoff (passed to WebsocketProvider). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used to verify offline edits catch up (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait in e2e tests (all stories): every change is given this long to
 * arrive. Wall-clock latency is logged against LIVE_UPDATE_LATENCY_BUDGET_MS,
 * never asserted, because the model, browsers and server share one machine.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ * *
 * Story 4: persistence                                                  *
 * ------------------------------------------------------------------ */

/** Compact the update log when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** …or when the log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot chunk. Keeps every row well under the per-row size limit
 * of SQLite-backed Durable Objects (re-checked against Cloudflare's documented
 * limits during implementation: 512 KiB is below every limit published there).
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** A board that failed to load is retried at most this often (per connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** The board size the PRD tests opening against (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;

/** Time in which a saved board of PERSIST_TESTED_NOTES notes must be on screen. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version of the storage tables (not of the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------ * *
 * Story 5: sharing a board by link                                      *
 * ------------------------------------------------------------------ */

/**
 * Click to board: how long creating a board may take from the click on
 * "New board" to the empty board being on screen (PRD share.create).
 */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel's button says "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;

/**
 * First wait before asking again whether a board exists, when the service could
 * not be reached (PRD share.unreachable). Doubles up to RECONNECT_MAX_BACKOFF_MS.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* ------------------------------------------------------------------ * *
 * Story 7: selecting, moving and resizing objects                       *
 * ------------------------------------------------------------------ */

/** Side of a resize handle's square, in screen pixels at any zoom level. */
export const HANDLE_SIZE_PX = 8;

/** Smallest a sticky note may be resized to, in board units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any object may be resized to, in board units (every object type). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** How far one arrow key moves the selection, in board units. */
export const NUDGE_STEP_WORLD = 1;

/** How far Shift + arrow key moves the selection, in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* ------------------------------------------------------------------ * *
 * Story 8: undo and redo of my own changes                             *
 * ------------------------------------------------------------------ */

/**
 * A pause in typing of this long ends a typing burst, so the next keystroke
 * starts a new undo step (PRD undo.typing). Consecutive typing with a shorter
 * pause is merged into one step.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many of this person's own steps one undo history keeps. Adding a new step
 * beyond this discards the oldest one (PRD undo.limit).
 */
export const UNDO_MAX_STEPS = 200;

/* ------------------------------------------------------------------ * *
 * Story 9: free text anywhere on the board                              *
 * ------------------------------------------------------------------ */

/**
 * How wide a text object with no fixed width may get (PRD text.auto_width):
 * the box is as wide as its longest line, up to this, and longer lines wrap.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a fixed text width can be set to (PRD text.fixed_width). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Hard limit on characters kept in a single text object (PRD text.limit). */
export const TEXT_MAX_CHARS = 5000;

/** The four text sizes, in board units, as stored preset keys (PRD text.size). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size of freshly created text. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line spacing of text objects, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;

/** The board's standard sans-serif, used by every text object. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Slack added to an automatic width, so a line measured exactly as wide as its
 * box still has room to be drawn on one line (sub-pixel differences between the
 * measurer and the layout engine would otherwise wrap it). Capped away when the
 * width is TEXT_MAX_AUTO_WIDTH_WORLD itself, which stays exactly 600.
 */
export const TEXT_AUTO_WIDTH_PAD_WORLD = 2;

/**
 * Average glyph width used to estimate text width where there is no canvas to
 * measure with (a worker, jsdom). A ratio of the font size, so the estimate
 * scales with the size preset.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.52;
