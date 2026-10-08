/**
 * Product settings for vidi6.
 *
 * All named settings live in this file so they can be changed in one place
 * without redesign. Stories 2-5 add to this file.
 */

/** Minimum zoom (screen pixels per world unit): 10%. */
export const ZOOM_MIN = 0.1;

/** Maximum zoom (screen pixels per world unit): 400%. */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + =/−. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom factor is exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), where
 * deltaY is in CSS pixels (positive = scroll down / pinch out on most OSes).
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * The board must pan at least this many world units from the starting point
 * in any direction without an edge or visible grid distortion.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Maximum allowed deviation when snapping a step zoom to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Percent value shown per 1.0 of zoom (zoom 1 → "100%"). */
export const PERCENT_PER_ZOOM = 100;

/** Pixels per delta unit for wheel events reported in LINE delta mode. */
export const WHEEL_LINE_DELTA_PX = 16;
