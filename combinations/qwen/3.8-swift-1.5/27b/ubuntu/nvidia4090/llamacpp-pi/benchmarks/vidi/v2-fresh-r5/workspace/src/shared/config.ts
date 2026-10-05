// Named product settings for vidi6. Stories 2-5 add to this file.

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter appears when remaining chars <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;
/** Screen pixels of pointer movement before a drag starts. */
export const DRAG_THRESHOLD_PX = 3;
/** The six sticky note colours. */
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

/** Minimum board zoom (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (screen pixels per world unit). */
export const ZOOM_MAX = 4;
/** Multiplicative factor applied for one zoom step in or out. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a wheel/pinch = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Pixels per wheel "line" delta (deltaMode === 1), converted to pixels. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel "page" delta (deltaMode === 2), converted to pixels. */
export const WHEEL_PAGE_PX = 200;
/** Far-test extent (board units) the board must pan without an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/* --- Story 3: live collaboration --- */

/** Soft capacity: design + test target for simultaneous editors, never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** Latency budget (ms) for a change to appear on other connected screens (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Maximum backoff (ms) between WebSocket reconnect attempts. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long (ms) the green "Connected" badge is shown after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage duration (ms) used by the catch-up verification test (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait (ms) for eventual-consistency assertions in e2e tests. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/* --- Story 4: persistence --- */

/** Compact the update log when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when the log's total bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size: keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A LoadFailed room retries loading at most this often (per new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Tested board size for persist.large_board (PRD). */
export const PERSIST_TESTED_NOTES = 2000;
/** Open-time budget (ms) for a PERSIST_TESTED_NOTES board (PRD persist.large_board). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage schema (storage_meta.storage_schema_version). */
export const STORAGE_SCHEMA_VERSION = 1;

/* --- Story 5: sharing --- */

/** Creation budget (ms): click New board → new board visible (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long (ms) the Share panel shows "Link copied" (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** Base backoff (ms) for board existence checks while the service is unreachable; doubles per attempt, capped at RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/* --- Story 7: multi-select, move, resize, delete --- */

/** Screen pixel size of selection handles. */
export const HANDLE_SIZE_PX = 8;
/** Minimum size in world units for sticky notes. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum size in world units for any object. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Nudge step in world units (arrow keys). */
export const NUDGE_STEP_WORLD = 1;
/** Large nudge step in world units (Shift+arrow keys). */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* --- Story 8: Undo & redo --- */

/** Typing pause (ms) that ends a typing burst (undo.typing). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Number of undo steps kept per user (undo.limit). */
export const UNDO_MAX_STEPS = 200;

/* --- Story 10: Shapes and connectors --- */

/** The three shape kinds. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];
/** Default size (width = height) in world units for click-created shapes. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Minimum drag size in world units; smaller drags create a default-size shape. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters in a shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Stroke width in world units for shapes. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Fill colour palette for shapes. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
export type FillColor = keyof typeof SHAPE_FILL_COLORS;
/** Stroke colour palette for shapes. */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export type StrokeColor = keyof typeof SHAPE_STROKE_COLORS;
/** Default fill for new shapes. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
/** Default stroke for new shapes. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** Minimum connector length in world units. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Hit tolerance in screen pixels for selecting a connector. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Stroke width in world units for connectors. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius in screen pixels for connection dots. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/* --- Story 9: Free text --- */

/** Maximum automatic width in board units (text wraps beyond this). */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum fixed width in board units (set by handle drag). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets in board units. */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Default text size for new text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height multiplier for text objects. */
export const TEXT_LINE_HEIGHT = 1.3;
/** Font family for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
