// Named product settings for vidi6.
//
// Stories add their settings to this file so every tunable value lives in
// one place and can be changed without redesigning a component.

/** Smallest allowed zoom, as screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

/** Largest allowed zoom, as screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative zoom step used by the +/− buttons and Ctrl/Cmd + = / −. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Sensitivity of Ctrl/Cmd + scroll zooming.
 * The zoom factor for a wheel event is `exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Spacing between dot grid points, in world units. */
export const GRID_SPACING_WORLD = 24;

/**
 * Farthest a user may pan from the board's starting point while the board is
 * still expected to render crisply (PRD "No edges"). Used by tests to jump to
 * a distant location.
 */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_LINE_PX = 16;

/** Pixels per wheel "page" deltaMode unit, used to normalise wheel deltas. */
export const WHEEL_DELTA_PAGE_PX = 100;

// --- Story 2: sticky notes -------------------------------------------------

/** Sticky note side length, in world units (the note is a square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a note's text may hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when the remaining capacity is at or below this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note text font size, in px at 100% zoom (world units). */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer travel, in screen px, before a press on a note becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;

/** The six preset note colours, keyed by name (names are the stored values). */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

/** A preset note colour name. */
export type StickyColor = keyof typeof STICKY_COLORS;

/** Colour of newly created notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

// --- Story 3: live collaboration -------------------------------------------

/**
 * Soft board capacity: the design and tests target this many simultaneous
 * editors. Deliberately never enforced by the worker (live.over_capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** A change made on one client must be visible on every other within this. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** WebsocketProvider `maxBackoffTime` for reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays visible after a reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

// ---------------------------------------------------------------------------
// Story 4: persistence, compaction, load failure.
// ---------------------------------------------------------------------------

/** Story 4, design decision 2: SQLite schema version. */
export const STORAGE_SCHEMA_VERSION = 1;

/** Story 4: the update-log row count that triggers compaction (TC-17). */
export const COMPACTION_UPDATE_COUNT = 500;

/** Story 4: the update-log byte total that triggers compaction (design decision 4). */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Story 4: the snapshot size that forces chunking (design decision 5). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** Story 4: minimum interval between storage SELECT retry attempts (TC-26). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** Story 4: the note count the persistence path is explicitly tested at (TC-08, TC-21). */
export const PERSIST_TESTED_NOTES = 2000;

/** Story 4: a board of PERSIST_TESTED_NOTES must render within this of navigation start. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Length of the simulated network outage in the catch-up e2e test. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

// ---------------------------------------------------------------------------
// Story 5: share a board with others using a link.
// ---------------------------------------------------------------------------

/**
 * Story 5: rate limit for POST /api/boards, per visitor, per rolling period.
 * MUST stay in sync with the `ratelimits` binding in wrangler.jsonc
 * (enforced by tests/unit/create-board.test.ts, TC-03).
 */
export const BOARD_CREATE_LIMIT = 10;
export const BOARD_CREATE_PERIOD_SECONDS = 60;

/** Story 5: candidate draws for create-with-retry before giving up. */
export const CREATE_ID_MAX_ATTEMPTS = 3;

/** Story 5: end-to-end budget from "Create a board" click to a live board. */
export const CREATE_BUDGET_MS = 2000;

/** Story 5: how long the "Link copied" confirmation stays visible. */
export const LINK_COPIED_MS = 2000;

/**
 * Story 5: base delay for the board existence check retry (doubles, capped
 * at RECONNECT_MAX_BACKOFF_MS).
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// ---------------------------------------------------------------------------
// Story 7: select, move, resize and delete several objects at once.
// ---------------------------------------------------------------------------

/** Screen-space size (CSS px) of the selection bounding-box resize handles. */
export const HANDLE_SIZE_PX = 8;

/** Smallest a sticky note may be resized, in world units (its side). */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Largest any object may be resized, in world units (any dimension). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow-key nudge step, in world units (no Shift). */
export const NUDGE_STEP_WORLD = 1;

/** Arrow-key nudge step, in world units (Shift held). */
export const NUDGE_LARGE_STEP_WORLD = 10;

// ---------------------------------------------------------------------------
// Story 8: undo and redo my own changes without undoing anyone else's.
// ---------------------------------------------------------------------------

/**
 * Story 8: merge window for the per-client undo history (design decision 3).
 * Local changes within this time of each other (e.g. a typing burst) collapse
 * into one undo step; `boundary()` always forces a step break.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * Story 8: maximum number of undo steps kept per client (design decision 4).
 * The newest step evicts the oldest, and the redo history is kept in the
 * same bound.
 */
export const UNDO_MAX_STEPS = 200;

// ---------------------------------------------------------------------------
// Story 9: write free text anywhere on the board.
// ---------------------------------------------------------------------------

/** Maximum width of an auto-width text box, in world units. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum width a text object may be resized to, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Hard character limit for a text object (PRD: at least 5,000). */
export const TEXT_MAX_CHARS = 5000;

/**
 * Text size presets: the font size in world units (px at 100% zoom), on the
 * same scale as the sticky font.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

/** One of the {@link TEXT_SIZES} preset names. */
export type TextSize = keyof typeof TEXT_SIZES;

/** Size used for newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Text line height, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;

/** The board's standard font, used for text objects and measuring. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

// ---------------------------------------------------------------------------
// Story 10: draw shapes and connect them with arrows that follow when moved.
// ---------------------------------------------------------------------------

/** The three shape kinds (shapes.kind). */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

/** One of the {@link SHAPE_KINDS}. */
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** Default size (world units, square) for a click-created shape. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/**
 * Minimum shape size in either axis, in world units. A drag smaller than this
 * in one axis is treated as a click (shapes.size).
 */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Hard character limit for a shape's label (shapes.label). */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Named fill colours for shapes (shape.style). `none` means no fill. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

/** One of the {@link SHAPE_FILL_COLORS} names. */
export type FillColor = keyof typeof SHAPE_FILL_COLORS;

/** Named outline colours for shapes (shape.style). */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

/** One of the {@link SHAPE_STROKE_COLORS} names. */
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Fill and outline of a newly created shape. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** Shape outline thickness, in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** Inner padding of a shape's label box, in world units. */
export const SHAPE_LABEL_PADDING_WORLD = 12;

/**
 * Minimum arrow length, in world units. A released drag shorter than this
 * (from to to) creates nothing (connector.create_free).
 */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/**
 * Screen-space hit tolerance around the arrow's centre line for body
 * selection (connector.select_body): the hit band is ±this many screen px.
 */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Arrow line thickness, in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Arrowhead size, in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Radius, in screen px, of the connector tool's attach dots. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/** Radius, in screen px, of a selected arrow's end handles. */
export const CONNECTOR_HANDLE_RADIUS_PX = 5;

/**
 * The connector tool's snap radius, in screen px: a release within this
 * distance of another object's attach point re-attaches the end there
 * (connector.attach). Dots outside it stay free.
 */
export const CONNECTOR_SNAP_RADIUS_PX = 12;
