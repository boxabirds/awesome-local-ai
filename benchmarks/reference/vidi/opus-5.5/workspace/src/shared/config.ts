/**
 * Named product settings. Change values here only; every consumer imports them.
 */

/** Minimum zoom (screen px per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative zoom change per button click / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd-wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
