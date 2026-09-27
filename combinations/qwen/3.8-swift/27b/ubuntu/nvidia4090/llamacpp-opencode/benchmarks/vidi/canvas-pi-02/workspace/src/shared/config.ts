// Named product settings for vidi6. All stories add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom step multiplies/divides the zoom by this factor (125%). */
export const ZOOM_STEP_FACTOR = 1.25;
/**
 * Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
 * for a wheel event with ctrl/cmd held.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest distance (in world units) the board is tested to pan to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Multiplier converting a zoom to its percentage label (1.0 -> 100). */
export const PERCENT = 100;
/**
 * After a step zoom, snap the result to the nearest ZOOM_STEP_FACTOR^n when
 * within this absolute epsilon, so repeated in/out steps return exactly.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Pixel size used when a wheel event reports deltaMode LINE. */
export const WHEEL_DELTA_LINE_PX = 16;
/** Wheel deltaMode values (DOM spec). */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/**
 * Fallback flush delay (ms) for rAF-batched camera updates: guarantees a
 * flush when the environment produces no paint frames (headless WebKit).
 * In normal browsers the rAF (next paint) always wins over this timer.
 */
export const CAMERA_FLUSH_FALLBACK_MS = 32;

/* --- Story 2: sticky notes --- */

/** Sticky note side length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters of text a sticky note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note text size (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note text size (px at 100% zoom); overflow fades below it. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset sticky note colours. */
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
