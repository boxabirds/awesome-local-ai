/**
 * vidi6 product settings.
 *
 * Every tunable number in the client lives here (stories 2-5 keep adding to this
 * file) so the product can be re-tuned in one place without a redesign.
 */

// ---- Zoom ------------------------------------------------------------------

/** The standard view's zoom, used by Reset view, in screen pixels per world unit. */
export const ZOOM_DEFAULT = 1;

/** Smallest zoom the user can reach, in screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the user can reach, in screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplier applied by one zoom step (one click of the + button). */
export const ZOOM_STEP_FACTOR = 1.25;

/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) for a Ctrl/Cmd wheel or pinch. */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/**
 * Zoom values are conceptually ZOOM_STEP_FACTOR^n. Repeated multiplication by the
 * step factor (and its inverse) accumulates floating point drift, so a computed
 * zoom is snapped to the nearest step value when it is this close (relative).
 */
export const ZOOM_STEP_SNAP_TOLERANCE = 1e-9;

/** Multiplier used to display a zoom level as a percentage. */
export const PERCENT = 100;

// ---- Wheel delta modes -----------------------------------------------------

/** Pixels for one line of wheel delta (`WheelEvent.DOM_DELTA_LINE`). */
export const WHEEL_LINE_MODE_PIXELS = 16;

/** Pixels for one page of wheel delta (`WheelEvent.DOM_DELTA_PAGE`). */
export const WHEEL_PAGE_MODE_PIXELS = 800;

// ---- Grid ------------------------------------------------------------------

/** Distance between dot grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** Size of a grid dot in screen pixels (it does not grow with zoom). */
export const GRID_DOT_SIZE_SCREEN = 2;

/** How far from the start the board is guaranteed to pan without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
