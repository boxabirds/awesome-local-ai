/**
 * Product settings shared by the client and (later) the Worker.
 * Stories 2-5 add their own named settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level — shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to still work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* --- story 2: sticky notes ------------------------------------------------- */

/** Side length of a new sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (pixels at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows into a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel that turns a press on a note into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky colours, keyed by the name used in the accessible labels. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/* --- story 3: live collaboration ------------------------------------------- */

/**
 * Simultaneous editors the board is designed and tested for. This is a soft
 * target: it drives the tests and the design, and is never enforced — a person
 * who joins a board that already has this many people is not turned away.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** How long a change may take to appear on every other screen (live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait before a reconnect attempt (y-websocket `maxBackoffTime`). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the "edits catch up" verification (live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story: the model, the browsers
 * and the server share one machine, so tests wait this long for an outcome and
 * *log* the measured latency against LIVE_UPDATE_LATENCY_BUDGET_MS instead of
 * failing on it.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
/**
 * How long a board is left entirely alone in the nightly idle check (TC-29). It
 * has to be longer than the 30 seconds a quiet connection is given up for, or the
 * check proves nothing about a board nobody is touching.
 */
export const IDLE_STABILITY_MS = 45_000;
/** How long the nightly full-capacity soak keeps on editing (TC-30). */
export const IDLE_CAP_SOAK_MS = 60_000;
