/**
 * Product settings for vidi6.
 *
 * All magic numbers live here so they can be changed in one place without a
 * redesign. Stories 2+ add their settings to this file.
 */

// ---- Board camera (story 1) ----------------------------------------------

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative step used by the +/- buttons and Ctrl/Cmd +/- keys. */
export const ZOOM_STEP_FACTOR = 1.25;
/** zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY) */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far the board is required to pan without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Epsilon used when a stepped zoom is snapped to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Camera zoom -> percentage label multiplier. */
export const PERCENT = 100;

/** Wheel deltaMode=LINE (DOM lines) converted to CSS pixels. */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Wheel deltaMode=PAGE (one page) converted to CSS pixels. */
export const WHEEL_PAGE_DELTA_PIXELS = 800;

// ---- Rendering (story 1) -------------------------------------------------

/** Radius of a dot-grid dot, in CSS pixels (screen space). */
export const GRID_DOT_RADIUS_SCREEN = 1.5;
/** Dot-grid dot colour. */
export const GRID_DOT_COLOR = "#c3c8cf";
/** Size of the origin crosshair marker, in world units. */
export const ORIGIN_MARKER_SIZE_WORLD = 16;

// ---- Sticky notes (story 2) ----------------------------------------------

/** Edge length of a new sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Longest note text the board keeps. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The "n/1000" counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (so it scales with board zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size the board will shrink text to. */
export const STICKY_FONT_MIN_PX = 10;
/** Padding between the note edge and its text, in world units. */
export const STICKY_TEXT_PADDING_WORLD = 12;
/** Pointer movement that turns a press on a note into a drag, in screen pixels. */
export const DRAG_THRESHOLD_PX = 3;
/** The six note colours, by name. */
export const STICKY_COLORS = {
  yellow: "#FFF59D",
  orange: "#FFCC80",
  green: "#C5E1A5",
  blue: "#90CAF9",
  pink: "#F48FB1",
  violet: "#CE93D8",
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = "yellow";
