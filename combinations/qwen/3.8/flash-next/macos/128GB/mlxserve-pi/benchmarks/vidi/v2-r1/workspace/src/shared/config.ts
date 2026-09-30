/**
 * Product settings for vidi6. Every named setting that design/system docs call
 * "a product setting that can be changed in one place without redesign" lives
 * here. Stories 2-5 add their own settings to this file.
 */

// --- Camera / zoom -----------------------------------------------------------

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies/divides the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor produced by a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// --- Board geometry ----------------------------------------------------------

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far (in world units) the unbounded-pan guarantee is tested. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky notes ------------------------------------------------------------

/** A sticky note's width and height in world units (it is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on a note's text length, in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters or fewer remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/**
 * The six selectable note colours. The key is the persisted colour name; the
 * value is the fill. Keys double as the accessible/tooltip colour names.
 */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour a freshly created note gets. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Live collaboration (story 3) --------------------------------------------

/**
 * How many people a board is designed and tested for while they all edit at
 * the same time. This is a soft target: it is never enforced — a 6th person is
 * connected and can edit like anyone else (PRD live.over_capacity). Every test
 * that needs "full capacity" reads this setting instead of a literal number.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Change-delivery budget: the time from a change appearing on the sender's
 * screen to it appearing on every other connected screen (PRD live.propagate).
 * Reported (not asserted) by the e2e suite, which shares one machine with the
 * model and the server; see design.md "Timing policy".
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the reconnect backoff while the connection is down. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Outage length used by the catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait used by every e2e story when waiting for something that
 * another participant (or the runtime) makes happen. Latency is measured and
 * logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted here.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
