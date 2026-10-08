// Story 1 — Navigation
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
export const ZOOM_SNAP_EPSILON = 1e-9;
export const LINE_DELTA = 32;   // approx. px per line-scroll
export const PAGE_DELTA = 512;  // approx. px per page-scroll

// Story 2 — Sticky notes
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

// Story 3 — Live collaboration
export const MAX_CONCURRENT_EDITORS = 5;            // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;   // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000;      // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000;       // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;       // PRD live.catch_up verification outage
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;       // functional wait in e2e (all stories)

// Story 4 — Board persistence
export const COMPACTION_UPDATE_COUNT = 500;
export const COMPACTION_BYTES = 4 * 1024 * 1024;
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
export const PERSIST_TESTED_NOTES = 2000;
export const BOARD_LOAD_BUDGET_MS = 3000;
export const STORAGE_SCHEMA_VERSION = 1;
// Symbol used as origin marker for updates applied during server-side load.
export const LOAD_ORIGIN: unique symbol = Symbol('load-origin');

