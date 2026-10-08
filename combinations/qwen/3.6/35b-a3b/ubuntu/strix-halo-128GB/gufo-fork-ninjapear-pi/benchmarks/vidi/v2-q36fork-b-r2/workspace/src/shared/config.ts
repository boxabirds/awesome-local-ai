// Zoom settings
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Grid settings
export const GRID_SPACING_WORLD = 24;

// Test extent
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Snap epsilon for step zoom to avoid float drift
export const SNAP_EPSILON = 1e-9;

// Wheel delta mode conversion (pixels per line/page)
export const LINE_TO_PIXELS = 20;
export const PAGE_TO_PIXELS = 400;

// Navigation hint text
export const NAV_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';

// Live collaboration settings (story 3)
export const MAX_CONCURRENT_EDITORS = 5;              // soft capacity target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;    // PRD live.propagate budget
export const RECONNECT_MAX_BACKOFF_MS = 10_000;       // WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000;        // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;        // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;        // functional wait in e2e across stories

// Handle and selection settings
export const HANDLE_SIZE_PX = 8;
export const STICKY_MIN_SIZE_WORLD = 50;
export const MAX_OBJECT_SIZE_WORLD = 20_000;
export const NUDGE_STEP_WORLD = 1;
export const NUDGE_LARGE_STEP_WORLD = 10;

// Sticky note settings
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

// Board sharing settings (story 5)
export const CREATE_BUDGET_MS = 2000;             // PRD share.create
export const LINK_COPIED_MS = 2000;
export const BOARD_CHECK_RETRY_BASE_MS = 1000;    // backoff doubles up to RECONNECT_MAX_BACKOFF_MS

// Persistence settings (story 4)
export const COMPACTION_UPDATE_COUNT = 500;
export const COMPACTION_BYTES = 4 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
export const PERSIST_TESTED_NOTES = 2000;
export const BOARD_LOAD_BUDGET_MS = 3000;
export const STORAGE_SCHEMA_VERSION = 1;
