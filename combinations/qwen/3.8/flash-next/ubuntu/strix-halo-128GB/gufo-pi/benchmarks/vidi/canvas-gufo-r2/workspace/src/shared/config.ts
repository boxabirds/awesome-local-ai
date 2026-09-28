/**
 * Product settings shared by the client and (later) the worker.
 * Every tunable number for story 1 lives here; stories 2-5 add their own.
 */

/** Smallest allowed zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom applied by one button / keyboard step. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Wheel zoom: zoom factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot-grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start the board is required to still work (world units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Wheel `deltaMode === DOM_DELTA_LINE`: pixels per line. */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Wheel `deltaMode === DOM_DELTA_PAGE`: pixels per page (fraction of viewport height). */
export const WHEEL_PAGE_HEIGHT_FRACTION = 0.9;

/** Conversions used by the zoom indicator. */
export const PERCENT_PER_ZOOM = 100;

/**
 * `zoomStep` snaps the resulting zoom to the nearest `ZOOM_STEP_FACTOR^n`
 * within this relative epsilon, so a step in followed by a step out returns
 * to exactly the previous zoom (no floating-point drift).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

// ----------------------------------------------------------- sticky notes (story 2)

/** Sticky note width and height in world units. */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters in a sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Character counter appears when remaining characters <= this value. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;

/** Minimum pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** Six preset sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour for newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// ----------------------------------------------------------- live collaboration (story 3)

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1 second budget for change delivery. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage duration. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ----------------------------------------------------------- persistence (story 4)

/** Number of un-compacted update rows that triggers a snapshot compaction. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Total bytes of un-compacted update rows that triggers a snapshot compaction. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Snapshot rows are written in chunks of this size so a single row never comes
 * near the SQLite-backed Durable Object row size limit. Chunk size is the first
 * escalation knob if a row-size limit is ever hit.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** How long a room remembers a failed board load before retrying on a new connection. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** Board size the persistence path is tested at; also the large-board load test size. */
export const PERSIST_TESTED_NOTES = 2000;

/** Client-side budget from navigation to full render at PERSIST_TESTED_NOTES. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Version recorded in `board_meta`; future migrations branch on it. */
export const STORAGE_SCHEMA_VERSION = 1;

// ----------------------------------------------------------- share / create (story 5)

/** Maximum boards a visitor may create within BOARD_CREATE_PERIOD_SECONDS. */
export const BOARD_CREATE_LIMIT = 10;

/** Rate limit window in seconds; must match wrangler.jsonc ratelimits. */
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** Maximum ID collision retries when creating a board. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** PRD share.create budget from click to board open (ms). */
export const CREATE_BUDGET_MS = 2000;

/** Duration "Link copied" is shown before reverting (ms). */
export const LINK_COPIED_MS = 2000;

/** Base delay for board existence check retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ----------------------------------------------------------- selection & transforms (story 7)

/** Resize-handle edge length in screen pixels (constant at any zoom). */
export const HANDLE_SIZE_PX = 8;

/** Smallest a sticky note may be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any board object may be resized to, in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ----------------------------------------------------------- undo (story 8)

/** Typing pause (ms) that ends an undo capture window (groups typing bursts). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum number of undo steps retained per tab. */
export const UNDO_MAX_STEPS = 200;
