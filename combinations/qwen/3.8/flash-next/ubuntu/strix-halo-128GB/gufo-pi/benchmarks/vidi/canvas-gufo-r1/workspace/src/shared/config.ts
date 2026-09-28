// Shared product settings for vidi6.
// Stories 2-5 add further settings to this file.
//
// Story 1 (Pan and zoom around an infinite board) owns the camera / grid settings.

/** Minimum zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit). 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative size of a single zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** Pan distance (world units) the board must handle without edges or distortion. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
