// Named product settings for vidi6. Stories 2-5 add to this file.

/** Minimum board zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;
/** Multiplicative factor applied for one zoom step in or out. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a wheel/pinch = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Pixels per wheel "line" delta (deltaMode === 1), converted to pixels. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel "page" delta (deltaMode === 2), converted to pixels. */
export const WHEEL_PAGE_PX = 200;
/** Far-test extent (board units) the board must pan without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
