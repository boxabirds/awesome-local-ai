/**
 * Product settings for vidi6. Stories 2-5 add to this file; keep every tunable here.
 */

/** Smallest zoom the camera can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the camera can reach (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (button or keyboard). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start point panning is verified to still work, in world units. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom step values snap to ZOOM_STEP_FACTOR^n within this absolute tolerance, so one step in then out returns exactly the previous zoom. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier turning a zoom ratio into a whole-number percentage. */
export const PERCENT_SCALE = 100;

/** Pixels per wheel delta unit when `WheelEvent.deltaMode === LINE` (10px per line). */
export const WHEEL_LINE_PIXELS = 10;

/** Pixels per wheel delta unit when `WheelEvent.deltaMode === PAGE` (one page). */
export const WHEEL_PAGE_PIXELS = 800;

/* ---- Story 2: sticky notes ---- */

/** Edge length of a sticky note in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters kept in a note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears when the remaining characters are at or below this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (px at 100% zoom) used by the auto-fit. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size (px at 100% zoom); below this text overflows and fades. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours, in toolbar order. Names are the schema values. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour a freshly created note gets. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
