/**
 * Product settings for vidi6. Every tunable number lives here so it can be
 * changed in one place without a redesign (stories 2+ keep adding to this file).
 */

/** Smallest zoom the user can reach (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom the user can reach. 400%. */
export const ZOOM_MAX = 4;

/** One zoom step: the zoom is multiplied (or divided) by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Radius, in screen pixels, of one dot grid dot. */
export const GRID_DOT_RADIUS_PX = 1;

/** Zoom -> whole-number percentage label. */
export const PERCENT_PER_ZOOM = 100;

/**
 * Zoom steps snap to the nearest exact power of ZOOM_STEP_FACTOR within this
 * relative tolerance, so "zoom in then zoom out" returns to exactly 1.0
 * instead of drifting (1.25 * (1 / 1.25) is not exactly 1 in binary floats).
 */
export const ZOOM_STEP_SNAP_TOLERANCE = 1e-9;

/** Pixels per wheel event unit when WheelEvent.deltaMode is DELTA_MODE_LINE. */
export const WHEEL_DELTA_LINE_PX = 40;

/** Pixels per wheel event unit when WheelEvent.deltaMode is DELTA_MODE_PAGE. */
export const WHEEL_DELTA_PAGE_PX = 800;

/** Width/height, in screen pixels, of the crosshair marking the board start point. */
export const ORIGIN_MARKER_SIZE_PX = 16;
