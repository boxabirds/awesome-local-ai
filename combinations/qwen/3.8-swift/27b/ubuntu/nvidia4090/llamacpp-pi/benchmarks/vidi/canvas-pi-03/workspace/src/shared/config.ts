export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP_FACTOR = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
export const GRID_SPACING_WORLD = 24;
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

// Story 2: sticky notes
export const STICKY_SIZE_WORLD = 200;
export const STICKY_TEXT_MAX_CHARS = 1000;
export const STICKY_COUNTER_THRESHOLD_CHARS = 50; // counter shows when remaining <= this
export const STICKY_FONT_MAX_PX = 24;
export const STICKY_FONT_MIN_PX = 10;
export const DRAG_THRESHOLD_PX = 3;
// Story 3: live collaboration
export const MAX_CONCURRENT_EDITORS = 5; // soft capacity: design + test target, never enforced
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000; // PRD live.propagate
export const RECONNECT_MAX_BACKOFF_MS = 10_000; // passed to WebsocketProvider maxBackoffTime
export const CONNECTED_CONFIRMATION_MS = 2000; // green badge duration after reconnect
export const CATCH_UP_TEST_OUTAGE_MS = 30_000; // PRD live.catch_up verification outage
// Story 4: board persistence
export const COMPACTION_UPDATE_COUNT = 500;          // compact when this many log rows exist
export const COMPACTION_BYTES = 4 * 1024 * 1024;     // or when log bytes reach this
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;      // keeps every row well under the platform per-row size limit
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;      // LoadFailed room retries load at most this often
export const PERSIST_TESTED_NOTES = 2000;            // PRD persist.large_board
export const BOARD_LOAD_BUDGET_MS = 3000;            // PRD persist.large_board
export const STORAGE_SCHEMA_VERSION = 1;
// Story 7: multi-selection, group move/resize, nudge, delete
export const HANDLE_SIZE_PX = 8; // resize handles stay this size on screen at any zoom
export const STICKY_MIN_SIZE_WORLD = 50; // sticky notes cannot be resized below this
export const MAX_OBJECT_SIZE_WORLD = 20_000; // no object may be resized above this
export const NUDGE_STEP_WORLD = 1; // arrow-key nudge step
export const NUDGE_LARGE_STEP_WORLD = 10; // Shift+arrow nudge step
// Story 8: per-user undo/redo
export const UNDO_CAPTURE_TIMEOUT_MS = 500; // typing pause that ends a burst
export const UNDO_MAX_STEPS = 200;          // per-user history length
// Story 9: free text objects
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600; // auto-width text wraps beyond this
export const TEXT_MIN_WIDTH_WORLD = 40; // side-handle fixed width floor
export const TEXT_MAX_CHARS = 5000; // per-text-object length limit
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const; // font size presets (board units)
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
export const TEXT_LINE_HEIGHT = 1.3; // line height multiplier
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.6; // estimate fallback: avg glyph width in ems
// Story 10: shapes and connectors
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
export const SHAPE_DEFAULT_SIZE_WORLD = 160; // click (tiny drag) creates this size
export const SHAPE_MIN_SIZE_WORLD = 20; // drag smaller than this in either dimension = click
export const SHAPE_LABEL_MAX_CHARS = 500; // per-shape label limit (shape.label)
export const SHAPE_STROKE_WIDTH_WORLD = 2; // shape outline width (board units)
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
export const SHAPE_STROKE_COLORS = {
  dark: '#263238',
  blue: '#1E88E5',
  green: '#43A047',
  orange: '#FB8C00',
  red: '#E53935',
  grey: '#9E9E9E',
} as const;
export const DEFAULT_SHAPE_FILL = 'white' as const;
export const DEFAULT_SHAPE_STROKE = 'dark' as const;
export const CONNECTOR_MIN_LENGTH_WORLD = 8; // shorter drags create no arrow (connector.no_accidental)
export const CONNECTOR_HIT_TOLERANCE_PX = 6; // click within this (screen px) selects an arrow
export const CONNECTOR_STROKE_WIDTH_WORLD = 2; // arrow line width (board units)
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10; // arrowhead length (board units)
export const CONNECTOR_DOT_RADIUS_PX = 4; // connection-dot radius (screen px, constant at any zoom)
// Story 11: freehand pen (pen.*)
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const; // board units
export const DEFAULT_PEN_COLOR = 'black';
export const DEFAULT_PEN_THICKNESS = 'medium';
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1; // screen px, divided by zoom (pen.smooth)
export const STROKE_MAX_POINTS = 5000; // raw points per stroke part (pen.long_stroke)
export const STROKE_HIT_TOLERANCE_PX = 6; // screen px from the line selects a stroke (pen.select)
export const STROKE_MIN_SIZE_WORLD = 4; // smallest stroke bbox side (board units)
// Story 5: share a board with others using a link
export const BOARD_CREATE_LIMIT = 10;              // per visitor, per period (PRD share.rate_limit)
export const BOARD_CREATE_PERIOD_SECONDS = 60;     // must match wrangler.jsonc ratelimits (TC-03 asserts equality)
export const CREATE_ID_MAX_ATTEMPTS = 3;           // collision retries when a generated id is already taken
export const CREATE_BUDGET_MS = 2000;              // PRD share.create: board opens within 2 s
export const LINK_COPIED_MS = 2000;                // PRD share.copy: "Link copied" duration
export const BOARD_CHECK_RETRY_BASE_MS = 1000;     // backoff doubles up to RECONNECT_MAX_BACKOFF_MS (story 3)

// Story 12: images (image.*)
export const IMAGE_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageAcceptedType = (typeof IMAGE_ACCEPTED_TYPES)[number];
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (image.size_limit)
export const IMAGE_MAX_FILES_PER_ADD = 20; // images per drop/paste/pick action (image.count_limit)
export const IMAGE_MAX_PLACE_SIZE_WORLD = 800; // longest side of the placement size (image.placement_size)
export const IMAGE_MIN_SIZE_WORLD = 16; // smallest allowed image side on resize (image.aspect_resize)
export const IMAGE_LAYOUT_GAP_WORLD = 24; // gap between images in a row (image.drop)
export const IMAGE_UPLOAD_STALE_MS = 5 * 60 * 1000; // uploading → unfinished after this (image.unfinished)
export const IMAGE_UPLOAD_LIMIT = 60; // per visitor, per period (image.rate_limit)
export const IMAGE_UPLOAD_PERIOD_SECONDS = 60; // must match wrangler.jsonc ratelimits
export const ASSET_CACHE_MAX_AGE_SECONDS = 31_536_000; // immutable asset caching (one year)
export const IMAGE_SNIFF_BYTES = 12; // head bytes read for magic-byte sniffing

export const STICKY_COLORS = {
  yellow: '#FFF59D',
  orange: '#FFCC80',
  green: '#C5E1A5',
  blue: '#90CAF9',
  pink: '#F48FB1',
  violet: '#CE93D8',
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
