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
