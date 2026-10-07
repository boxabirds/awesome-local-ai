// Zoom settings
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

// Grid settings
export const GRID_SPACING_WORLD = 24;

// Test extent
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Snap epsilon for step zoom to avoid float drift
export const SNAP_EPSILON = 1e-9;

// Wheel delta mode conversion (pixels per line/page)
export const LINE_TO_PIXELS = 20;
export const PAGE_TO_PIXELS = 400;

// Navigation hint text
export const NAV_HINT_TEXT = 'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
