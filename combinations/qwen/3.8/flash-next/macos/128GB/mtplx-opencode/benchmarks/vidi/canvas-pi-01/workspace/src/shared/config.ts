/**
 * Product settings shared by the client (and, later, the Worker).
 * These are the "settings" named in the story designs: zoom limits, step size,
 * grid spacing. Changing a value here is the single place a designer can tune
 * the board without a redesign (PRD "Settings").
 */

/** Smallest zoom factor the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom factor the board can reach. */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (a step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot-grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far the unbounded-board requirement is tested (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
