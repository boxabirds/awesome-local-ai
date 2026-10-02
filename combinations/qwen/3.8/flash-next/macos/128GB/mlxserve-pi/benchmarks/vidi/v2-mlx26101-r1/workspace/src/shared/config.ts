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
