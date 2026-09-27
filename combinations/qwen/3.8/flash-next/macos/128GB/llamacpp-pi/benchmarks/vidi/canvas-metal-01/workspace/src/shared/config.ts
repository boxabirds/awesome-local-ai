/**
 * Product settings for vidi6. Stories 2+ add to this file; every tunable number
 * in the app references a constant from here.
 */

// ---- Board navigation (story 1) -------------------------------------------

/** Smallest zoom (screen pixels per world unit). 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom. 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) for pinch / Ctrl+wheel. */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Grid dot radius in screen pixels (constant while zooming, so dots stay crisp). */
export const GRID_DOT_RADIUS_PX = 1;
/** Grid dot colour. */
export const GRID_DOT_COLOR = "#c7ccd4";
/** Pan distance from the start that story 1 guarantees to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Zoom is shown to the user as a whole-number percentage (camera.zoom * PERCENT). */
export const PERCENT = 100;

/**
 * `zoomStep` snaps its result to the nearest power of `ZOOM_STEP_FACTOR` within
 * this absolute tolerance, so zooming in then out lands on exactly 1 again.
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Tolerance when comparing the zoom against `ZOOM_MIN` / `ZOOM_MAX` (limits, enable/disable). */
export const ZOOM_LIMIT_EPSILON = 1e-9;

/** `WheelEvent.deltaMode` values, named so input handling reads without magic numbers. */
export const WHEEL_DELTA_MODE_PIXEL = 0;
export const WHEEL_DELTA_MODE_LINE = 1;
export const WHEEL_DELTA_MODE_PAGE = 2;
/** CSS pixels one `deltaMode === LINE` unit represents. */
export const WHEEL_LINE_PX = 16;
/** CSS pixels one `deltaMode === PAGE` unit represents. */
export const WHEEL_PAGE_PX = 800;

/** Text of the first-use navigation hint (exact copy from the PRD). */
export const NAVIGATION_HINT_TEXT =
  "Drag to move around · Ctrl/Cmd + scroll or pinch to zoom";

/**
 * Commit delay for the camera update queue, in milliseconds. Pointer, wheel and
 * gesture input is coalesced to one commit per animation frame; this is the
 * fallback timer for hosts where `requestAnimationFrame` is throttled.
 */
export const FRAME_FALLBACK_MS = 16;
