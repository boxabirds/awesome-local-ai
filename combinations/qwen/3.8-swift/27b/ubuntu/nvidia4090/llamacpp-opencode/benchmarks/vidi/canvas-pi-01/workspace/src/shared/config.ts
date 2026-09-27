// Product settings for vidi6. All numbers that define board behaviour live here.

/** Minimum board zoom (10% of 1 screen pixel per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied per zoom step (buttons, Ctrl/Cmd +/-). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/trackpad zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) the board is verified to support. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Step zoom snaps to the nearest ZOOM_STEP_FACTOR^n within this many "steps". */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;
/** Percentage scaling for the zoom label. */
export const PERCENT = 100;
/** Pixels per wheel "line" delta (deltaMode LINE). */
export const WHEEL_LINE_DELTA_PIXELS = 16;
/** Pixels per wheel "page" delta (deltaMode PAGE). */
export const WHEEL_PAGE_DELTA_PIXELS = 100;

// ---- Sticky notes (story 2) ----

/** Sticky note side length in board (world) units: 200 x 200. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters a sticky note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter is visible while remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer travel (screen px) before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/** The six preset sticky colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ---- Live collaboration (story 3) ----

/** Soft simultaneous-editor capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change must appear on other screens within 1 second. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up: verification outage length. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * y-websocket closes a socket that receives no message for 30 s. An idle
 * client sends a tiny awareness "heartbeat" at this interval (well below the
 * 30 s watchdog) so the room's awareness relay keeps the connection alive
 * with no user activity (TC-29).
 */
export const AWARENESS_HEARTBEAT_MS = 10_000;
