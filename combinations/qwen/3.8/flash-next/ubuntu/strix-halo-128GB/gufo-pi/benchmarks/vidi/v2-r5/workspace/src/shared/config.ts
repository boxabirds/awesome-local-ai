/**
 * Product settings shared by the client and (from story 3) the Worker.
 * Stories 2-5 add further settings to this file.
 */

/** Smallest zoom level (screen pixels per world unit). Shown as 10%. */
export const ZOOM_MIN = 0.1;

/** Largest zoom level (screen pixels per world unit). Shown as 400%. */
export const ZOOM_MAX = 4;

/** One zoom step multiplies or divides the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is tested to work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom step results snap to ZOOM_STEP_FACTOR^n within this relative epsilon, so a step in then out is exact. */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** Multiplier used to render a zoom level as a whole-number percentage. */
export const PERCENT = 100;

/** Wheel deltaMode: one delta unit is one line (converted to pixels). */
export const WHEEL_PIXELS_PER_LINE = 16;

/** Wheel deltaMode: one delta unit is one page (converted to pixels). */
export const WHEEL_PIXELS_PER_PAGE = 800;

/** Radius, in screen pixels, of each dot in the grid (constant on screen at any zoom). */
export const GRID_DOT_RADIUS = 1;

/** Size, in screen pixels, of the origin crosshair marker drawn at world (0, 0). */
export const ORIGIN_MARKER_SIZE = 16;

/* --------------------------------------------------------- sticky notes ---- */

/** Width and height of a new sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note's text may contain. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest font size used for note text, in board units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest font size note text shrinks to; below this the text overflows with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, in toolbar order. */
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

/* ------------------------------------------------------- live collaboration ---- */

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: max acceptable latency for a change to reach every other screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
