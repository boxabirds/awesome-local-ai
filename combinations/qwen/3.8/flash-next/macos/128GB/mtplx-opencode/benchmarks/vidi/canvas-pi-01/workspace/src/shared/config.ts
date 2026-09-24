/**
 * Product settings shared by the client (and, later, the Worker).
 * These are the "settings" named in the story designs: zoom limits, step size,
 * grid spacing. Changing a value here is the single place a designer can tune
 * the board without a redesign (PRD "Settings").
 */

/** Smallest zoom factor the board can reach (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom factor the board can reach. */
export const ZOOM_MAX = 4;

/** Multiplicative size of one zoom step (a step in multiplies by this). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom sensitivity: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot-grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far the unbounded-board requirement is tested (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* ---- Story 2 · sticky notes (design "Named settings") --------------------
 * These are the story-2 product settings, defined once here so a designer can
 * retune notes without a redesign (PRD "Settings"). */

/** Sticky note edge length in world units (notes are square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum characters kept in one note; extra characters are dropped. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter appears once the remaining budget is <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size, in world units (at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size before text is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by their accessible name. */
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

/* ---- Story 3 · live collaboration (design "Named settings") --------------
 * These are the story-3 product settings, defined once here so a designer can
 * retune live sync without a redesign (PRD "Constraints"). Tests must use
 * these rather than hard-coded numbers (PRD "Capacity setting"). */

/**
 * Soft simultaneous-editor capacity. Design + test target only; never
 * enforced (PRD live.over_capacity — a 6th person is not turned away).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/**
 * Change-delivery budget: sender screen → receiver screen (PRD
 * live.propagate / live.converge). Used as the e2e `expect.poll` timeout.
 */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Reconnect backoff ceiling, passed to the y-websocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" confirmation shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** The outage length used by the flaky-Wi-Fi catch-up test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * The WebSocket path prefix a board's room lives under. The Worker forwards
 * `/api/rooms/<id>` (with a well-formed id) to the board's Durable Object and
 * serves everything else from assets.
 */
export const ROOM_PATH_PREFIX = '/api/rooms/';

/**
 * Derive the room WebSocket **server base** for a board from the page origin,
 * so development, preview and production all reach the same Worker. `ws`/`wss`
 * is chosen from the page protocol. When a `VITE_BOARD_WS_ORIGIN` override is
 * set (preview/dev pointing at an external `wrangler dev`), its origin is used
 * instead of the page's.
 *
 * Returned **without** the board id: this is the first argument to
 * `WebsocketProvider`, which appends `/<roomname>` itself (design "Client
 * connection and status").
 */
export function boardWsServer(boardId: string): string {
  void boardId;
  const override = import.meta.env?.VITE_BOARD_WS_ORIGIN as string | undefined;
  const pageUrl =
    typeof window !== 'undefined' && window.location
      ? new URL(window.location.href)
      : new URL('http://localhost:5173/');
  const target = override && override.length > 0 ? new URL(override) : pageUrl;
  const scheme = target.protocol === 'https:' ? 'wss:' : 'ws:';
  // Trim the trailing slash: `WebsocketProvider` joins `serverUrl + '/' + room`.
  return `${scheme}//${target.host}${ROOM_PATH_PREFIX}`.replace(/\/$/, '');
}
