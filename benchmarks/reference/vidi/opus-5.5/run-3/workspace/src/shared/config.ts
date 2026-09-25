// All named product settings live here. Later stories add to this file.

/** Minimum board zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + =/−). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin the board is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE. */
export const WHEEL_LINE_HEIGHT_PX = 16;
/** Radius of a grid dot in screen pixels. */
export const GRID_DOT_RADIUS_PX = 1;
/** Below this on-screen spacing (px) the grid dots fade out proportionally, so a dense grid does not turn into a grey wash. */
export const GRID_FADE_BELOW_SPACING_PX = 12;

// Story 2 — sticky notes.

/** Side length of a (square) sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters (UTF-16 code units) in one note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when the remaining characters are <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size in world units (= px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; text that still does not fit is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Inner padding between the note edge and its text, in world units. */
export const STICKY_PADDING_WORLD = 16;
/** Line height of note text, as a multiple of the font size. */
export const STICKY_LINE_HEIGHT = 1.25;
/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
