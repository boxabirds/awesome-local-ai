// Named product settings for vidi6. Stories 2-5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative zoom step for buttons and keyboard shortcuts (1.25). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a Ctrl/Cmd wheel = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) from the start that pan is tested to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" delta (WheelEvent.deltaMode === 1). */
export const WHEEL_LINE_DELTA_PX = 16;
/** Pixels per wheel "page" delta (WheelEvent.deltaMode === 2). */
export const WHEEL_PAGE_DELTA_PX = 100;

// --- Story 2: Sticky notes ---

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter shows when remaining chars <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;
/** Minimum pointer movement (screen px) before a drag starts. */
export const DRAG_THRESHOLD_PX = 3;
/** The six available sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Default colour for new sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: Live collaboration ---

/** Soft capacity: design + test target for simultaneous editors; never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** 1-second budget for live change delivery (PRD live.propagate). Logged, not asserted, in e2e. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Maximum reconnection backoff, passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify offline catch-up (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional (eventual) wait timeout for e2e tests; latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Story 4: Persistence ---

/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the storage tables. */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: Share a board ---

/** 2-second budget for board creation (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long "Link copied" stays visible (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** Base backoff for board existence check retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: Multi-select, group move/resize/delete ---
/** Screen-space size of a resize handle in pixels. */
export const HANDLE_SIZE_PX = 8;
/** Minimum width/height (world units) any object can be resized to. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum width/height (world units) any object can be resized to. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Single arrow-key nudge in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;
