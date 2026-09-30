// Freehand drawing, in a real browser, with a real pointer (story 11).
//
// Two things make this file different from `helpers/shapes.ts`, and both of them are about
// time rather than arithmetic. The first is that a freehand drag is a *sequence* of pointer
// events whose number and spacing the test controls: a drag that is over in one frame cannot
// show a preview that follows the pointer, so the drags here are moved through a recorded
// path with a pause every few samples, which is what lets a test count the frames the drawing
// grew on. The second is that the interesting thing about a stroke is what another screen
// does NOT see while the line is being drawn, so the drag is cut into `penDownAt`,
// `penMoveThrough` and `penUp`, and a test can look at the other person's screen in the middle
// of it.
//
// As in `shapes.ts`, board units and screen pixels are never compared directly: board units
// come from the places board units live (`style.left`, the path's own `d`, the `stroke-width`
// attribute, which are all in the world layer's units and are scaled by transform, not by
// these numbers), and screen pixels come from the camera the board reports through the test
// hook. A drawing's painted shape is measured with the SVG element's own `getBBox()`, which
// is in board units whatever the zoom — that is what makes "the aspect ratio of this drawing
// did not change" a statement that survives a zoom.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md

import { expect } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { Camera } from '../../../src/client/canvas/camera';
import { settle, VIEWPORT } from './board';
import { cameraOf, pressKey, screenOf, zoomOf, type Box, type Point } from './shapes';
import type { Participant } from './participants';

export type { Box, Point };

// --- the two coordinate systems ---------------------------------------------

/** The camera this screen is looking through, in board units. */
export const viewOf = (who: Participant): Promise<Camera> => cameraOf(who);

/** A point on the board, where this screen paints it. */
export const screenOfPoint = (who: Participant, at: Point): Promise<Point> => screenOf(who, at);

/**
 * A point the pointer may be put at. Firefox reports coordinates outside the window as
 * (0, 0), which a board reads as a jump to the far side of the anchor, so a pointer that
 * would leave the window is taken to its edge instead.
 */
const inside = (at: Point): Point => ({
  x: Math.min(Math.max(at.x, 4), VIEWPORT.width - 4),
  y: Math.min(Math.max(at.y, 4), VIEWPORT.height - 4),
});

/**
 * The right edge of the tool rail, in screen pixels: `left: 16` plus its 6 padding and its
 * buttons, plus room to breathe. A press at or left of this belongs to the rail, whatever
 * the rail's buttons are for.
 */
const RAIL_RIGHT_PX = 76;

/**
 * Where a sticky note's middle is on the board, in board units: the place to put a pointer
 * when a test means to start a drag on top of a note. Its own `style` is in board units, the
 * world layer's transform being above it, so this needs no camera.
 */
export async function noteCentreOnBoard(who: Participant, id: string): Promise<Point> {
  const box = await who.page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element === null) return null;
    return {
      left: Number.parseFloat(element.style.left),
      top: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
    };
  }, `[data-testid="sticky-note"][data-id="${id}"]`);
  if (box === null || Number.isNaN(box.width)) throw new Error(`there is no note "${id}" here`);
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** A view that puts a board point in the middle of the screen at a given zoom. */
export const viewAt = (centre: Point, zoom: number): Camera => ({
  x: centre.x - VIEWPORT.width / (2 * zoom),
  y: centre.y - VIEWPORT.height / (2 * zoom),
  zoom,
});

// --- the tool ----------------------------------------------------------------

/** Ask for the pen the way a person does: `P`. */
export const pressPen = (who: Participant): Promise<void> => pressKey(who, 'p');

/** Put the pen away, the way a person does: `V`, or Escape. */
export const pressSelect = (who: Participant): Promise<void> => pressKey(who, 'v');

/** Which tool this screen's rail says is up. */
export const toolIsOn = (who: Participant, tool: string): Promise<boolean> =>
  who.page.evaluate((name) => {
    const button = document.querySelector(`[data-testid="tool-${name}"]`);
    return button?.getAttribute('aria-pressed') === 'true';
  }, tool);

