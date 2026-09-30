// Product settings shared across the app. Stories 2-5 add to this file.

// Share / board-link settings (story 5).
export const CREATE_BUDGET_MS = 2000;              // PRD share.create (click to board visible)
export const LINK_COPIED_MS = 2000;               // "Link copied" confirmation duration
export const BOARD_CHECK_RETRY_BASE_MS = 1000;    // backoff doubles up to RECONNECT_MAX_BACKOFF_MS

// Persistence settings (story 4).
export const COMPACTION_UPDATE_COUNT = 500;          // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024;     // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;      // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;      // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000;            // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000;            // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;

// Live collaboration settings (story 3).
export const MAX_CONCURRENT_EDITORS = 5;
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
export const CONNECTED_CONFIRMATION_MS = 2000;
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// Sticky note settings (story 2).
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

// Selection and transform settings (story 7).
export const HANDLE_SIZE_PX = 8;
export const STICKY_MIN_SIZE_WORLD = 50;
export const MAX_OBJECT_SIZE_WORLD = 20_000;
export const NUDGE_STEP_WORLD = 1;
export const NUDGE_LARGE_STEP_WORLD = 10;

// Undo settings (story 8).
export const UNDO_CAPTURE_TIMEOUT_MS = 500;   // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;

// Text object settings (story 9).
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
export const TEXT_MIN_WIDTH_WORLD = 40;
export const TEXT_MAX_CHARS = 5000;
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3;
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// Zoom limits and step size (PRD "Settings").
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversions (design: convert LINE/PAGE to pixels).
export const WHEEL_LINE_HEIGHT_PX = 16; // deltaMode === DOM_DELTA_LINE
export const WHEEL_PAGE_HEIGHT_PX = 800; // deltaMode === DOM_DELTA_PAGE

// Convert a raw wheel delta (in the given deltaMode) to CSS pixels.
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;
export function wheelDeltaToPixels(delta: number, deltaMode: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case DELTA_MODE_PAGE:
      return delta * WHEEL_PAGE_HEIGHT_PX;
    default:
      return delta;
  }
}
