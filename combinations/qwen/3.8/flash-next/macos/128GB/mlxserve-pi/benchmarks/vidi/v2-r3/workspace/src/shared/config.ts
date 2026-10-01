// Shared product settings. Stories 2-5 add their own settings to this file.

/** Minimum zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies (or divides) the zoom level by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid lines in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * How far (in board units) the app is tested to pan from the starting point
 * without hitting an edge. Used by tests; the camera itself is unbounded.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
