/**
 * Product settings shared by the client and (from story 3) the Worker.
 * Stories 2-5 add further settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is tested to work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom step results snap to ZOOM_STEP_FACTOR^n within this relative epsilon, so a step in then out is exact. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier used to render a zoom level as a whole-number percentage. */
export const PERCENT = 100;

/** Wheel deltaMode: one delta unit is one line (converted to pixels). */
export const WHEEL_PIXELS_PER_LINE = 16;

/** Wheel deltaMode: one delta unit is one page (converted to pixels). */
export const WHEEL_PIXELS_PER_PAGE = 800;

/** Radius, in screen pixels, of each dot in the grid (constant on screen at any zoom). */
export const GRID_DOT_RADIUS = 1;

/** Size, in screen pixels, of the origin crosshair marker drawn at world (0, 0). */
export const ORIGIN_MARKER_SIZE = 16;
