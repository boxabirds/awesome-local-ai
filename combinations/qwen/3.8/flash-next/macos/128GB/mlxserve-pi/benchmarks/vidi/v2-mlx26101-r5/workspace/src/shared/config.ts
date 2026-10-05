// Product settings for vidi6. Stories 2-5 add their own settings to this file.

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level (screen pixels per world unit) — shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the starting point panning is guaranteed (and tested). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ------------------------------------------------------------------ sticky notes (story 2) */

/** Sticky note side length, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Longest note text, in characters. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (= px on screen at 100 % zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size the auto-fit shrinks to. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement that turns a press into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/** Inner padding of a sticky note, in world units (extra to the design list). */
export const STICKY_PADDING_WORLD = 12;
/** The six preset note colours; the key is the name stored in the document. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
