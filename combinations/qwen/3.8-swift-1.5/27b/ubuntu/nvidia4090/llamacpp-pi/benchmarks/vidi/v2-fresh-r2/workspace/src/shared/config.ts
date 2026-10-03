/**
 * Named product settings. Change a value here, not in feature code.
 * Stories 2+ add to this file.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom button/key step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Furthest distance in world units from the starting point that the board is
 * tested to pan without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom of the standard ("reset") view. */
export const ZOOM_RESET = 1;
/** Percent factor for the zoom label. */
export const PERCENT = 100;
/** Tolerance for snapping a stepped zoom to the exact value ZOOM_STEP_FACTOR^n. */
export const STEP_SNAP_EPSILON = 1e-9;
/** Pixels per wheel delta when deltaMode is LINE. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel delta when deltaMode is PAGE. */
export const WHEEL_PAGE_PX = 100;

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * Story 3: live collaboration settings.
 */
/**
 * Simultaneous-editor capacity (soft). Design and test target only — never
 * enforced; a 6th or later participant is never refused.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** 1 second change-delivery budget (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Available sticky note colours. */
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

/**
 * Story 4: persistence settings.
 */
/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Keeps every snapshot chunk row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Storage schema version. */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * Story 7: multi-selection, group move/resize, nudge.
 */
/** Screen-space size of a bounding-box resize handle (px at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Minimum size in board units for a sticky note (resize lower bound). */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum size in board units for any object type (resize upper bound). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step in board units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/**
 * Story 5: share a board with others using a link.
 */
/** PRD share.create: click-to-board budget (logged in e2e, not asserted). */
export const CREATE_BUDGET_MS = 2000;
/** Share panel: how long "Link copied" stays visible after a successful copy. */
export const LINK_COPIED_MS = 2000;
/** BoardPage existence check: base retry interval; doubles per attempt, capped at RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/**
 * Story 8: undo and redo settings.
 */
/** Typing pause (ms) that ends a burst into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Maximum number of undo steps per user. */
export const UNDO_MAX_STEPS = 200;
