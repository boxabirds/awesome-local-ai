// Product settings for the vidi6 board.
// Stories 2-5 add their own named settings to this file.

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** How much one zoom step multiplies/divides the zoom level. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to work without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Wheel deltaMode conversion to CSS pixels (deltaMode: 0 = pixels, 1 = lines, 2 = pages).
export const WHEEL_PIXELS_PER_LINE = 16;
export const WHEEL_PIXELS_PER_PAGE = 800;

/** Zoom is reported as a whole-number percentage. */
export const PERCENT_PER_ZOOM = 100;
/** zoomStep snaps to the nearest ZOOM_STEP_FACTOR^n within this tolerance. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
