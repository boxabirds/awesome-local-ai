/**
 * Product settings shared by the client and (later) the Worker.
 * Stories 2-5 add their own named settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Largest zoom level — shown as 400%. */
export const ZOOM_MAX = 4;
/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is verified to still work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* --- story 2: sticky notes ------------------------------------------------- */

/** Side length of a new sticky note in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (pixels at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below this the text overflows into a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel that turns a press on a note into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky colours, keyed by the name used in the accessible labels. */
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
