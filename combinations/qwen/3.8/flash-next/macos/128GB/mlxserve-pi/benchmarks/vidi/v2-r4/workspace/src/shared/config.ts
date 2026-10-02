/**
 * Product settings shared by the client and (later) the Worker.
 * Stories 2-5 add their own named settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level — shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to still work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
