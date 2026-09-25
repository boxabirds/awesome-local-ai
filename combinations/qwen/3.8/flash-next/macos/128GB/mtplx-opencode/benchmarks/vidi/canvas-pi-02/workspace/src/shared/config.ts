/**
 * Product settings for the vidi6 board. Stories 2-5 add their own settings to
 * this file. Everything that the design calls a "named setting" lives here so
 * it can be changed in one place without a redesign.
 */

/** Smallest zoom the board allows (10%). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (400%). */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values within this relative distance of a step value snap to it. */
export const ZOOM_STEP_SNAP_RELATIVE_EPSILON = 1e-9;

/** Multiplier turning a LINE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_LINE_PX = 32;

/** Multiplier turning a PAGE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_PAGE_PX = 800;

/** Zoom -> percentage label conversion (100% is a zoom of 1). */
export const PERCENT = 100;

/** Dot-grid dot radius in screen pixels (used by the CSS background). */
export const GRID_DOT_RADIUS_PX = 1.2;

/** Size of the origin crosshair marker, in screen pixels. */
export const ORIGIN_MARKER_SIZE_PX = 16;
