/**
 * Named product settings for story 1 (Pan and zoom around an infinite board).
 * Later stories extend this file; do not scatter literals for these values.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative step applied by the +/− buttons and Ctrl/Cmd +/- (125%). */
export const ZOOM_STEP_FACTOR = 1.25;
/**
 * Sensitivity of Ctrl/Cmd + wheel and trackpad pinch:
 * zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/**
 * Distance from the starting point (world units) that must remain pannable
 * without an edge; used by far-travel tests.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