/** The pen's sheet is over the board, so this screen draws rather than moves things. */
export const penSheetIsUp = (who: Participant): Promise<boolean> =>
  who.page.evaluate(() => document.querySelector('[data-testid="pen-tool"]') !== null);

/** The pen's own options are up, which is only ever true while the pen is. */
export const penOptionsAreUp = (who: Participant): Promise<boolean> =>
  who.page.evaluate(() => document.querySelector('[data-testid="pen-toolbar"]') !== null);

/** The sheet covers the whole board: it is the thing under a pointer anywhere. */
export const penSheetCoversBoard = async (who: Participant): Promise<boolean> =>
  who.page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="pen-tool"]');
    if (sheet === null) return false;
    const box = (sheet as HTMLElement).getBoundingClientRect();
    return box.width >= 1000 && box.height >= 600;
  });

/** Choose a colour from the pen's options. */
export async function pickPenColor(who: Participant, color: PenColor): Promise<void> {
  const button = who.page.getByTestId(`pen-color-${color}`);
  await expect(button).toBeVisible();
  await button.click();
  await settle(who.page);
}

/** Choose a thickness from the pen's options. */
export async function pickPenThickness(who: Participant, thickness: PenThickness): Promise<void> {
  const button = who.page.getByTestId(`pen-thickness-${thickness}`);
  await expect(button).toBeVisible();
  await button.click();
  await settle(who.page);
}

/** Which colour and thickness this screen's pen is set to, by what is pressed. */
export const penColorPressed = (who: Participant, color: PenColor): Promise<boolean> =>
  who.page.evaluate((name) => {
    const button = document.querySelector(`[data-testid="pen-color-${name}"]`);
    return button?.getAttribute('aria-pressed') === 'true';
  }, color);

export const penThicknessPressed = (who: Participant, thickness: PenThickness): Promise<boolean> =>
  who.page.evaluate((name) => {
    const button = document.querySelector(`[data-testid="pen-thickness-${name}"]`);
    return button?.getAttribute('aria-pressed') === 'true';
  }, thickness);

/** How many colours and thicknesses this screen offers. */
export const penOptionCounts = (who: Participant): Promise<{ colors: number; thicknesses: number }> =>
  who.page.evaluate(() => ({
    colors: document.querySelectorAll('[data-testid^="pen-color-"]').length,
    thicknesses: document.querySelectorAll('[data-testid^="pen-thickness-"]').length,
  }));

// --- the pointer, in pieces ---------------------------------------------------

/**
 * Put the pen down at a board point. Nothing is drawn by this on its own: a stroke is
 * finished only when the pointer comes up, which is the whole sharing rule.
 */
export async function penDownAt(who: Participant, at: Point): Promise<void> {
  const spot = inside(await screenOfPoint(who, at));
  await who.page.mouse.move(spot.x, spot.y);
  await who.page.mouse.down();
}

export interface MoveOptions {
  /** Milliseconds to wait every `every` samples, so the drag lasts more than one frame. */
  delayMs?: number;
  every?: number;
}

/**
 * Carry the held pointer through a path, with a pause every few samples.
 *
 * The pauses are the point: a drag that is over inside one frame would show a preview that
 * never changed, and a test that measured it would pass whether the preview worked or not.
 */
export async function penMoveThrough(
  who: Participant,
  path: Point[],
  options: MoveOptions = {},
): Promise<void> {
  const every = options.every ?? 3;
  const delayMs = options.delayMs ?? 8;
  for (const [index, point] of path.entries()) {
    const spot = inside(await screenOfPoint(who, point));
    await who.page.mouse.move(spot.x, spot.y);
    if (every > 0 && index % every === 0 && delayMs > 0) {
      await who.page.waitForTimeout(delayMs);
    }
  }
}

