/**
 * Named product settings. Every tunable number lives here so it can be changed
 * in one place without redesign. Later stories add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the start point (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/**
 * Smallest on-screen distance between grid dots, in CSS pixels. When zooming out would
 * pack dots closer than this, the grid shows every 2nd (4th, ...) dot instead so it
 * stays readable and cheap to paint. At 100% and above this never applies.
 */
export const GRID_MIN_SCREEN_SPACING = 8;
/** Radius of one grid dot, in CSS pixels (constant on screen at every zoom). */
export const GRID_DOT_RADIUS_PX = 1;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;

// ---- Story 2: sticky notes ----
/** Width and height of a sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when the remaining characters are <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (CSS px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (CSS px) after which a press on a note becomes a drag. */
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
/** Inner padding of a note's text area, in world units. */
export const STICKY_PADDING_WORLD = 16;
/** Line height of note text, relative to the font size. */
export const STICKY_LINE_HEIGHT = 1.25;
/** Gap between a selected note and its floating toolbar, in screen pixels. */
export const NOTE_TOOLBAR_GAP_PX = 8;

// ---- Story 3: live collaboration ----
/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the catch-up verification (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
