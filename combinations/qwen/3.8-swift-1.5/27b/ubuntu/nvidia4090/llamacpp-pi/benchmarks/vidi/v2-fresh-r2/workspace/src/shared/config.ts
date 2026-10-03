/**
 * Named product settings. Change a value here, not in feature code.
 * Stories 2+ add to this file.
 */

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** One zoom button/key step multiplies (or divides) the zoom by this factor. */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd wheel zoom: factor = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Furthest distance in world units from the starting point that the board is
 * tested to pan without reaching an edge. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Zoom of the standard ("reset") view. */
export const ZOOM_RESET = 1;
/** Percent factor for the zoom label. */
export const PERCENT = 100;
/** Tolerance for snapping a stepped zoom to the exact value ZOOM_STEP_FACTOR^n. */
export const STEP_SNAP_EPSILON = 1e-9;
/** Pixels per wheel delta when deltaMode is LINE. */
export const WHEEL_LINE_PX = 16;
/** Pixels per wheel delta when deltaMode is PAGE. */
export const WHEEL_PAGE_PX = 100;

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size for sticky note text (px at 100% zoom). */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 3;
/**
 * Story 3: live collaboration settings.
 */
/**
 * Simultaneous-editor capacity (soft). Design and test target only — never
 * enforced; a 6th or later participant is never refused.
 */
export const MAX_CONCURRENT_EDITORS = 5;
/** 1 second change-delivery budget (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Passed to WebsocketProvider maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** Green "Connected" badge duration after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** PRD live.catch_up verification outage. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Available sticky note colours. */
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

/**
 * Story 4: persistence settings.
 */
/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Keeps every snapshot chunk row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Storage schema version. */
export const STORAGE_SCHEMA_VERSION = 1;

/**
 * Story 7: multi-selection, group move/resize, nudge.
 */
/** Screen-space size of a bounding-box resize handle (px at any zoom). */
export const HANDLE_SIZE_PX = 8;
/** Minimum size in board units for a sticky note (resize lower bound). */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum size in board units for any object type (resize upper bound). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow-key nudge step in board units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge step in board units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/**
 * Story 5: share a board with others using a link.
 */
/** PRD share.create: click-to-board budget (logged in e2e, not asserted). */
export const CREATE_BUDGET_MS = 2000;
/** Share panel: how long "Link copied" stays visible after a successful copy. */
export const LINK_COPIED_MS = 2000;
/** BoardPage existence check: base retry interval; doubles per attempt, capped at RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/**
 * Story 9: free text objects.
 */
/** Maximum automatic width in board units; longer lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum fixed width in board units (side-handle drag lower bound). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets in board units (font px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Default size for newly created text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height multiplier for text layout (height = lines × size × this). */
export const TEXT_LINE_HEIGHT = 1.3;
/** Font family for text objects (the board's standard sans-serif). */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';

/**
 * Story 8: undo and redo settings.
 */
/** Typing pause (ms) that ends a burst into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Maximum number of undo steps per user. */
export const UNDO_MAX_STEPS = 200;

/**
 * Story 10: shapes and connectors.
 */
/** The shape kinds users can draw. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
/** Standard size (world units, square) for a shape dropped by clicking. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Minimum drag size (world units); smaller drags create a standard shape. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters in a shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Shape outline thickness in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Shape fill swatches (shape.fill: 6 named colours). */
export const SHAPE_FILL_COLORS = {
  white: '#FFFFFF',
  yellow: '#FFF9C4',
  green: '#C8E6C9',
  blue: '#BBDEFB',
  pink: '#F8BBD0',
  orange: '#FFE0B2',
} as const;
export type ShapeFillColor = keyof typeof SHAPE_FILL_COLORS;
/** Shape outline swatches (shape.stroke: 4 named colours). */
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  black: '#000000',
  blue: '#1E88E5',
  red: '#E53935',
} as const;
export type ShapeStrokeColor = keyof typeof SHAPE_STROKE_COLORS;
/** Default fill for new shapes. */
export const DEFAULT_SHAPE_FILL: ShapeFillColor = 'white';
/** Default outline for new shapes. */
export const DEFAULT_SHAPE_STROKE: ShapeStrokeColor = 'dark';
/** Minimum pointer travel (world units) before a connector drag creates an arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** Click tolerance (screen px) for selecting an arrow's line. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Connector line thickness in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius (screen px) of the connector tool's side dots. */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/**
 * Story 11: pen / freehand strokes.
 */
export const PEN_COLORS = { black: '#212121', blue: '#1E88E5', red: '#E53935', green: '#43A047', orange: '#FB8C00', purple: '#8E24AA' } as const;
export type PenColor = keyof typeof PEN_COLORS;
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
export const STROKE_MAX_POINTS = 5000;
export const STROKE_HIT_TOLERANCE_PX = 6;
export const STROKE_MIN_SIZE_WORLD = 4;

/**
 * Story 12: drop images onto the board.
 */
/** Accepted raster image content types (no SVG/PDF/video/HEIC). */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageAcceptedType = (typeof IMAGE_ACCEPTED_TYPES)[number];
/** Maximum image size in bytes (10 MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum number of images added in one action. */
export const IMAGE_MAX_FILES_PER_ADD = 20;
/** Longest side (board units) of an added image; larger is scaled down. */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
/** Minimum side (board units) of an image on resize. */
export const IMAGE_MIN_SIZE_WORLD = 16;
/** Gap (board units) between images placed in a row. */
export const IMAGE_LAYOUT_GAP_WORLD = 24;
/** An upload uploading for longer than this is shown as unfinished. */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
/** Cache-Control max-age (seconds) for served assets (immutable). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
/** Number of leading bytes used for magic-byte type sniffing. */
export const IMAGE_SNIFF_BYTES = 12;
