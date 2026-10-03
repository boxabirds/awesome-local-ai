/**
 * Product settings for vidi6, in one place (stories 2-5 add to this file).
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd + scroll and pinch sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid lines, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values are snapped to the nearest ZOOM_STEP_FACTOR^n within this relative epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier that turns a zoom level into the displayed whole-number percentage. */
export const PERCENT = 100;

/** WheelEvent.deltaMode values. */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/** Pixels per line for wheel events reported in lines. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Dot-grid dot radius in screen pixels (does not scale with zoom). */
export const GRID_DOT_RADIUS_PX = 1;
