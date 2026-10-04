// Product settings shared across the app. Stories 2-5 add to this file.

/** Minimum board zoom, in screen pixels per world unit (10%). */
export const ZOOM_MIN = 0.1;

// --- Story 2: Sticky notes ---

/** Size of a sticky note in world units (square). */
export const STICKY_SIZE_WORLD = 200;

/** Maximum number of characters a sticky note can hold. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** Counter shows when remaining characters <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Maximum font size in px (at 100% zoom, board units). */
export const STICKY_FONT_MAX_PX = 24;

/** Minimum font size in px (at 100% zoom, board units). */
export const STICKY_FONT_MIN_PX = 10;

/** Minimum pointer movement in screen px before a drag starts. */
export const DRAG_THRESHOLD_PX = 3;

/** The six available sticky note colours. */
export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;

export type StickyColor = keyof typeof STICKY_COLORS;

/** Default colour for new sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Maximum board zoom, in screen pixels per world unit (400%). */
export const ZOOM_MAX = 4;

/** Multiplicative factor applied per zoom step (button or Ctrl/Cmd + = / -). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Zoom factor for a wheel with Ctrl/Cmd held = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;

/** Minimum panning extent (world units from the starting point) that must stay usable. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// --- Story 3: Live collaboration ---

/** Soft capacity: design + test target, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;

/** PRD live.propagate: 1 second change delivery budget. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;

/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** Green badge duration after reconnect. */
export const CONNECTED_CONFIRMATION_MS = 2000;

/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Story 4: Persistence ---

/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;

/** Compact when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/** Snapshot chunk size; keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;

/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;

/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;

/** Versions the storage tables (storage_meta key: storage_schema_version). */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: Share a board with others using a link ---

/** PRD share.create: click-to-board time budget. */
export const CREATE_BUDGET_MS = 2000;

/** PRD share.copy: "Link copied" confirmation duration. */
export const LINK_COPIED_MS = 2000;

/** Base backoff for board existence check retry (doubles up to RECONNECT_MAX_BACKOFF_MS). */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: Multi-select, move, resize and delete ---

/** Size of resize handles in screen pixels. */
export const HANDLE_SIZE_PX = 8;

/** Minimum size for a sticky note in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;

/** Maximum size for any object in world units. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** Arrow key nudge step in world units. */
export const NUDGE_STEP_WORLD = 1;

/** Shift+arrow key nudge step in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Story 8: Undo and redo my own changes ---

/** Typing pause (ms) that ends a burst: typing without a pause of at least this long is one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/** Maximum number of undo steps kept per user; the oldest step is discarded beyond this. */
export const UNDO_MAX_STEPS = 200;

// --- Story 9: Write free text anywhere on the board ---

/** Maximum automatic width in world units; longer lines wrap at this width. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** Minimum width for fixed-width text in world units (side-handle drag clamp). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** Maximum characters a text object can hold. */
export const TEXT_MAX_CHARS = 5000;

/** Font size presets in world units (px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Default size for new text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/** Line height factor applied to the font size. */
export const TEXT_LINE_HEIGHT = 1.3;

/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/** Horizontal padding added to the longest measured line for auto width. */
export const TEXT_PADDING_X_WORLD = 4;

/** Average glyph width as a fraction of the font size (measurement fallback). */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.5;

/**
 * Local user id for object attribution. Story 6 (user identity) is not in
 * this build; the local client uses a fixed placeholder id.
 */
export const LOCAL_USER_ID = 'local';

// --- Story 10: Draw shapes and connect them with arrows ---

/** The three shape kinds a user can draw. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;

/** Standard size (world units) for a shape created by clicking. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;

/** Minimum size (world units, either dimension) kept as a drawn drag. */
export const SHAPE_MIN_SIZE_WORLD = 20;

/** Maximum characters a shape label can hold. */
export const SHAPE_LABEL_MAX_CHARS = 500;

/** Shape outline width in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;

/** The six shape fill colours plus "no fill". */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;

/** The six shape outline colours. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;

export type FillColor = keyof typeof SHAPE_FILL_COLORS;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;

/** Default fill for new shapes. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';

/** Default outline for new shapes. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';

/** Minimum length (world units) for a created arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;

/** Screen-pixel tolerance for selecting an arrow by clicking near its line. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;

/** Arrow line width in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;

/** Arrowhead size in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;

/** Radius (screen px) of connector hover dots. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Story 11: Sketch freehand with a pen ---

/** The six pen colours. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;

/** Pen thicknesses in world units. */
export const PEN_THICKNESS_WORLD = {
  thin: 2,
  medium: 4,
  thick: 8,
} as const;

/** Default pen colour. */
export const DEFAULT_PEN_COLOR = 'black' as const;

/** Default pen thickness. */
export const DEFAULT_PEN_THICKNESS = 'medium' as const;

/** Smoothing tolerance in screen pixels (at drawing zoom). */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;

/** Maximum recorded points per stroke part before splitting. */
export const STROKE_MAX_POINTS = 5000;

/** Screen-pixel tolerance for selecting a stroke by clicking near its line. */
export const STROKE_HIT_TOLERANCE_PX = 6;

/** Minimum size for a stroke object in world units. */
export const STROKE_MIN_SIZE_WORLD = 4;
