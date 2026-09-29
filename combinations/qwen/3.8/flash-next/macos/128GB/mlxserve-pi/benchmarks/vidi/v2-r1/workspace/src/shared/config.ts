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
