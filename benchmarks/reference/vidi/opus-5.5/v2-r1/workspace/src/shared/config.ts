// Named product settings. Later stories add to this file.

/** Minimum zoom (screen px per world unit): 10%. */
export const ZOOM_MIN = 0.1;
/** Maximum zoom: 400%. */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons, Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Ctrl/Cmd-wheel and pinch: zoom factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Distance between grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the starting point that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/** Side length of a sticky note, in world units. */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in a sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest note font size, in world units (px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest note font size; text beyond what fits at this size is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) after which a press on a note becomes a drag. */
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
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** A change must appear on every other connected screen within this time (PRD live.propagate). */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used to verify catch-up of offline edits (PRD live.catch_up). */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e tests (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Compact the board's update log once it has this many rows... */
export const COMPACTION_UPDATE_COUNT = 500;
/** ...or once its rows total this many bytes. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot row size: far below the platform's per-row size limit (2 MB for SQLite-backed Durable Objects). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A board that failed to load retries loading at most this often. */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** Board size a saved board is verified to open with (PRD persist.large_board). */
export const PERSIST_TESTED_NOTES = 2000;
/** Time to show a saved board of PERSIST_TESTED_NOTES notes (PRD persist.large_board); logged in e2e. */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (not of the Yjs document schema). */
export const STORAGE_SCHEMA_VERSION = 1;

/** Click on New board to the new board being shown (PRD share.create); logged in e2e. */
export const CREATE_BUDGET_MS = 2000;
/** How long Copy link shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First wait before re-checking a board link the service could not answer; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/** Side of a selection resize handle, in screen px (same size at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest width/height a sticky note can be resized to, in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width/height any object can be resized to, in world units (every type). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow key nudge, in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift+arrow key nudge, in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** Typing pause that ends a burst: changes closer together than this form one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Undo steps kept per person; the oldest is dropped beyond this. */
export const UNDO_MAX_STEPS = 200;

/** A text object without a fixed width grows up to this width, in world units, then wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Smallest fixed width a text object can be given with a side handle, in world units. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters in a text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in world units (px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Line height of text objects, as a multiple of the font size. */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif font, used by text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Extra room added to an automatic width so the caret fits after the last character, world units. */
export const TEXT_CARET_SLACK_WORLD = 2;
/** Average glyph width as a fraction of the font size, used when text cannot be measured. */
export const TEXT_AVG_GLYPH_WIDTH_RATIO = 0.55;

/** Shape kinds (story 10), in Shape menu order. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Size of a shape dropped with a click (or a drag below the minimum), world units. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** A drag smaller than this in either direction drops a standard-size shape instead. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum number of characters in a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline width of shapes, world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Shape fill swatches ("none" = no fill). */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** Shape outline swatches. */
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
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** A connector drag shorter than this (world units) creates no arrow. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** A click within this distance (screen px) of an arrow's line selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Line width of arrows, world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Length of an arrowhead, world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of the connection dots shown with the Connector tool, screen px. */
export const CONNECTOR_DOT_RADIUS_PX = 4;
/** Font size of shape labels, world units (px at 100% zoom). */
export const SHAPE_LABEL_FONT_PX = 16;

/** Pen colours (story 11), in pen toolbar order. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** Pen line widths, world units (strokes scale with zoom like everything else). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export const DEFAULT_PEN_COLOR = 'black';
export const DEFAULT_PEN_THICKNESS = 'medium';
/** A finished stroke stays within this many screen px (at the drawing zoom) of the drawn path. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** A stroke being drawn is finished and continued as a new stroke at this many recorded points. */
export const STROKE_MAX_POINTS = 5000;
/** A click within this distance (screen px) of a stroke's line selects it. */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest width/height a stroke can be resized to, world units. */
export const STROKE_MIN_SIZE_WORLD = 4;
