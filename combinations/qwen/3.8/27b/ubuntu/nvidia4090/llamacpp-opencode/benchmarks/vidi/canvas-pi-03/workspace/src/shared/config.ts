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
