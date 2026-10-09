// Product settings for the vidi6 board.
// Story 2 onwards add their own named settings to this file.

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** How much one zoom step multiplies/divides the zoom level. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to work without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversion to CSS pixels (deltaMode: 0 = pixels, 1 = lines, 2 = pages).
export const WHEEL_PIXELS_PER_LINE = 16;
export const WHEEL_PIXELS_PER_PAGE = 800;

/** Zoom is reported as a whole-number percentage. */
export const PERCENT_PER_ZOOM = 100;
/** zoomStep snaps to the nearest ZOOM_STEP_FACTOR^n within this tolerance. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Story 2: sticky notes.

/** Sticky note size in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;
/** Longest text a sticky note keeps. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when this many characters (or fewer) are left. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size in board units (at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Screen pixels a pointer must move after a press before it becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset note colours, in toolbar order. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** A new note is yellow. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// Story 3: live collaboration.

/**
 * Simultaneous-editor capacity the board is designed and tested for.
 *
 * Soft on purpose: neither the Worker nor the room counts participants, so a
 * `(MAX_CONCURRENT_EDITORS + 1)`-th person is never refused (`live.over_capacity`).
 * Tests read this setting instead of a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** `live.propagate`: how long a change may take to appear on another screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1_000;
/** Passed to `WebsocketProvider.maxBackoffTime`: the longest wait between retries. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2_000;
/** The outage length the `live.catch_up` verification disconnects a person for. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story: on one shared machine the
 * 1-second `LIVE_UPDATE_LATENCY_BUDGET_MS` is measured and logged, never asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
