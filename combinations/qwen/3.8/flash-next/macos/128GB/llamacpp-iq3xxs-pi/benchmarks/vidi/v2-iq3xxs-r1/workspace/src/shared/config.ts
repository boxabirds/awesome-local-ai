// Named product settings for the board. Stories 2–5 add to this file.

/** Minimum zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;
/** Multiplicative step for the +/- buttons and keyboard shortcuts. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom factor = exp(-deltaY * sensitivity)
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Extent (world units) that must be pannable in any direction without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 2: sticky notes ---------------------------------------------------

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Hard limit on characters stored in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
/** Largest note font size (board units = CSS px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows and is clipped. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) that turns a press into a drag. */
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D', orange: '#FFCC80', green: '#C5E1A5',
  blue: '#90CAF9', pink: '#F48FB1', violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
