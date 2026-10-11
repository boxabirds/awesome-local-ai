/**
 * Product settings for vidi6. Every tunable value lives here so later stories can
 * change behaviour without a redesign (see spec/stories/.../design.md "Named settings").
 */

// ---------------------------------------------------------------------------
// Camera / zoom
// ---------------------------------------------------------------------------

/** Minimum zoom (screen pixels per world unit) — shown as 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom (screen pixels per world unit) — shown as 400%. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard step). */
export const ZOOM_STEP_FACTOR = 1.25;
/** zoom factor for a wheel/pinch = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** zoomPercent = Math.round(zoom * ZOOM_PERCENT_BASE). */
export const ZOOM_PERCENT_BASE = 100;
/** Relative tolerance for snapping a stepped zoom to ZOOM_STEP_FACTOR^n. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Wheel delta translation
// ---------------------------------------------------------------------------

/** CSS pixels for one line unit when WheelEvent.deltaMode === DELTA_MODE_LINE. */
export const WHEEL_LINE_DELTA_PX = 16;
/** CSS pixels for one page unit when WheelEvent.deltaMode === DELTA_MODE_PAGE. */
export const WHEEL_PAGE_DELTA_PX = 800;
/** WheelEvent.deltaMode values. */
export const DELTA_MODE_PIXEL = 0;
export const DELTA_MODE_LINE = 1;
export const DELTA_MODE_PAGE = 2;

// ---------------------------------------------------------------------------
// Board surface
// ---------------------------------------------------------------------------

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Dot radius as rendered on screen, in CSS pixels (constant across zoom). */
export const GRID_DOT_RADIUS_PX = 1.2;
/** How far the board is required to pan without hitting an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// ---------------------------------------------------------------------------
// Sticky notes
// ---------------------------------------------------------------------------

/** Sticky note size in world units (square: 200 x 200). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters of text a note may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in board units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size that is still readable; below this the text fades out. */
export const STICKY_FONT_MIN_PX = 10;
/** Screen pixels a pointer must move before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset note colours, keyed by the name used in the document. */
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
/** Padding between the note edge and its text, in world units. */
export const STICKY_TEXT_PADDING_WORLD = 12;
/** Schema version written to `meta.schemaVersion` (story 4 persists this format). */
export const BOARD_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** First-use navigation hint text. */
export const NAVIGATION_HINT_TEXT =
  'Drag to move around · Ctrl/Cmd + scroll or pinch to zoom';
