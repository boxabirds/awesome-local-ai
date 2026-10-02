/**
 * vidi6 product settings.
 *
 * Every tunable that the product owns lives here so it can be changed in one
 * place without a redesign (story 1 PRD, "Settings"). Stories 2-5 add to this
 * file.
 */

/** Smallest allowed zoom (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** The board must stay usable at least this far from the starting point. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels represented by one wheel event with `deltaMode === DOM_DELTA_PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;
