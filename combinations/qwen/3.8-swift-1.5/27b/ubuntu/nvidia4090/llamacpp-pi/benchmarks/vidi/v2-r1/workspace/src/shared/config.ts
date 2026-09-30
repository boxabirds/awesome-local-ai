export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

export const MAX_CONCURRENT_EDITORS = 5;
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
export const CONNECTED_CONFIRMATION_MS = 2000;
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

export const COMPACTION_UPDATE_COUNT = 500;
export const COMPACTION_BYTES = 4 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
export const PERSIST_TESTED_NOTES = 2000;
export const BOARD_LOAD_BUDGET_MS = 3000;
export const STORAGE_SCHEMA_VERSION = 1;

// Story 5: share a board with others using a link
export const CREATE_BUDGET_MS = 2000;              // PRD share.create
export const LINK_COPIED_MS = 2000;
export const BOARD_CHECK_RETRY_BASE_MS = 1000;     // backoff doubles up to RECONNECT_MAX_BACKOFF_MS

// Story 7: select, move, resize and delete several objects at once
export const HANDLE_SIZE_PX = 8;
export const STICKY_MIN_SIZE_WORLD = 50;
export const MAX_OBJECT_SIZE_WORLD = 20_000;
export const NUDGE_STEP_WORLD = 1;
export const NUDGE_LARGE_STEP_WORLD = 10;

// Story 8: Undo and redo my own changes without undoing anyone else's
export const UNDO_CAPTURE_TIMEOUT_MS = 500;   // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;
