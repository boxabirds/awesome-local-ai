/**
 * Product settings for the vidi6 board. Stories 2-5 add their own settings to
 * this file. Everything that the design calls a "named setting" lives here so
 * it can be changed in one place without a redesign.
 */

/** Smallest zoom the board allows (10%). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (400%). */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to pan without edges. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom values within this relative distance of a step value snap to it. */
export const ZOOM_STEP_SNAP_RELATIVE_EPSILON = 1e-9;

/** Multiplier turning a LINE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_LINE_PX = 32;

/** Multiplier turning a PAGE-mode wheel delta into CSS pixels. */
export const WHEEL_DELTA_MODE_PAGE_PX = 800;

/** Zoom -> percentage label conversion (100% is a zoom of 1). */
export const PERCENT = 100;

/** Dot-grid dot radius in screen pixels (used by the CSS background). */
export const GRID_DOT_RADIUS_PX = 1.2;

/** Size of the origin crosshair marker, in screen pixels. */
export const ORIGIN_MARKER_SIZE_PX = 16;

/** Sticky note edge length in world units (a square note). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit of characters kept in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once this many characters are left. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (world units == screen px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the text is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel that turns a press on a note into a drag. */
export const DRAG_THRESHOLD_PX = 3;

/**
 * The six note colours. Keys are the names stored in the document (and later
 * on the wire), values the fill used on screen.
 */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a freshly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
