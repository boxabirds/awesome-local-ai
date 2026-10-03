/**
 * Product settings for vidi6. Every tunable number in the app lives here so it
 * can be changed in one place without a redesign (design "Named settings").
 * Stories 2-5 add their own settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit) — shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is verified to work without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------- sticky notes */

/** A sticky note is a square of this many world units (board units). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the characters of text a sticky note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in board units, so it scales with the board zoom. */
export const STICKY_FONT_MAX_PX = 24;

/**
 * Smallest note font size, in board units. Below this the text is not shrunk
 * any further: the overflow is hidden and the note shows a fade instead.
 */
export const STICKY_FONT_MIN_PX = 10;

/** Padding between a note's edge and its text, in world units. */
export const STICKY_TEXT_PADDING_WORLD = 12;

/**
 * How far the pointer has to travel after a pointerdown before the gesture
 * becomes a drag instead of a select (screen pixels).
 */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours a user may choose from (sticky.color). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** The colour of a newly created note (sticky.create_dblclick). */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Every colour name in `STICKY_COLORS` (used for validation and the toolbar). */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Is `value` one of the six colour names? Unknown names are rejected. */
export const isStickyColor = (value: unknown): value is StickyColor =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(STICKY_COLORS, value);

/* ------------------------------------------------------- live collaboration */

/**
 * Soft capacity: the number of simultaneous editors the board is designed and
 * tested for. It is never enforced — a 6th person joins and edits normally —
 * but it drives the tests, which read this setting rather than a literal.
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * The change-delivery requirement: a change made on one screen must appear on
 * every other screen within this many milliseconds (PRD `live.propagate`).
 * e2e measures against it and reports it, but does not gate on it, because the
 * model, the browsers and the server share one machine in the test setup.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Upper bound of the provider's reconnect backoff (y-websocket `maxBackoffTime`). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" confirmation shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** Length of the outage in the catch-up verification (PRD `live.catch_up`). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Generous functional wait in e2e (all stories): tests wait up to this long
 * for a change to arrive, while latency is logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS rather than asserted.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