/** Lift the pointer, which is the moment a stroke exists for everybody. */
export async function penUp(who: Participant): Promise<void> {
  await who.page.mouse.up();
  await settle(who.page);
}

/** Draw with the pen: down at the first point, through the rest, up. */
export async function dragPen(
  who: Participant,
  path: Point[],
  options: MoveOptions = {},
): Promise<void> {
  const [first, ...rest] = path;
  if (first === undefined || rest.length === 0) throw new Error('a path of one point draws nothing');
  await penDownAt(who, first);
  await penMoveThrough(who, rest, options);
  await penUp(who);
}

/**
 * Draw a path with the pen and hand back the strokes that came of it. The ids are the
 * board's business, so they are read back rather than guessed at: a stroke that was split at
 * the point limit arrives as more than one, and a test that assumed one would be wrong about
 * the feature rather than about the test.
 */
export async function drawStroke(
  who: Participant,
  path: Point[],
  options: MoveOptions & { pressTool?: boolean } = {},
): Promise<string[]> {
  if (options.pressTool !== false) await pressPen(who);
  const before = await strokeIds(who);
  await dragPen(who, path, options);
  const after = await strokeIds(who);
  const created = after.filter((id) => !before.includes(id));
  if (created.length === 0) throw new Error('the drag made no stroke');
  return created;
}

/** Scroll the board with the pen up: plain wheel pans, ctrl or meta wheel zooms. */
export async function wheel(
  who: Participant,
  at: Point,
  delta: { x?: number; y?: number; ctrlKey?: boolean },
): Promise<void> {
  const spot = inside(at);
  if (delta.ctrlKey === true) await who.page.keyboard.down('Control');
  await who.page.mouse.move(spot.x, spot.y);
  await who.page.mouse.wheel(delta.x ?? 0, delta.y ?? 0);
  if (delta.ctrlKey === true) await who.page.keyboard.up('Control');
  await settle(who.page);
}

// --- the preview --------------------------------------------------------------

/** What the preview did over a drag: how many frames it was on, and how many shapes it was in. */
export interface PreviewSamples {
  /** Frames counted while the sampler ran. */
  frames: number;
  /** Of those, how many had a preview path on the screen at all. */
  withPreview: number;
  /** How many different `d` attributes it held, in the order they appeared. */
  distinct: number;
  /** Their lengths, oldest first: the drawing getting longer is what this counts. */
  lengths: number[];
  /** The second shape it ever had, for a test that wants to look at one. */
  second: string | null;
}

/**
 * Start counting what the local preview looks like, frame by frame.
 *
 * This is the page's own animation frame clock rather than a poll from outside, because the
 * thing under test is that the drawing keeps up with the pointer: a preview that was only
 * ever read once would pass for a preview that appears at the end.
 */
