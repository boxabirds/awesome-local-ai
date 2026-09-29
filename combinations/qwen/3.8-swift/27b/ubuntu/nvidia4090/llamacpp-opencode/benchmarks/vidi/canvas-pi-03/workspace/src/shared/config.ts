export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Story 2: sticky notes
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
// Story 3: live collaboration
export const MAX_CONCURRENT_EDITORS = 5; // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000; // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000; // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000; // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000; // PRD live.catch_up verification outage
// Story 4: board persistence
export const COMPACTION_UPDATE_COUNT = 500;          // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024;     // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;      // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;      // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000;            // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000;            // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;
// Story 7: multi-selection, group move/resize, nudge, delete
export const HANDLE_SIZE_PX = 8; // resize handles stay this size on screen at any zoom
export const STICKY_MIN_SIZE_WORLD = 50; // sticky notes cannot be resized below this
export const MAX_OBJECT_SIZE_WORLD = 20_000; // no object may be resized above this
export const NUDGE_STEP_WORLD = 1; // arrow-key nudge step
export const NUDGE_LARGE_STEP_WORLD = 10; // Shift+arrow nudge step
// Story 8: per-user undo/redo
export const UNDO_CAPTURE_TIMEOUT_MS = 500; // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;          // per-user history length
// Story 9: free text objects
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600; // auto-width text wraps beyond this
export const TEXT_MIN_WIDTH_WORLD = 40; // side-handle fixed width floor
export const TEXT_MAX_CHARS = 5000; // per-text-object length limit
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const; // font size presets (board units)
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3; // line height multiplier
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.6; // estimate fallback: avg glyph width in ems
// Story 5: share a board with others using a link
export const BOARD_CREATE_LIMIT = 10;              // per visitor, per period (PRD share.rate_limit)
export const BOARD_CREATE_PERIOD_SECONDS = 60;     // must match wrangler.jsonc ratelimits (TC-03 asserts equality)
export const CREATE_ID_MAX_ATTEMPTS = 3;           // collision retries when a generated id is already taken
export const CREATE_BUDGET_MS = 2000;              // PRD share.create: board opens within 2 s
export const LINK_COPIED_MS = 2000;                // PRD share.copy: "Link copied" duration
export const BOARD_CHECK_RETRY_BASE_MS = 1000;     // backoff doubles up to RECONNECT_MAX_BACKOFF_MS (story 3)

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
