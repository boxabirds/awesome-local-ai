// Shared product settings for vidi6. Stories 2-5 add to this file.
// Everything that a designer might want to tune lives here so it can be
// changed in one place without touching component code.

/** Lowest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Highest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied by one zoom-in step (zoom-out divides). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: zoom factor = Math.exp(-deltaY * sensitivity).
 * A deltaY of one "notch" (~100) yields exp(1) ~= 2.718 at full deflection.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots (and major grid lines) in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * How far from the starting point the board is guaranteed (and tested) to pan
 * without reaching an edge. Doubles keep sub-pixel precision at this range.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Sticky note settings (story 2) ----------------------------------------
// Everything a designer might tune about sticky notes lives here so it can be
// changed in one place without touching component code.

/** Side length of a sticky note in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the number of characters kept in a note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter is shown when remaining chars <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (board units, at 100% zoom) tried by auto-fit. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size tried by auto-fit; below this text overflows. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) beyond which a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by their accessible colour name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour a freshly created note is filled with. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
