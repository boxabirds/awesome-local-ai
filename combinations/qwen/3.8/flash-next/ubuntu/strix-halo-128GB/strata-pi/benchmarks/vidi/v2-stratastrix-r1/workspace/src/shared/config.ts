/**
 * vidi6 product settings.
 *
 * Every tunable number in the product lives in this file so it can be changed
 * in one place without a redesign (stories 2+ add their settings here too).
 */

// ---- Board navigation (story 1) -------------------------------------------

/** Smallest zoom the user can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the user can reach. */
export const ZOOM_MAX = 4;

/** The zoom level Reset view returns to (100%). */
export const ZOOM_DEFAULT = 1;

/** One zoom step: +/- multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far the user must be able to pan from the start without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Dot grid dot radius in screen pixels (constant at every zoom). */
export const GRID_DOT_RADIUS_PX = 1.5;

/** Converts a zoom factor to a whole-number percentage for display. */
export const ZOOM_PERCENT_SCALE = 100;

/**
 * Step zooming snaps the result to the nearest `ZOOM_STEP_FACTOR ** n` when it
 * is this close (relative), so 1.0 -> in -> out returns exactly 1.0.
 */
export const ZOOM_STEP_SNAP_RELATIVE = 1e-9;

// ---- Wheel delta mode conversion ------------------------------------------

/** WheelEvent.deltaMode value for line deltas. */
export const WHEEL_DELTA_MODE_LINE = 1;

/** WheelEvent.deltaMode value for page deltas. */
export const WHEEL_DELTA_MODE_PAGE = 2;

/** Pixels per wheel line, used when deltaMode is LINE. */
export const WHEEL_LINE_PIXELS = 16;

/** Pixels per wheel page, used when deltaMode is PAGE. */
export const WHEEL_PAGE_PIXELS = 800;
