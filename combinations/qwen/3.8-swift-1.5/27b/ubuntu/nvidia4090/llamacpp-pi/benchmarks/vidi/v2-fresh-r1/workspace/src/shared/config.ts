// Named product settings for vidi6. Stories 2-5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative zoom step for buttons and keyboard shortcuts (1.25). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a Ctrl/Cmd wheel = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) from the start that pan is tested to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" delta (WheelEvent.deltaMode === 1). */
export const WHEEL_LINE_DELTA_PX = 16;
/** Pixels per wheel "page" delta (WheelEvent.deltaMode === 2). */
export const WHEEL_PAGE_DELTA_PX = 100;
