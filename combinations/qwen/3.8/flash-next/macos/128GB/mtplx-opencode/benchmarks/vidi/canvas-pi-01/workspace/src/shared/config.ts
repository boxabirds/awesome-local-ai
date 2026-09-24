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

/*
 * Story 7 · multi-select, move, resize, nudge and delete (design "Named
 * settings added"). These are the story-7 product settings, defined once here
 * so a designer can retune selection and transform behaviour without a
 * redesign (PRD "Settings").
 */

/** Resize-handle edge length in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;

/** Smallest sticky-note edge in world units (a note cannot shrink below it). */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any board object may grow to, in world units (a PRD upper bound). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** One arrow-key nudge, in world units. */
export const NUDGE_STEP_WORLD = 1;

/** A Shift+arrow nudge, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* ---- Story 10 · shapes and connectors (design "Named settings added") ----
 * The story-10 product settings, defined once here so a designer can retune
 * shapes and arrows without a redesign (PRD "Settings"). Colours are *tokens*:
 * the model stores the token and the renderer looks the colour up in the map,
 * so a recolour is a short sync message rather than a hex string.
 */

/** The three shape kinds this build draws, in the order the Shape menu lists. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

/** A click, or a drag below the minimum size, drops a shape this wide/tall. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** The smallest shape a drag may size; anything smaller uses the default. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** A shape label is clamped to this many characters (PRD shape.label_limit). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Shape outline thickness, in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** The six shape fills plus `none` (transparent), keyed by accessible name. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

/** The six outline colours offered beside the fills. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

/** A fill token (including `none`); a shape's style stores one of these. */
export type ShapeFill = keyof typeof SHAPE_FILL_COLORS;

/** An outline token. */
export type ShapeStroke = keyof typeof SHAPE_STROKE_COLORS;

/** The fill a new shape gets: a plain white shape … */
export const DEFAULT_SHAPE_FILL: ShapeFill = 'white';

/** … and the dark outline that keeps it readable (PRD "with a dark outline"). */
export const DEFAULT_SHAPE_STROKE: ShapeStroke = 'dark';

/**
 * How far from a connector's line a click still selects it, in *screen* pixels
 * (PRD shape.arrow_select: 5 px selects, 7 px does not). Divided by the zoom to
 * get the world-space tolerance, so precision does not depend on the zoom level.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** A connector shorter than this is refused (PRD conn.short_drag). */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** Connector line thickness, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** The arrowhead's stem length, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** The radius of the four attachment dots, in screen px (constant at any zoom). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

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

/* ---- Story 5 · sharing (design "Named settings added") ------------------
 * These are the story-5 product settings for board creation and sharing.
 * BOARD_CREATE_PERIOD_SECONDS must mirror the `BOARD_CREATE_LIMITER` period in
 * `wrangler.jsonc`; TC-03 asserts they stay equal. */

/** Boards a single visitor may create within the window (PRD share.rate_limit). */
export const BOARD_CREATE_LIMIT = 10;

/** Window for the creation limit, in seconds (matches wrangler ratelimits). */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** How many fresh ids `createWithRetries` will try before giving up. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create — the create-and-open budget for a typical connection. */
export const CREATE_BUDGET_MS = 2000;

/** How long the Share panel shows "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;

/** First backoff interval when a board-existence check cannot reach the service. Doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* ---- Story 4 · persistence (design "Named settings added") --------------
 * These are the story-4 product settings for board persistence. */

/** Compact when this many update log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Snapshot chunk size — keeps every row well under the platform per-row limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** LoadFailed room retries load at most this often (ms). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** PRD persist.large_board — tested board size. */
export const PERSIST_TESTED_NOTES = 2000;

/** PRD persist.large_board — open-time target (ms). */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Storage schema version for the SQLite tables. */
export const STORAGE_SCHEMA_VERSION = 1;

/* ---- Story 9 · free text objects (design "Named settings added") --------
 * These are the story-9 product settings for free text written anywhere on the
 * board, defined once here so a designer can retune text without a redesign. */

/** The largest an auto-width text box may grow to, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a fixed-width text box may be dragged to, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters kept in one text object; extra characters are dropped. */
export const TEXT_MAX_CHARS = 5000;

/** The four font-size presets, keyed by their accessible name. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** The size a freshly created text object starts at. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height as a multiple of the font size (drives the box height). */
export const TEXT_LINE_HEIGHT = 1.3;

/** The font a text object is measured and rendered with. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Average glyph width as a fraction of the font size, used only when no canvas
 * is available to measure real text (jsdom unit tests, headless fallbacks).
 */
export const TEXT_GLYPH_WIDTH_RATIO = 0.5;

/* ---- Story 8 · undo / redo (design "Named settings") --------------------
 * These are the story-8 product settings, defined once here so a designer can
 * retune the personal history without a redesign (PRD "Settings"). */

/**
 * The typing pause that ends a burst: consecutive edits to one object that are
 * `UNDO_CAPTURE_TIMEOUT_MS` or more apart start a fresh undo step, while a
 * faster run merges into the current step (PRD undo.typing).
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** How many undo steps a personal history keeps before the oldest is dropped. */
export const UNDO_MAX_STEPS = 200;

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
