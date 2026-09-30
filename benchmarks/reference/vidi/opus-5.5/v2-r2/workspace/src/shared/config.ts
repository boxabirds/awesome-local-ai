// Named product settings. Stories 2–5 add to this file.

/** Minimum board zoom (10%). */
export const ZOOM_MIN = 0.1;
/** Maximum board zoom (400%). */
export const ZOOM_MAX = 4;
/** Multiplier applied by one zoom step (buttons and Ctrl/Cmd + = / −). */
export const ZOOM_STEP_FACTOR = 1.25;
/** Wheel / pinch zoom: factor = exp(-deltaY * sensitivity). */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;
/** Dot grid spacing in world units. */
export const GRID_SPACING_WORLD = 24;
/** Distance from the origin (world units) that panning is verified to work at. */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;
/** Pixels per line when a wheel event reports deltaMode = DOM_DELTA_LINE (Firefox mouse wheels). */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** Side length of a sticky note in world units (square). */
export const STICKY_SIZE_WORLD = 200;
/** Maximum number of characters in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;
/** The character counter shows while editing when remaining characters <= this. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;
/** Largest sticky note font size (board units, i.e. px at 100% zoom). */
export const STICKY_FONT_MAX_PX = 24;
/** Smallest sticky note font size; text that does not fit at this size is clipped with a fade. */
export const STICKY_FONT_MIN_PX = 10;
/** Pointer movement (screen px) after which a press on an object becomes a drag. */
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
/** Colour of newly created sticky notes. */
export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';

/** Soft capacity: simultaneous editors the board is designed and tested for. Never enforced. */
export const MAX_CONCURRENT_EDITORS = 5;
/** PRD live.propagate: a change must reach every other screen within this time. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1000;
/** Longest wait between reconnection attempts (WebsocketProvider maxBackoffTime). */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;
/** How long the green "Connected" badge shows after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2000;
/** Outage length used by the PRD live.catch_up verification. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;
/** Functional wait in e2e tests (all stories); latency is logged, not asserted. */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** Compact a board's update log into a snapshot when this many log rows exist… */
export const COMPACTION_UPDATE_COUNT = 500;
/** …or when the log's bytes reach this. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;
/** Snapshot chunk size; keeps every row far below the platform's per-row size limit (2 MB). */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;
/** A room whose board failed to load retries the load at most this often (on a new connection). */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5000;
/** PRD persist.large_board: the board size that must open within BOARD_LOAD_BUDGET_MS. */
export const PERSIST_TESTED_NOTES = 2000;
/** PRD persist.large_board: open-time target for a PERSIST_TESTED_NOTES board (logged, not asserted). */
export const BOARD_LOAD_BUDGET_MS = 3000;
/** Version of the board storage tables (the Yjs document schema is versioned separately). */
export const STORAGE_SCHEMA_VERSION = 1;

/** PRD share.create: click New board → empty board visible (logged in e2e, not asserted). */
export const CREATE_BUDGET_MS = 2000;
/** How long Copy link shows "Link copied". */
export const LINK_COPIED_MS = 2000;
/** First retry delay when a board link cannot be checked; doubles up to RECONNECT_MAX_BACKOFF_MS. */
export const BOARD_CHECK_RETRY_BASE_MS = 1000;

/** Side of a selection resize handle in screen pixels (same size at every zoom). */
export const HANDLE_SIZE_PX = 8;
/** Smallest sticky note side in world units. */
export const STICKY_MIN_SIZE_WORLD = 50;
/** Largest width or height of any object in world units (every type). */
export const MAX_OBJECT_SIZE_WORLD = 20_000;
/** Arrow key nudge distance in world units. */
export const NUDGE_STEP_WORLD = 1;
/** Shift + arrow key nudge distance in world units. */
export const NUDGE_LARGE_STEP_WORLD = 10;

/** Typing pause that ends a burst: local changes closer together than this merge into one undo step. */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;
/** Most recent undo steps kept per person (per tab); the oldest is dropped beyond this. */
export const UNDO_MAX_STEPS = 200;

