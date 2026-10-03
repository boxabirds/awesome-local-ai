// Product settings shared across the app. Stories 2-5 add to this file.

/** Minimum board zoom, in screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Maximum board zoom, in screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied per zoom step (button or Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a wheel with Ctrl/Cmd held = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** Minimum panning extent (world units from the starting point) that must stay usable. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
