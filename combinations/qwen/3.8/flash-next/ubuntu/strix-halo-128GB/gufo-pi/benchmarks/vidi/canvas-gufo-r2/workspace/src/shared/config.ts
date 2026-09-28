/**
 * Product settings shared by the client and (later) the worker.
 * Every tunable number for story 1 lives here; stories 2-5 add their own.
 */

/** Smallest allowed zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom applied by one button / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to still work (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel `deltaMode === DOM_DELTA_LINE`: pixels per line. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Wheel `deltaMode === DOM_DELTA_PAGE`: pixels per page (fraction of viewport height). */
export const WHEEL_PAGE_HEIGHT_FRACTION = 0.9;

/** Conversions used by the zoom indicator. */
export const PERCENT_PER_ZOOM = 100;

/**
 * `zoomStep` snaps the resulting zoom to the nearest `ZOOM_STEP_FACTOR^n`
 * within this relative epsilon, so a step in followed by a step out returns
 * to exactly the previous zoom (no floating-point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// ----------------------------------------------------------- sticky notes (story 2)

/** Sticky note width and height in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters in a sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Character counter appears when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;

/** Minimum pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Six preset sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour for newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ----------------------------------------------------------- live collaboration (story 3)

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1 second budget for change delivery. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
