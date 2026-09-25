/**
 * Product settings shared across the app. Stories 2-5 add to this file.
 */

/** Minimum board zoom: 10% of the default (100%) scale. */
export const ZOOM_MIN = 0.1;

/** Maximum board zoom: 400% of the default (100%) scale. */
export const ZOOM_MAX = 4;

/** Multiplicative step applied by the zoom buttons and Ctrl/Cmd +/- shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a Ctrl/Cmd+wheel event = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Farthest distance (in world units) that navigation is verified to stay exact. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes (story 2) -----------------------------------------------

/** Side length of a sticky note, in world units. Notes are square. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows once the note is within this many characters of STICKY_TEXT_MAX_CHARS. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size (world px, at 100% zoom), for short text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size; below this, overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six sticky note colours, keyed by product name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) -----------------------------------------

/** Soft capacity: the number of simultaneous editors the product is designed and tested for. Never enforced (a 6th person is not turned away). */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD `live.propagate`: a change must appear on every other screen within this budget, measured sender-side to receiver-side. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to the y-websocket provider's `maxBackoffTime`: longest pause between reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays visible after a reconnection before it hides. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD `live.catch_up` verification: the outage length used by the catch-up tests. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
