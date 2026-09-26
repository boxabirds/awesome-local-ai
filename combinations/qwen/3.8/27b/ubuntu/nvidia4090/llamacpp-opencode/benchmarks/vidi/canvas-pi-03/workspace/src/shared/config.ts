export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration (sync) settings ---

/** Soft simultaneous-editor capacity: design and test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** Max allowed time for a change to appear on every other screen (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage duration used by the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// --- Story 4: board persistence settings ---

/** Compact the update log once it reaches this many rows. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or once the log reaches this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot size limit per storage row (kept well below the platform's per-row limit). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries loading at most this often (per new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Number of notes in the tested large board (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** A board of PERSIST_TESTED_NOTES notes must be fully rendered within this (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the persisted storage layout (tables in the board's SQLite database). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: share a board with others using a link ---

/** Max boards one visitor may create per BOARD_CREATE_PERIOD_SECONDS window (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;
/** Rate-limit window in seconds. MUST match the wrangler.jsonc `ratelimits` binding. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;
/** Max id-generation + initialize attempts before board creation gives up (500 create_failed). */
export const CREATE_ID_MAX_ATTEMPTS = 3;
/** Max time from clicking "Create a board" until the new board opens (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long the "Link copied" confirmation shows in the Share panel (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** First backoff between BoardPage existence-check retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: select, move, resize and delete several objects at once ---

/** Screen size (square, in CSS px, independent of zoom) of a selection resize handle. */
export const HANDLE_SIZE_PX = 8;
/** Minimum side of a sticky note in world units (sel.size_limits). */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum side of any board object in world units (sel.size_limits). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step in world units (sel.nudge). */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step in world units (sel.nudge). */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Story 8: undo and redo my own changes without undoing anyone else's ---

/** Typing pause that ends a burst (undo.typing); consecutive typing without a
 *  pause of this length merges into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Number of own changes kept in the per-tab undo history (undo.limit). */
export const UNDO_MAX_STEPS = 200;

// --- Story 9: plain free text objects (text.*) ---

/** Font size in world units per text size key (text.sizes). */
export const TEXT_SIZES = {
  S: 14,
  M: 20,
  L: 32,
  XL: 56,
} as const;
/** Text size preset key (text.sizes). */
export type TextSize = keyof typeof TEXT_SIZES;
/** Font family used by text objects and by the width measurer. */
export const TEXT_FONT_FAMILY =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** Line height multiplier for text objects (layout.height). */
export const TEXT_LINE_HEIGHT = 1.3;
/** Hard limit for one text object (text.limit); extra characters are not added. */
export const TEXT_MAX_CHARS = 5000;
/** Default size of a newly created text object (text.create). */
export const DEFAULT_TEXT_SIZE = 'M';
/** Auto width grows with the longest line but never above this (text.wrap). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/**
 * Fallback width estimate (no canvas available, e.g. node/jsdom):
 * width ≈ characters * fontPx * ratio. In the browser the canvas measurer is
 * used instead (layout.width).
 */
export const TEXT_GLYPH_WIDTH_RATIO = 0.6;
/** Text boxes (auto and fixed) are never narrower than this (text.resize). */
export const TEXT_MIN_WIDTH_WORLD = 40;