export async function startPreviewSampling(who: Participant): Promise<void> {
  await who.page.evaluate(() => {
    const w = window as unknown as {
      __penPreviewSamples?: { frames: number; withPreview: number; seen: string[] };
      __penPreviewStop?: boolean;
    };
    w.__penPreviewSamples = { frames: 0, withPreview: 0, seen: [] };
    w.__penPreviewStop = false;
    const tick = (): void => {
      const state = w.__penPreviewSamples;
      if (state === undefined || w.__penPreviewStop === true) return;
      const path = document.querySelector('[data-testid="pen-tool-preview-path"]');
      state.frames += 1;
      if (path !== null) {
        state.withPreview += 1;
        const d = path.getAttribute('d') ?? '';
        if (state.seen[state.seen.length - 1] !== d) state.seen.push(d);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Stop the frame clock and hand back what it saw. */
export async function stopPreviewSampling(who: Participant): Promise<PreviewSamples> {
  const read = await who.page.evaluate(() => {
    const w = window as unknown as {
      __penPreviewSamples?: { frames: number; withPreview: number; seen: string[] };
      __penPreviewStop?: boolean;
    };
    w.__penPreviewStop = true;
    const state = w.__penPreviewSamples;
    if (state === undefined) return null;
    return {
      frames: state.frames,
      withPreview: state.withPreview,
      distinct: state.seen.length,
      lengths: state.seen.map((d) => d.length),
      second: state.seen.length > 1 ? (state.seen[1] as string) : null,
    };
  });
  if (read === null) throw new Error('the preview sampler was never started on this page');
  return read;
}

/** The preview that is on this screen right now, in screen pixels, or null. */
/** The preview that is on this screen right now, in its `d`, or null when there is none. */
export const previewPathD = (who: Participant): Promise<string | null> =>
  who.page.evaluate(() => {
    const path = document.querySelector('[data-testid="pen-tool-preview-path"]');
    return path === null ? null : (path.getAttribute('d') ?? '');
  });

/** The round mark that says where the pen's thickness will land. */
export const penCursorSize = (who: Participant): Promise<number | null> =>
  who.page.evaluate(() => {
    const cursor = document.querySelector('[data-testid="pen-tool-cursor"]');
    return cursor === null ? null : (cursor as HTMLElement).getBoundingClientRect().width;
  });

// --- strokes -----------------------------------------------------------------

function strokeSelector(id: string): string {
  return `[data-testid="stroke-object"][data-id="${id}"]`;
}

/** One stroke as a screen draws it. */
export interface StrokeInfo {
  id: string;
  /** The colour's name, not its colour: what the document holds. */
  color: string;
  thickness: string;
  selected: boolean;
  /** Board units, from the places board units live. */
  box: Box;
  /** The painted line's own path, in board units. */
  d: string;
  /** Points that lie on the painted line, in board units: where a click may go. */
  ink: Point[];
  /** Board units: how thick the line is painted. */
  strokeWidth: number;
  /** Board units: how wide the invisible target is, which is the hit rule made visible. */
  hitWidth: number;
  /** Board units: the painted line's own box, from the SVG's own geometry. */
  paint: Box;
}

/** Every stroke this screen draws, in the order the board drew them. */
export const strokeIds = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="stroke-object"]')).map(
      (element) => (element as HTMLElement).dataset.id as string,
    ),
  );

export const strokeCount = (who: Participant): Promise<number> =>
  who.page.evaluate(() => document.querySelectorAll('[data-testid="stroke-object"]').length);

/** The strokes this screen says are chosen. */
export const selectedStrokeIds = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-testid="stroke-object"][data-selected="true"]'),
    ).map((element) => (element as HTMLElement).dataset.id as string),
  );

/** One stroke as this screen draws it, or null once it is not on this screen. */
export async function stroke(who: Participant, id: string): Promise<StrokeInfo | null> {
  const read = await who.page.evaluate((selector) => {
    const element = document.querySelector(selector) as HTMLElement | null;
    if (element === null) return null;
    const painted = element.querySelector('[data-testid="stroke-path"]');
    const target = element.querySelector('[data-testid="stroke-hit"]');
    if (painted === null || target === null) return null;
    // getBBox is the element's own geometry in its own units, which for a path drawn in the
    // world layer are board units: the zoom is a transform above it and never in it.
    const geometry = (painted as SVGGraphicsElement).getBBox();
    return {
      color: element.dataset.color ?? '',
      thickness: element.dataset.thickness ?? '',
      selected: element.dataset.selected === 'true',
      box: {
        x: Number.parseFloat(element.style.left),
        y: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      },
      d: painted.getAttribute('d') ?? '',
      strokeWidth: Number.parseFloat(painted.getAttribute('stroke-width') ?? '0'),
      hitWidth: Number.parseFloat(target.getAttribute('stroke-width') ?? '0'),
      paint: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
    };
  }, strokeSelector(id));
  return read === null ? null : { id, ...read, ink: pointsOnPath(read.d) };
}

