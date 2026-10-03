// Named product settings for vidi6. Stories 2-5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplicative zoom step for buttons and keyboard shortcuts (1.25). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Zoom factor for a Ctrl/Cmd wheel = exp(-deltaY * WHEEL_ZOOM_SENSITIVITY). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Farthest extent (world units) from the start that pan is tested to. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Pixels per wheel "line" delta (WheelEvent.deltaMode === 1). */
export const WHEEL_LINE_DELTA_PX = 16;
/** Pixels per wheel "page" delta (WheelEvent.deltaMode === 2). */
export const WHEEL_PAGE_DELTA_PX = 100;

// --- Story 2: Sticky notes ---

/** Sticky note size in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum characters in a sticky note's text. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** Character counter shows when remaining chars <= this threshold. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Maximum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MAX_PX = 24;
/** Minimum font size (px at 100% zoom) for sticky note text. */
export const STICKY_FONT_MIN_PX = 10;
/** Minimum pointer movement (screen px) before a drag starts. */
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

// --- Story 3: Live collaboration ---

/** Soft capacity: design + test target for simultaneous editors; never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** 1-second budget for live change delivery (PRD live.propagate). Logged, not asserted, in e2e. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Maximum reconnection backoff, passed to WebsocketProvider as maxBackoffTime. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge stays visible after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify offline catch-up (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional (eventual) wait timeout for e2e tests; latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

// --- Story 4: Persistence ---

/** Compact when this many log rows exist. */
export const COMPACTION_UPDATE_COUNT = 500;
/** Or when log bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Keeps every row well under the platform per-row size limit. */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** LoadFailed room retries load at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: tested board size. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Versions the storage tables. */
export const STORAGE_SCHEMA_VERSION = 1;

// --- Story 5: Share a board ---

/** 2-second budget for board creation (PRD share.create). */
export const CREATE_BUDGET_MS = 2000;
/** How long "Link copied" stays visible (PRD share.copy). */
export const LINK_COPIED_MS = 2000;
/** Base backoff for board existence check retries; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

// --- Story 7: Multi-select, group move/resize/delete ---
/** Screen-space size of a resize handle in pixels. */
export const HANDLE_SIZE_PX = 8;
/** Minimum width/height (world units) any object can be resized to. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Maximum width/height (world units) any object can be resized to. */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Single arrow-key nudge in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow nudge in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

// --- Story 8: Undo and redo ---

/** Typing pause that ends a burst (500 ms). */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Maximum undo/redo steps per user (200). */
export const UNDO_MAX_STEPS = 200;

// --- Story 9: Free text ---

/** Maximum automatic width of a text object (world units); longer lines wrap. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Minimum width a text object can be set to via a side handle (world units). */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets in world units (font size at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Default size for new text objects. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** Font used for text objects (the board's standard sans-serif stack). */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Extra width (world units) added to the longest line for an auto-width box. */
export const TEXT_PADDING_WORLD = 2;
/** Average glyph width as a fraction of the font size (estimation fallback). */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.6;

// --- Story 10: Shapes and connectors ---

/** Available shape kinds. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export type ShapeKind = typeof SHAPE_KINDS[number];
/** Default shape size in world units (square). */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Minimum shape size in world units (drag below this creates a default). */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum characters in a shape label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Stroke width for shapes (world units). */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Fill colours for shapes. */
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
/** Stroke (outline) colours for shapes. */
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
/** Hit tolerance for selecting a connector (screen pixels). */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Stroke width for connectors (world units). */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead size for connectors (world units). */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of connection dots (screen pixels). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

// --- Story 11: Pen (freehand strokes) ---

/** The six available pen colours. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export type PenColor = keyof typeof PEN_COLORS;
/** Pen thicknesses in board (world) units. */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
/** Default pen colour. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
/** Default pen thickness. */
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
/** Max deviation (screen px at the drawing zoom) allowed when simplifying a stroke. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** Maximum recorded points per stroke; longer strokes split at this limit. */
export const STROKE_MAX_POINTS = 5000;
/** Hit tolerance for selecting a stroke (screen pixels). */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Minimum size (world units) of a stroke's bounding box when resizing. */
export const STROKE_MIN_SIZE_WORLD = 4;

// --- Story 12: Drop images onto the board ---

/** Accepted image MIME types. */
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];
/** Maximum image file size in bytes (10 MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum number of images added in one action. */
export const IMAGE_MAX_FILES_PER_ADD = 20;
/** Maximum placement size in world units (longest side). */
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
/** Minimum image size in world units (resize floor). */
export const IMAGE_MIN_SIZE_WORLD = 16;
/** Gap between images in a row layout (world units). */
export const IMAGE_LAYOUT_GAP_WORLD = 24;
/** Upload is considered stale/unfinished after this many ms. */
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000;
/** Cache-Control max-age for served assets (1 year in seconds). */
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000;
/** Number of bytes read for magic-byte type sniffing. */
export const IMAGE_SNIFF_BYTES = 12;
