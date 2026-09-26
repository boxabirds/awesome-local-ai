// Product settings for vidi6. Stories 2-5 add their settings to this file.

/** Smallest zoom the user can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the user can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot grid lines, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Sticky note settings (story 2)

/** Width and height of a sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter becomes visible when remaining <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Minimum pointer movement in screen px before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
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
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// Live collaboration settings (story 3)

/**
 * Simultaneous-editor capacity: the number of people a board is designed and
 * tested for. Soft: never enforced, a 6th person is never turned away. Tests
 * must use this setting rather than a hard-coded number (PRD live.capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: change-delivery budget in ms (sender screen -> receiver screen). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound of the provider's reconnect backoff (passed to WebsocketProvider). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the PRD live.catch_up verification. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