/** The one stroke on this screen, and the id to refer to it by. */
export async function onlyStroke(who: Participant): Promise<StrokeInfo> {
  const ids = await strokeIds(who);
  if (ids.length !== 1) throw new Error(`expected one stroke, found ${String(ids.length)}`);
  const found = await stroke(who, ids[0] as string);
  if (found === null) throw new Error('that stroke is not on this screen');
  return found;
}

/** The centre of a stroke's box, in board units. */
export async function strokeCentre(who: Participant, id: string): Promise<Point> {
  const found = await stroke(who, id);
  if (found === null) throw new Error(`there is no stroke "${id}" on this screen`);
  return { x: found.box.x + found.box.width / 2, y: found.box.y + found.box.height / 2 };
}

/**
 * The points a path's `d` passes through, in the units the path is written in.
 *
 * A quadratic Bézier of the kind `smoothPath` writes goes through its start and through the
 * end of every segment, leaning towards the control point in between without touching it. So
 * the start and the segment ends are on the line, and the control points are not: only the
 * ones that are on the line are handed back, because a test uses them to click on the line.
 */
export function pointsOnPath(d: string): Point[] {
  const numbers = (text: string): number[] =>
    (text.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
  const points: Point[] = [];
  const move = /^M\s*(-?[\d.eE+-]+)[ ,]+(-?[\d.eE+-]+)/.exec(d.trim());
  if (move !== null) {
    points.push({ x: Number(move[1]), y: Number(move[2]) });
  }
  for (const segment of d.match(/Q[^Q]*/g) ?? []) {
    const values = numbers(segment);
    // Control point first, then the point the curve reaches: the second of the four.
    for (let index = 2; index + 1 < values.length; index += 2) {
      points.push({ x: values[index] as number, y: values[index + 1] as number });
    }
  }
  return points;
}

/** How a screen's strokes are laid out, as one comparable string. */
export const strokeKey = async (who: Participant): Promise<string> => {
  const ids = (await strokeIds(who)).slice().sort();
  const read: unknown[] = [];
  for (const id of ids) {
    const found = await stroke(who, id);
    read.push(
      found === null
        ? id
        : [id, found.color, found.thickness, Math.round(found.box.x), Math.round(found.box.y)],
    );
  }
  return JSON.stringify(read);
};

/** Wait until this screen shows exactly the strokes a test expects. */
export async function waitForStrokeIds(who: Participant, expected: string[]): Promise<void> {
  await expect
    .poll(async () => JSON.stringify((await strokeIds(who)).slice().sort()), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [100],
      message: `the strokes on this screen are not ${String(expected)}`,
    })
    .toBe(JSON.stringify(expected.slice().sort()));
  await settle(who.page);
}

/** Wait for a stroke to leave this screen, which is what another person's delete does. */
export async function waitForStrokeGone(who: Participant, id: string): Promise<void> {
  await expect
    .poll(async () => (await stroke(who, id)) === null, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [100],
      message: `"${id}" is still on this screen`,
    })
    .toBe(true);
  await settle(who.page);
}

// --- the selection, as it applies to a drawing --------------------------------

/**
 * Where the selection's grips are, in screen pixels.
 *
 * The overlay puts a grip on every corner and every edge of the box a selection holds, and a
 * closed drawing's line runs under the edge ones: a press on a grip resizes, which is a
 * different thing entirely from the move or the choice a test means to make.
 */
