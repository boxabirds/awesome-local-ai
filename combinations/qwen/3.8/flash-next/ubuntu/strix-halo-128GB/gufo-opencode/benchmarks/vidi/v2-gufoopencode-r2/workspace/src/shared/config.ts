// All named product settings live here. Stories 2-5 add to this file.

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
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

// Story 3: live collaboration.
export const MAX_CONCURRENT_EDITORS = 5; // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000; // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000; // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000; // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000; // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000; // functional wait in e2e; latency is logged, not asserted

// Story 4: persistence.
export const COMPACTION_UPDATE_COUNT = 500; // log rows that trigger a snapshot compaction
export const COMPACTION_BYTES = 4 * 1024 * 1024; // log bytes that trigger a snapshot compaction
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024; // max bytes per snapshot_chunks row
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000; // minimum time between board load attempts
export const PERSIST_TESTED_NOTES = 2000; // note count proven to survive a restart
export const BOARD_LOAD_BUDGET_MS = 3_000; // budget for reload + full render after restart
export const STORAGE_SCHEMA_VERSION = 1; // versions the board's SQLite tables

// Story 5: sharing boards by link.
export const CREATE_BUDGET_MS = 2_000; // PRD share.create (reported, not asserted, in e2e)
export const LINK_COPIED_MS = 2_000; // "Link copied" confirmation duration
export const BOARD_CHECK_RETRY_BASE_MS = 1_000; // link-check retry; doubles up to RECONNECT_MAX_BACKOFF_MS

// Story 7: multi-select, move, resize, delete.
export const HANDLE_SIZE_PX = 8; // bounding-box handle size in screen pixels
export const STICKY_MIN_SIZE_WORLD = 50; // registry minSize for sticky notes
export const MAX_OBJECT_SIZE_WORLD = 20_000; // one global maximum for every type
export const NUDGE_STEP_WORLD = 1; // arrow-key nudge distance
export const NUDGE_LARGE_STEP_WORLD = 10; // Shift+arrow nudge distance