/** Auto-width text grows up to this width (world units), then wraps. */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;
/** Narrowest fixed width a text object can be given with a side handle. */
export const TEXT_MIN_WIDTH_WORLD = 40;
/** Maximum number of characters in one text object. */
export const TEXT_MAX_CHARS = 5000;
/** Text size presets: font size in board units (px at 100% zoom). */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;
export type TextSize = keyof typeof TEXT_SIZES;
/** Size of text created with the Text tool. */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';
/** Unitless line height of text objects (layout and rendering must match). */
export const TEXT_LINE_HEIGHT = 1.3;
/** The board's standard sans-serif font for text objects. */
export const TEXT_FONT_FAMILY = 'Inter, system-ui, sans-serif';
/** Average glyph width as a fraction of the font size, used when text cannot be measured (no canvas). */
export const TEXT_ESTIMATE_GLYPH_WIDTH_RATIO = 0.55;

/** Shape kinds offered by the Shape tool. */
export const SHAPE_KINDS = ['rect', 'ellipse', 'diamond'] as const;
/** Side of a shape dropped with a click (or a drag smaller than SHAPE_MIN_SIZE_WORLD), world units. */
export const SHAPE_DEFAULT_SIZE_WORLD = 160;
/** Smallest dragged shape (either side), and the smallest resize, in world units. */
export const SHAPE_MIN_SIZE_WORLD = 20;
/** Maximum number of characters in a shape's label. */
export const SHAPE_LABEL_MAX_CHARS = 500;
/** Outline thickness of shapes in world units. */
export const SHAPE_STROKE_WIDTH_WORLD = 2;
/** Shape fill palette: six colours and no fill. */
export const SHAPE_FILL_COLORS = {
  none: 'transparent',
  white: '#FFFFFF',
  blue: '#BBDEFB',
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  pink: '#F8BBD0',
  grey: '#E0E0E0',
} as const;
/** Shape outline palette. */
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
/** Fill of new shapes. */
export const DEFAULT_SHAPE_FILL: FillColor = 'white';
/** Outline of new shapes. */
export const DEFAULT_SHAPE_STROKE: StrokeColor = 'dark';
/** An arrow shorter than this (world units) is not created. */
export const CONNECTOR_MIN_LENGTH_WORLD = 8;
/** A click this close to an arrow's line (screen px, any zoom) selects it. */
export const CONNECTOR_HIT_TOLERANCE_PX = 6;
/** Arrow line thickness in world units. */
export const CONNECTOR_STROKE_WIDTH_WORLD = 2;
/** Arrowhead length in world units. */
export const CONNECTOR_ARROWHEAD_SIZE_WORLD = 10;
/** Radius of the connection dots shown with the Connector tool (screen px). */
export const CONNECTOR_DOT_RADIUS_PX = 4;

/** Pen colours (story 11), in toolbar order. */
export const PEN_COLORS = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
} as const;
/** Pen thicknesses in world units (strokes scale with zoom like everything else). */
export const PEN_THICKNESS_WORLD = { thin: 2, medium: 4, thick: 8 } as const;
export type PenColor = keyof typeof PEN_COLORS;
export type PenThickness = keyof typeof PEN_THICKNESS_WORLD;
/** Colour and thickness the Pen starts with after a page load. */
export const DEFAULT_PEN_COLOR: PenColor = 'black';
export const DEFAULT_PEN_THICKNESS: PenThickness = 'medium';
/** A finished stroke stays within this many screen px (at the drawing zoom) of the drawn path. */
export const STROKE_SIMPLIFY_TOLERANCE_PX = 1;
/** A stroke being drawn is finished and continued as a new stroke at this many recorded points. */
export const STROKE_MAX_POINTS = 5000;
/** A click this close to a stroke's line (screen px, any zoom) selects it (or half its thickness if larger). */
export const STROKE_HIT_TOLERANCE_PX = 6;
/** Smallest resize of a stroke (either side), world units. */
export const STROKE_MIN_SIZE_WORLD = 4;
