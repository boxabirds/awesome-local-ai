// Product settings for the board. Stories 2-5 add to this file.
// Changing these values must not require redesign (see PRD Constraints: Settings).

/** Minimum zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom level (screen pixels per world unit). */
export const ZOOM_MAX = 4;
/** Multiplicative factor applied by one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Trackpad/wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Largest distance (world units) exercised by the "no edges" tests. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Percent base used for the zoom label (zoom * PERCENT_BASE). */
export const PERCENT_BASE = 100;

/**
 * Step-zoom snapping epsilon. When a step result lies within this distance of a
 * value `ZOOM_STEP_FACTOR^n`, the result snaps to that exact value. This keeps a
 * zoom-in then zoom-out pair returning to exactly the previous zoom (no float drift).
 */
export const ZOOM_SNAP_EPSILON = 1e-9;

/** Wheel deltaMode -> pixels. */
export const WHEEL_LINE_HEIGHT = 16; // DOM_DELTA_LINE
export const WHEEL_PAGE_HEIGHT = 800; // DOM_DELTA_PAGE
