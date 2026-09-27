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
