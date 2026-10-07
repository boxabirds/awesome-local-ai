export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
export const SNAP_EPSILON = 1e-9;
export const DEFAULT_ORIGIN_MARKER_SIZE = 16;

// Sticky note settings (story 2)
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

// Story 3 — live collaboration settings
export const MAX_CONCURRENT_EDITORS = 5;
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
export const CONNECTED_CONFIRMATION_MS = 2000;
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// Story 4 — persistence settings
export const COMPACTION_UPDATE_COUNT = 500;         // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024;    // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;     // keeps every row well under per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;     // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000;           // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000;           // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;
