/**
 * vidi6 product settings.
 *
 * These are the single place to change tuning values without a redesign.
 * Stories 2-5 will add further settings to this file.
 */

/** Minimum zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied by one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel / pinch zoom sensitivity.
 * zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Extent (in world units from the starting point) that must remain
 * navigable without reaching an edge or visible grid distortion.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Convert a zoom factor to a whole-number percentage. */
export const PERCENT = 100;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note side length in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest sticky font size, in board units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest sticky font size, in board units (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;

/** Height of the fade band over clipped text, in board units. */
export const STICKY_OVERFLOW_BAND_PX = 36;

/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky colours, in toolbar order. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