export async function resizeHandleCentres(who: Participant): Promise<Point[]> {
  return who.page.$$eval('[data-testid="resize-handle"]', (elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
}

/**
 * Where to put a pointer on a drawing: on the painted line, and as far from those grips as
 * the line allows. The candidate points are the ones the path passes through, so this is a
 * point on the ink by construction, not a guess at where the ink might be.
 *
 * Points under the tool rail are not candidates at all. The rail is `position: fixed` over
 * the board and stops the pointer, so a press there selects a tool and draws nothing — and
 * the rail is centred vertically, so how far up that reaches depends on how many buttons it
 * happens to hold: story 10's own e2e learned that when a taller rail swallowed a drag. A
 * drawing that lies under the rail is clicked at whatever part of its line is clear.
 */
async function pressPoint(who: Participant, found: StrokeInfo): Promise<Point> {
  const camera = await viewOf(who);
  const grips = await resizeHandleCentres(who);
  let best = { x: 0, y: 0 };
  let furthest = -1;
  let bestClear = { x: 0, y: 0 };
  let furthestClear = -1;
  for (const point of found.ink) {
    const spot = {
      x: (point.x - camera.x) * camera.zoom,
      y: (point.y - camera.y) * camera.zoom,
    };
    const clearance =
      grips.length === 0
        ? 1
        : Math.min(...grips.map((grip) => Math.hypot(grip.x - spot.x, grip.y - spot.y)));
    if (clearance > furthest) {
      furthest = clearance;
      best = spot;
    }
    if (spot.x > RAIL_RIGHT_PX && clearance > furthestClear) {
      furthestClear = clearance;
      bestClear = spot;
    }
  }
  return inside(furthestClear >= 0 ? bestClear : best);
}

/** Click the painted line of a stroke: the only place a drawing may be clicked. */
export async function clickStroke(who: Participant, id: string): Promise<void> {
  const found = await stroke(who, id);
  if (found === null) throw new Error(`there is no stroke "${id}" on this screen`);
  const spot = await pressPoint(who, found);
  await who.page.mouse.click(spot.x, spot.y);
  await settle(who.page);
}

/** Drag a stroke's body from one point on its line to a board distance away. */
export async function dragStroke(
  who: Participant,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  const found = await stroke(who, id);
  if (found === null) throw new Error(`there is no stroke "${id}" on this screen`);
  const from = await pressPoint(who, found);
  const zoom = await zoomOf(who);
  const to = inside({ x: from.x + dx * zoom, y: from.y + dy * zoom });
  await who.page.mouse.move(from.x, from.y);
  await who.page.mouse.down();
  await who.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await who.page.mouse.move(to.x, to.y, { steps: 5 });
  await who.page.mouse.up();
  await settle(who.page);
}

/** A handle of the chosen drawing, dragged by a given board distance. */
export async function dragHandle(
  who: Participant,
  handle: string,
  dx: number,
  dy: number,
): Promise<void> {
  const locator = who.page.locator(`[data-testid="resize-handle"][data-handle="${handle}"]`);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`the "${handle}" handle has no box`);
  const from = inside({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const zoom = await zoomOf(who);
  const to = inside({ x: from.x + dx * zoom, y: from.y + dy * zoom });
  await who.page.mouse.move(from.x, from.y);
  await who.page.mouse.down();
  await who.page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await who.page.mouse.move(to.x, to.y, { steps: 4 });
  await who.page.mouse.up();
  await settle(who.page);
}

/** How many resize handles this screen offers the selection, and which corners. */
export const resizeHandles = (who: Participant): Promise<string[]> =>
  who.page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="resize-handle"]')).map(
      (element) => (element as HTMLElement).dataset.handle as string,
    ),
  );

/** The box the selection draws round what it holds, in screen pixels. */
export const selectionBoxVisible = (who: Participant): Promise<boolean> =>
  who.page.evaluate(() => document.querySelector('[data-testid="selection-box"]') !== null);

/** Everything a test wants to know about a drawing and its selection at once. */
export interface StrokeAndSelection {
  stroke: StrokeInfo;
  selected: boolean;
  handles: string[];
}

export async function strokeAndSelection(who: Participant, id: string): Promise<StrokeAndSelection> {
  const found = await stroke(who, id);
  if (found === null) throw new Error(`there is no stroke "${id}" on this screen`);
  return {
    stroke: found,
    selected: found.selected,
    handles: await resizeHandles(who),
  };
}
