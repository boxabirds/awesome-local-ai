// Product settings for vidi6. Every tunable number that shapes the product
// lives here so it can be changed in one place without a redesign.
// Stories 2-5 add their own settings to this file.

// --- Board navigation (story 1) ---

/** Smallest zoom level: screen pixels per world unit. Shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level. Shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the unbounded-pan requirement is tested, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Pixels per wheel "line" when a wheel event reports `deltaMode === LINE`.
 * Browsers do not report pixels for line/page deltas, so we convert with this.
 */
export const WHEEL_LINE_PX = 32;
/** Pixels per wheel "page" when a wheel event reports `deltaMode === PAGE`. */
export const WHEEL_PAGE_PX = 800;
