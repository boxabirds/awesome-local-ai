// Product settings for vidi6. All numbers that define board behaviour live here.

/** Minimum board zoom (10% of 1 screen pixel per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied per zoom step (buttons, Ctrl/Cmd +/-). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/trackpad zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) the board is verified to support. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Step zoom snaps to the nearest ZOOM_STEP_FACTOR^n within this many "steps". */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Percentage scaling for the zoom label. */
export const PERCENT = 100;
/** Pixels per wheel "line" delta (deltaMode LINE). */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Pixels per wheel "page" delta (deltaMode PAGE). */
export const WHEEL_PAGE_DELTA_PIXELS = 100;
