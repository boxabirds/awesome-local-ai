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

/* --------------------------------------------------------------------- *
 * Story 3: live collaboration.
 * --------------------------------------------------------------------- */

/**
 * How many people a board is designed and tested for at the same time. This
 * is a soft number: it sizes the tests and the design, it never refuses a
 * connection (PRD live.over_capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * The change-delivery budget, measured from the moment a change appears on
 * the sender's screen to the moment it appears on a receiver's (PRD
 * live.propagate).
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1_000;

/** Upper bound of the provider's reconnect backoff, in milliseconds. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays up after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2_000;

/** The outage a catch-up test cuts, matching the PRD's live.catch_up check. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/* --------------------------------------------------------------------- *
 * Story 4: board persistence.
 * --------------------------------------------------------------------- */

/**
 * How long a room waits for its board before it stops trying.
 *
 * The read is synchronous inside the isolate, so this is not a queue timeout:
 * it is the point where a slow or wedged storage read stops being "slow" and
 * becomes a reason to refuse the connection. By the time it passes, the client
 * has already started its own retries, which is why answering late is no better
 * than answering nothing.
 */
export const LOAD_TIMEOUT_MS = 1_000;

/**
 * How many board updates a room buffers before writing them down.
 *
 * Small boards gain little from buffering and pay for it in risk; large boards
 * write megabytes per checkpoint and cannot afford one per keystroke. Eight is
 * the compromise that is tested, not the number that was guessed.
 */
export const FLUSH_UPDATE_THRESHOLD = 8;

/**
 * How long buffered updates may sit before they are written anyway.
 *
 * A room that goes quiet after one change still has to make that change
 * durable, and its sockets have about ten seconds of hibernation left before
 * the instance is torn down. Half a second keeps the delay far inside that.
 */
export const FLUSH_INTERVAL_MS = 500;

/**
 * The largest frame a room will look at, in bytes.
 *
 * A board update is normally a few hundred bytes; a whole board travels in the
 * reply, not in a request, so a request over this size is either a client that
 * has lost its mind or somebody probing the socket. Refusing it is rule 1, and
 * it is the reason the room never has to reason about a giant buffer.
 */
export const MAX_MESSAGE_BYTES = 128 * 1024;
