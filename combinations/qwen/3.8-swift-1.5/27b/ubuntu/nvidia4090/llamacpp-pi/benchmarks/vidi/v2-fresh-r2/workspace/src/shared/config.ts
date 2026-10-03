/**
 * Named product settings. Change a value here, not in feature code.
 * Stories 2+ add to this file.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom button/key step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Furthest distance in world units from the starting point that the board is
 * tested to pan without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom of the standard ("reset") view. */
export const ZOOM_RESET = 1;
/** Percent factor for the zoom label. */
export const PERCENT = 100;
/** Tolerance for snapping a stepped zoom to the exact value ZOOM_STEP_FACTOR^n. */
export const STEP_SNAP_EPSILON = 1e-9;
/** Pixels per wheel delta when deltaMode is LINE. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel delta when deltaMode is PAGE. */
export const WHEEL_PAGE_PX = 100;

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** Available sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Default colour for new sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
