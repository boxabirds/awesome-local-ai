// Named product settings for vidi6. Stories add to this file; values here are
// product decisions, not tuning constants — changing them changes behaviour.

// --- Story 1: canvas navigation ---
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 2: sticky notes ---
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
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

// --- Story 3: live collaboration ---
export const MAX_CONCURRENT_EDITORS = 5; // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000; // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000; // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000; // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000; // PRD live.catch_up verification outage

// --- Story 4: persistence ---
export const COMPACTION_UPDATE_COUNT = 500; // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024; // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024; // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000; // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000; // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000; // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: sharing boards with links ---
export const BOARD_CREATE_LIMIT = 10; // per visitor
export const BOARD_CREATE_PERIOD_SECONDS = 60; // must match wrangler.jsonc ratelimits (test TC-03 asserts equality)
export const CREATE_ID_MAX_ATTEMPTS = 3;
export const CREATE_BUDGET_MS = 2000; // PRD share.create
export const LINK_COPIED_MS = 2000;
export const BOARD_CHECK_RETRY_BASE_MS = 1000; // backoff doubles up to RECONNECT_MAX_BACKOFF_MS (story 3)
