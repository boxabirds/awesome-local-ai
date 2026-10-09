/**
 * Named product settings. Story 1: pan and zoom around an infinite board.
 * Story 2: sticky notes. Later stories extend this file; do not scatter
 * literals for these values.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative step applied by the +/− buttons and Ctrl/Cmd +/- (125%). */
export const ZOOM_STEP_FACTOR = 1.25;
/**
 * Sensitivity of Ctrl/Cmd + wheel and trackpad pinch:
 * zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY).
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/**
 * Distance from the starting point (world units) that must remain pannable
 * without an edge; used by far-travel tests.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* Story 2: sticky notes. */

/** Sticky note side length in world units (square notes). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when at most this many characters remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Screen pixels of pointer travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky note colours, keyed by name. */
export const STICKY_COLORS = {
  yellow: "#FFF59D",
  orange: "#FFCC80",
  green: "#C5E1A5",
  blue: "#90CAF9",
  pink: "#F48FB1",
  violet: "#CE93D8",
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = "yellow";
