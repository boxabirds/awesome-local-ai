// Product settings for vidi6. Every tunable number that shapes the product
// lives here so it can be changed in one place without a redesign.
// Stories 2-5 add their own settings to this file.

// --- Board navigation (story 1) ---

/** Smallest zoom level: screen pixels per world unit. Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the unbounded-pan requirement is tested, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Pixels per wheel "line" when a wheel event reports `deltaMode === LINE`.
 * Browsers do not report pixels for line/page deltas, so we convert with this.
 */
export const WHEEL_LINE_PX = 32;
/** Pixels per wheel "page" when a wheel event reports `deltaMode === PAGE`. */
export const WHEEL_PAGE_PX = 800;

// --- Sticky notes (story 2) ---

/** Sticky note width and height in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;
/** Longest note text, in characters; further characters are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel that turns a press on a note into a drag, in screen px. */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours, as CSS colours. Keys are the stored colour names. */
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

// --- Live collaboration (story 3) ---

/**
 * Soft simultaneous-editor capacity: the design and test target for the 1-second
 * change-delivery guarantee. It is never enforced — a board never refuses or
 * restricts a person over this number (PRD live.over_capacity). Tests read this
 * setting rather than a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/**
 * The change-delivery budget, in milliseconds: how long after a change appears
 * on the sender's screen it must appear on every other screen (PRD
 * live.propagate). In e2e this is reported, not asserted, because the model,
 * browsers and server share one machine.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound on the provider's reconnect backoff, in milliseconds. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the catch-up (live.catch_up) test, in milliseconds. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * How long a single idle editor is left open in the awareness keep-alive test.
 * Must exceed the provider's 30s no-message reconnect timeout so the test proves
 * the periodic awareness relay, not just a short gap (TC-29, nightly).
 */
export const IDLE_KEEPALIVE_TEST_MS = 45_000;
/**
 * Socket outage for the awareness soak test: longer than the catch-up outage, to
 * show awareness survives a drop past the reconnect timeout (TC-30, nightly).
 */
export const SOAK_TEST_OUTAGE_MS = CATCH_UP_TEST_OUTAGE_MS + 15_000;
/**
 * Wall-clock duration of the full-capacity soak: MAX_CONCURRENT_EDITORS contexts
 * make continuous seeded random edits via the real UI for this long, and every
 * change's sender-to-receiver latency is measured and reported (TC-30, nightly).
 */
export const SOAK_DURATION_MS = 60_000;
/**
 * Generous functional wait used by every e2e story: tests wait up to this long
 * for a change to appear and log the measured latency against
 * LIVE_UPDATE_LATENCY_BUDGET_MS instead of failing on it.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
