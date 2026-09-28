/**
 * Product settings shared by the client and (later) the Worker.
 * Stories 2–5 add their own named settings to this file.
 */

/** Smallest zoom (screen pixels per world unit). 10 %. */
export const ZOOM_MIN = 0.1;

/** Largest zoom (screen pixels per world unit). 400 %. */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (toolbar buttons, keyboard shortcuts). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is verified to still work, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom fraction -> percentage (1 -> 100 %). */
export const PERCENT_PER_UNIT = 100;

/* ------------------------------------------------------------------ sticky */

/** Width and height of a new sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears when the remaining characters are at most this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (world px), used when the text is short. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size (world px); below this the text overflows. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset sticky colours, keyed by name. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created sticky note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
