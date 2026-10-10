/**
 * Product settings for the board. Everything tunable lives here so it can be
 * changed in one place without a redesign. Stories 2-5 add to this file.
 */

/** Smallest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplier applied to the zoom by one "step" (a zoom button or shortcut). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor for a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is required to work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Zoom values produced by repeated steps snap to the nearest
 * `ZOOM_STEP_FACTOR^n` when closer than this, so "step in then step out"
 * returns exactly the zoom it started from (1.25 then 0.8 => 1).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** The zoom label is `Math.round(zoom * ZOOM_PERCENT_SCALE)` percent. */
export const ZOOM_PERCENT_SCALE = 100;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;

/* --- Story 2: sticky notes ------------------------------------------------ */

/** Sticky note size in world units (square: width = height). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the characters in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when remaining <= this many characters. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (CSS pixels at 100% zoom; scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement that turns a press on a note into a drag (screen px). */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours. Keys are the names stored in the document. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
