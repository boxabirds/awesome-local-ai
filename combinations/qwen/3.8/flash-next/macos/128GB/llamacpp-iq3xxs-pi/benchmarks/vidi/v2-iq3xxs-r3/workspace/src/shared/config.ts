/**
 * Product settings for the board. Everything tunable lives here so it can be
 * changed in one place without a redesign. Stories 2-5 add to this file.
 */

/** Smallest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MIN = 0.1;

/** Largest zoom the board allows (screen pixels per world unit). */
export const ZOOM_MAX = 4;

/** Multiplier applied to the zoom by one "step" (a zoom button or shortcut). */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Wheel/pinch zoom sensitivity: the zoom factor for a wheel event is
 * `Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)`.
 */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** Distance between dot grid dots, in world units. */
export const GRID_SPACING_WORLD = 24;

/** How far from the start panning is required to work (board units). */
export const UNBOUNDED_PAN_TESTED_EXTENT = 1_000_000;

/**
 * Zoom values produced by repeated steps snap to the nearest
 * `ZOOM_STEP_FACTOR^n` when closer than this, so "step in then step out"
 * returns exactly the zoom it started from (1.25 then 0.8 => 1).
 */
export const ZOOM_STEP_SNAP_EPSILON = 1e-9;

/** The zoom label is `Math.round(zoom * ZOOM_PERCENT_SCALE)` percent. */
export const ZOOM_PERCENT_SCALE = 100;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === LINE`. */
export const WHEEL_LINE_DELTA_PX = 16;

/** Pixels added to a wheel `deltaY`/`deltaX` for `deltaMode === PAGE`. */
export const WHEEL_PAGE_DELTA_PX = 800;

/* --- Story 2: sticky notes ------------------------------------------------ */

/** Sticky note size in world units (square: width = height). */
export const STICKY_SIZE_WORLD = 200;

/** Hard limit on the characters in one sticky note. */
export const STICKY_TEXT_MAX_CHARS = 1000;

/** The character counter shows when remaining <= this many characters. */
export const STICKY_COUNTER_THRESHOLD_CHARS = 50;

/** Largest note font size (CSS pixels at 100% zoom; scales with zoom). */
export const STICKY_FONT_MAX_PX = 24;

/** Smallest note font size; below this the overflow is hidden with a fade. */
export const STICKY_FONT_MIN_PX = 10;

/** Pointer movement that turns a press on a note into a drag (screen px). */
export const DRAG_THRESHOLD_PX = 3;

/** The six note colours. Keys are the names stored in the document. */
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

/* --- Story 3: live collaboration ------------------------------------------ */

/**
 * Simultaneous-editor capacity (live.capacity): the single named setting the
 * design and the tests use. It is *soft* — the server never refuses a
 * connection and never restricts editing over it (live.over_capacity).
 */
export const MAX_CONCURRENT_EDITORS = 5;

/** live.propagate: how long a change may take to reach every other screen. */
export const LIVE_UPDATE_LATENCY_BUDGET_MS = 1_000;

/** Reconnect backoff ceiling handed to the y-websocket provider. */
export const RECONNECT_MAX_BACKOFF_MS = 10_000;

/** How long the green "Connected" badge stays after a reconnection. */
export const CONNECTED_CONFIRMATION_MS = 2_000;

/** Outage length used when verifying live.catch_up. */
export const CATCH_UP_TEST_OUTAGE_MS = 30_000;

/**
 * Functional wait in the e2e suites (all stories). Latency is measured and
 * reported against LIVE_UPDATE_LATENCY_BUDGET_MS there, never asserted: the
 * model, the browsers and the server share one machine.
 */
export const E2E_EVENTUAL_TIMEOUT_MS = 15_000;

/** How long the nightly soak keeps five people on one board (TC-30). */
export const NIGHTLY_SOAK_MINUTES = 1;

/** The soak's pace: one edit per person every 5 seconds (TC-30). */
export const NIGHTLY_EDIT_SPACING_MS = 5_000;

/**
 * The nightly idle watch (TC-29): the PRD's 90 idle minutes at one second per
 * minute — waiting to see nothing happen is scaled, unlike a real outage.
 */
export const NIGHTLY_IDLE_WATCH_MS = 5_000;

/* --- Story 4: boards are kept (persist) ---------------------------------- */

/**
 * Compaction trigger (persist.board_store): a board whose update log holds
 * this many rows is folded into a snapshot, so the work of opening a board
 * stays bounded — at most one snapshot plus fewer than this many log rows.
 */
export const COMPACTION_UPDATE_COUNT = 500;

/** The other compaction trigger: total bytes of logged updates. */
export const COMPACTION_BYTES = 4 * 1024 * 1024;

/**
 * Size of one snapshot row. Deliberately far below the per-row limit of
 * SQLite-backed Durable Objects (see NOTES.md): a big board's snapshot is
 * stored as several chunks instead of one oversized row.
 */
export const SNAPSHOT_CHUNK_BYTES = 512 * 1024;

/**
 * persist.load_failure: a board that failed to load retries the load at most
 * this often, so nobody hammering the address turns one broken board into a
 * stream of storage reads.
 */
export const LOAD_RETRY_MIN_INTERVAL_MS = 5_000;

/** persist.large_board: the board size the product is tested at. */
export const PERSIST_TESTED_NOTES = 2_000;

/** persist.large_board: the open-time target the tests report against. */
export const BOARD_LOAD_BUDGET_MS = 3_000;

/** Version of the *storage* tables (not of the document schema, which is
 * `meta.schemaVersion` in the Y.Doc). Bumped by a future migration. */
export const STORAGE_SCHEMA_VERSION = 1;

/* --- Story 5: share a board with others using a link --------------------- */

/**
 * share.create: the click on **New board** should have produced a board you can
 * work in within this long. Reported against in the e2e suite, never asserted —
 * the wall clock on a shared machine is not the product's doing.
 */
export const CREATE_BUDGET_MS = 2_000;

/** share.copy: how long the Share panel says "Link copied". */
export const LINK_COPIED_MS = 2_000;

/**
 * share.unreachable: the first wait before asking again whether a board link
 * leads to a board. Doubles per attempt up to `RECONNECT_MAX_BACKOFF_MS`
 * (story 3), the same ceiling the websocket reconnect uses.
 */
export const BOARD_CHECK_RETRY_BASE_MS = 1_000;

/* --- Story 7: selecting, moving and resizing many objects ---------------- */

/**
 * Side of one resize handle, in *screen* pixels: the handles of the selection's
 * bounding box stay this big whatever the zoom is, so a small object at 10% is
 * still grabbable.
 */
export const HANDLE_SIZE_PX = 8;

/** A sticky note may not be resized smaller than this (board units). */
export const STICKY_MIN_SIZE_WORLD = 50;

/**
 * No object of any type may be resized larger than this (board units). One
 * global maximum, unlike the minimum, which each type declares (sel.size_limits).
 */
export const MAX_OBJECT_SIZE_WORLD = 20_000;

/** One arrow-key press moves the selection this many board units (sel.nudge). */
export const NUDGE_STEP_WORLD = 1;

/** Shift + arrow key moves it this much (sel.nudge). */
export const NUDGE_LARGE_STEP_WORLD = 10;

/* --- story 8: undoing and redoing your own changes ---------------------- */

/**
 * How long consecutive local changes stay one undo step (undo.capture): a
 * pause of at least this long ends a typing burst, and an action boundary
 * (gesture or edit start and end) ends the window immediately, so a drag and
 * the click that follows it are never one step.
 */
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

/**
 * How many steps one person's undo history keeps (undo.bounded): adding a step
 * beyond this drops the oldest one. Memory only — a reload starts empty
 * (undo.session_only).
 */
export const UNDO_MAX_STEPS = 200;

/* --- story 9: writing free text anywhere on the board ------------------- */

/**
 * The four text sizes (text.size): the key is what a board stores, so it is a
 * string on the wire whatever the labels say; the value is the font size in
 * board units, which is CSS pixels at 100 % zoom.
 */
export const TEXT_SIZES = { S: 14, M: 20, L: 32, XL: 56 } as const;

/** Which keys {@link TEXT_SIZES} has, in the order the toolbar offers them. */
export type TextSize = keyof typeof TEXT_SIZES;

/** A text object starts at this size (text.create). */
export const DEFAULT_TEXT_SIZE: TextSize = 'M';

/**
 * The automatic width limit (text.auto_width): an auto-width box is as wide as
 * its longest line, and a line longer than this wraps onto the next one.
 */
export const TEXT_MAX_AUTO_WIDTH_WORLD = 600;

/** The narrowest a fixed width may be (text.fixed_width). */
export const TEXT_MIN_WIDTH_WORLD = 40;

/** How many characters one text object holds (text.limit). */
export const TEXT_MAX_CHARS = 5_000;

/**
 * A line is this many times the font size tall — the same multiple the CSS uses
 * for `line-height`, so a measured box and a laid-out box agree.
 */
export const TEXT_LINE_HEIGHT = 1.3;

/**
 * Room the box keeps at its left and right of its lines, so an italic or a
 * wide glyph is not clipped by the box edge. It is inside the automatic width
 * limit, so a wrapped line is `TEXT_MAX_AUTO_WIDTH_WORLD` minus twice this.
 */
export const TEXT_BOX_PADDING_WORLD = 8;

/**
 * The font the text objects and the measurer share: the same stack `:root`
 * renders, so what the measurer measured is what the board draws, and text
 * stays crisp at every zoom (readability constraint). A webfont would have to
 * be listed here *and* loaded before the box a text object reports means
 * anything, which is why the board's own stack is the one that is measured.
 */
export const TEXT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * How wide a character is, when nothing can be measured: the estimate a
 * measurer falls back to (`text.layout`'s error path) is this times the font
 * size, per character. Deliberately a little wide — an estimated box that is
 * slightly too big is a box nobody can mistake for a clipping one.
 */
export const TEXT_ESTIMATED_GLYPH_RATIO = 0.52;
