/**
 * Product settings for the board. Everything tunable lives here so it can be
 * changed in one place without a redesign. Stories 2-5 add to this file.
 */

/** Smallest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplier applied to the zoom by one "step" (a zoom button or shortcut). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor for a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is required to work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Zoom values produced by repeated steps snap to the nearest
 * `ZOOM_STEP_FACTOR^n` when closer than this, so "step in then step out"
 * returns exactly the zoom it started from (1.25 then 0.8 => 1).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** The zoom label is `Math.round(zoom * ZOOM_PERCENT_SCALE)` percent. */
export const ZOOM_PERCENT_SCALE = 100;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;
