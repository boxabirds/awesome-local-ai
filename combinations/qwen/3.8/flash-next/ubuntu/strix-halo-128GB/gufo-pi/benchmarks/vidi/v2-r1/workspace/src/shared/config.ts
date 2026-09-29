/**
 * Product settings for vidi6, in one place so they can be tuned without a
 * redesign. Stories 2+ add their own settings to this file.
 */

// ---- Zoom (story 1: pan and zoom around an infinite board) ----

/** Smallest zoom (screen pixels per world unit) the board can be scaled to. */
export const ZOOM_MIN = 0.1;
/** Largest zoom (screen pixels per world unit) the board can be scaled to. */
export const ZOOM_MAX = 4;
/** One zoom step: `+` multiplies the zoom by this, `-` divides by it. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom step values are snapped to `ZOOM_STEP_FACTOR^n` within this epsilon. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a wheel `deltaMode === LINE` delta into CSS pixels. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Multiplier turning a wheel `deltaMode === PAGE` delta into CSS pixels. */
export const WHEEL_PAGE_HEIGHT_PX = 400;

// ---- Presentation of the zoom indicator ----

/** Zoom is shown to the user as a whole-number percentage. */
export const PERCENT = 100;
