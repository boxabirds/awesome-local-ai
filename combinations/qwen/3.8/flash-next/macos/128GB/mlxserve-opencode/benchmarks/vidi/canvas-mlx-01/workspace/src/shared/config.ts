/**
 * Product settings shared by the client and (later) the worker.
 * Stories 2-5 add their own named settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (button / keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor = exp(-deltaY * sensitivity) for Ctrl/Cmd + wheel. */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots in world units. */
export const GRID_SPACING_WORLD = 24;

/** Extent the "no edges" requirement is verified to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
