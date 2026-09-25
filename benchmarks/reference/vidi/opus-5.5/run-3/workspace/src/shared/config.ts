// All named product settings live here. Later stories add to this file.

/** Minimum board zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + =/−). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Radius of a grid dot in screen pixels. */
export const GRID_DOT_RADIUS_PX = 1;
/** Below this on-screen spacing (px) the grid dots fade out proportionally, so a dense grid does not turn into a grey wash. */
export const GRID_FADE_BELOW_SPACING_PX = 12;

// Story 2 — sticky notes.

/** Side length of a (square) sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters (UTF-16 code units) in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when the remaining characters are <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size in world units (= px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; text that still does not fit is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Inner padding between the note edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 16;
/** Line height of note text, as a multiple of the font size. */
export const STICKY_LINE_HEIGHT = 1.25;
/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// Story 3 — live collaboration.

/** Soft capacity: the number of simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other connected screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Length of the network outage in the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// Story 4 — persistence.

/** Compact the update log into a snapshot when this many log rows exist... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or when the log's total size reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Size of one snapshot row; keeps every row well under the platform per-row size limit (2 MB). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose board failed to load retries the load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size a saved board is tested to open with (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** A saved board of PERSIST_TESTED_NOTES notes shows all its notes within this time (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (not of the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

// Story 5 — sharing a board by link.

/** Boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window; must match `ratelimits` in wrangler.jsonc (a unit test asserts equality). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** Fresh ids tried when a generated id is already taken, before creation fails. */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Create a board: the new board is open within this time of the click (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long the Copy link button shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// Story 7 — selecting, moving, resizing and deleting several objects at once.

/** Side of a selection resize handle in screen pixels (the same at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest side a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest side any object can be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// Story 8 — personal undo and redo.

/** Typing pause that ends a burst: local changes closer together than this merge into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Undo steps kept per person (per tab); the oldest is dropped when a new one is added. */
export const UNDO_MAX_STEPS = 200;

// Story 9 — free text.

/** Auto-width text grows with its longest line up to this width (world units), then wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest fixed width a text object can be given with a side handle, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters (UTF-16 code units) in one text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in world units. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height of text objects, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif font, used for text objects and their measurement. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Slack added to an auto-width box beyond its measured longest line (room for the caret and rounding), capped
 *  at TEXT_MAX_AUTO_WIDTH_WORLD. */
export const TEXT_PADDING_WORLD = 4;
/** Without a canvas to measure with, a glyph is estimated at this fraction of the font size. */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.55;
