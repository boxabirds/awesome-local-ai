/**
 * Named product settings. Every tunable number lives here so it can be changed
 * in one place without redesign. Later stories add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the start point (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/**
 * Smallest on-screen distance between grid dots, in CSS pixels. When zooming out would
 * pack dots closer than this, the grid shows every 2nd (4th, ...) dot instead so it
 * stays readable and cheap to paint. At 100% and above this never applies.
 */
export const GRID_MIN_SCREEN_SPACING = 8;
/** Radius of one grid dot, in CSS pixels (constant on screen at every zoom). */
export const GRID_DOT_RADIUS_PX = 1;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;
