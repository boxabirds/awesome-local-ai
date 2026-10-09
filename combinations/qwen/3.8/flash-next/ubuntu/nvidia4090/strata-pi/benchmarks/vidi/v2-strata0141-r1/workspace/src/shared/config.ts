/**
 * Product settings for vidi6. Every named setting lives here so later stories
 * can change behaviour without redesign (stories 2-5 add to this file).
 */

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard step). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom percentage is reported as `zoom * PERCENT`, rounded. */
export const PERCENT = 100;

/**
 * `zoomStep` snaps the result to the nearest power of ZOOM_STEP_FACTOR when it
 * is within this distance, so zooming in then out returns exactly the previous
 * zoom (no floating point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** wheel deltaMode constants (wheel events report lines or pages, not pixels). */
export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 800;

/** Numerical tolerance used when comparing camera coordinates. */
export const CAMERA_EPSILON = 1e-6;
