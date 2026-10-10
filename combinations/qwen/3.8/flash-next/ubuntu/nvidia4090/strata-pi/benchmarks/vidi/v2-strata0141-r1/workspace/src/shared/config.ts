/**
 * Product settings for vidi6. Every named setting lives here so later stories
 * can change behaviour without redesign (stories 2-5 add to this file).
 */

/** Smallest zoom the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Largest zoom the board can reach. */
export const ZOOM_MAX = 4;
/** Multiplicative size of one zoom step (button / keyboard step). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel/pinch zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** How far from the start panning is guaranteed (and tested) to work. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom percentage is reported as `zoom * PERCENT`, rounded. */
export const PERCENT = 100;

/**
 * `zoomStep` snaps the result to the nearest power of ZOOM_STEP_FACTOR when it
 * is within this distance, so zooming in then out returns exactly the previous
 * zoom (no floating point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** wheel deltaMode constants (wheel events report lines or pages, not pixels). */
export const WHEEL_LINE_PX = 16;
export const WHEEL_PAGE_PX = 800;

/** Numerical tolerance used when comparing camera coordinates. */
export const CAMERA_EPSILON = 1e-6;

/* ---------------------------------------------------------------------------
 * Story 2: sticky notes. Every sticky setting lives here.
 * ------------------------------------------------------------------------ */

/** A new sticky note is a STICKY_SIZE_WORLD x STICKY_SIZE_WORLD square. */
export const STICKY_SIZE_WORLD = 200;
/** Gap between the note edge and its text, in board units. */
export const STICKY_PADDING_WORLD = 16;
/** Maximum number of characters a note's text can hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter appears when this many characters (or fewer) remain. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in board units (so it scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; below it text is clipped with a bottom fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen pixels) before a press becomes a drag. */
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

/** Colour of a newly created note. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** The six colours in swatch order. */
export const STICKY_COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Accessible label/tooltip for a colour: `Yellow colour`, `Pink colour`, ... */
export function stickyColorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

/* ---------------------------------------------------------------------------
 * Story 3: live collaboration. Every live setting lives here.
 * ------------------------------------------------------------------------ */

/**
 * Soft simultaneous-editor capacity (anchor `live.capacity`).
 *
 * It is a design and test target only: nothing in the product counts
 * participants or turns a 6th person away (`live.over_capacity`). Tests read
 * this setting instead of a hard-coded number.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must be visible on every other screen within this many ms. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Upper bound of the y-websocket exponential reconnect backoff. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" confirmation stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** The outage length the catch-up requirement is verified with. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/**
 * Functional wait used by every e2e test in every story: wall-clock latency is
 * measured and logged against LIVE_UPDATE_LATENCY_BUDGET_MS, never asserted,
 * because the model, the browsers and the server share one machine.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;
/**
 * Nightly only (TC-29): how long two boards must sit idle, connected, with no
 * user activity. Longer than the protocol's own keep-alive window, so a
 * connection that only survives because someone is typing would fail.
 */
export const IDLE_STABILITY_TEST_MS = 45_000;
/** Nightly only (TC-30): how long the capacity soak keeps editing. */
export const CAPACITY_SOAK_MS = 60_000;
/**
 * Every live-board request goes under this path prefix, with the board address
 * after it: the Worker routes it to that board's room, the browser opens it as
 * a WebSocket.
 */
export const ROOM_ROUTE_PREFIX = '/api/rooms/';
/** A board someone is on is addressed as `/b/<boardId>`. */
export const BOARD_PATH_PREFIX = '/b/';
