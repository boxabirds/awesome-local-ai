/**
 * Product settings shared by the client and (later) the worker.
 * Every tunable number for story 1 lives here; stories 2-5 add their own.
 */

/** Smallest allowed zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom applied by one button / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to still work (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel `deltaMode === DOM_DELTA_LINE`: pixels per line. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Wheel `deltaMode === DOM_DELTA_PAGE`: pixels per page (fraction of viewport height). */
export const WHEEL_PAGE_HEIGHT_FRACTION = 0.9;

/** Conversions used by the zoom indicator. */
export const PERCENT_PER_ZOOM = 100;

/**
 * `zoomStep` snaps the resulting zoom to the nearest `ZOOM_STEP_FACTOR^n`
 * within this relative epsilon, so a step in followed by a step out returns
 * to exactly the previous zoom (no floating-point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
