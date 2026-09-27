// Product / navigation settings. Stories 2-5 add to this file.
// Changing these must not require a redesign elsewhere.

// Zoom limits (screen pixels per world unit).
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

// One zoom step multiplies/divides the zoom by this factor (buttons + Ctrl/Cmd +/-).
export const ZOOM_STEP_FACTOR = 1.25;

// Wheel/pinch zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Dot grid spacing in world units (screen spacing = GRID_SPACING_WORLD * zoom).
export const GRID_SPACING_WORLD = 24;

// How far a test pans from the start to prove the board is effectively unbounded.
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// zoomPercent = Math.round(zoom * ZOOM_PERCENT_SCALE).
export const ZOOM_PERCENT_SCALE = 100;

// A zoom value this close to ZOOM_STEP_FACTOR^n snaps exactly to that power,
// so a step in then out returns to exactly 1.0 (avoids float drift).
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// Wheel deltaMode unit conversions to CSS pixels (named to avoid magic numbers).
export const WHEEL_DELTA_LINE_PX = 16; // one "line" unit in pixels
export const WHEEL_DELTA_PAGE_PX = 800; // one "page" unit in pixels

// --- Sticky notes (story 2) -------------------------------------------------

// Sticky note size in world units (a square note).
export const STICKY_SIZE_WORLD = 200;

// Hard limit on the number of characters kept in a note's text.
export const STICKY_TEXT_MAX_CHARS = 1000;

// The character counter shows only when the remaining characters are <= this.
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

// Text auto-fit range in CSS pixels (at 100% zoom, screen px == world units).
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;

// A pointer must move more than this many screen pixels to start a drag
// (a shorter press is a select, not a drag).
export const DRAG_THRESHOLD_PX = 3;

// The six selectable note colours. Names are stable product settings; the hex
// values may change without touching components.
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

// --- Live collaboration (story 3) ------------------------------------------

// Soft simultaneous-editor capacity: the design + test target the board is
// built and verified for. It is NEVER enforced — a 6th person joins normally.
export const MAX_CONCURRENT_EDITORS = 5;

// PRD live.propagate: change must reach every other screen within this budget
// (ms), measured on the sender's DOM update to the receiver's DOM update.
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

// Passed to WebsocketProvider as maxBackoffTime: the exponential reconnect
// backoff is capped at this many milliseconds.
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

// How long the green "Connected" confirmation badge is shown after a
// reconnection before it hides.
export const CONNECTED_CONFIRMATION_MS = 2000;

// The outage length used by the live.catch_up verification (PRD): disconnect
// one participant for this long while their page stays open.
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
