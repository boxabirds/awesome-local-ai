/**
 * Named product settings. Change a value here, not in feature code.
 * Stories 2+ add to this file.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom button/key step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Furthest distance in world units from the starting point that the board is
 * tested to pan without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom of the standard ("reset") view. */
export const ZOOM_RESET = 1;
/** Percent factor for the zoom label. */
export const PERCENT = 100;
/** Tolerance for snapping a stepped zoom to the exact value ZOOM_STEP_FACTOR^n. */
export const STEP_SNAP_EPSILON = 1e-9;
/** Pixels per wheel delta when deltaMode is LINE. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel delta when deltaMode is PAGE. */
export const WHEEL_PAGE_PX = 100;
