/**
 * Product settings shared by the client and (later) the worker.
 * Stories 2-5 add their own named settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor = exp(-deltaY * sensitivity) for Ctrl/Cmd + wheel. */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** Extent the "no edges" requirement is verified to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* --------------------------------------------------------------- sticky notes */

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Show the character counter when the remaining characters are at most this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size (px at 100% zoom); below this the text overflows. */
export const STICKY_FONT_MIN_PX = 10;

/** Screen pixels a pointer must move before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky-note colours. Keys double as accessible colour names. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour a freshly created note has. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* ------------------------------------------------------------ live collaboration */

/**
 * Soft simultaneous-editor capacity: a single product setting that both the design
 * and the tests reason about. It is never enforced — a further person is never
 * refused — it only states the number of concurrent editors the 1-second latency
 * requirement is designed and tested for (`live.capacity`, `live.over_capacity`).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * `live.propagate`: the budget, in milliseconds, from a change appearing on the
 * sender's screen to it appearing on every other connected person's screen.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/**
 * Passed to `WebsocketProvider`'s `maxBackoffTime`: the largest gap between
 * reconnection attempts after the connection is lost.
 */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" confirmation shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** The outage length the `live.catch_up` verification disconnects a person for. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
