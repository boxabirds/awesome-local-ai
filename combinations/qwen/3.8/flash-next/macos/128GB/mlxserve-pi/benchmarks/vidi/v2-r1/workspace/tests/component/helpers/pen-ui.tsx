// Driving a board that has drawings on it (story 11's component tests).
//
// Built on the drivers that are already here (`board-ui.tsx`, `text-ui.tsx`,
// `shape-ui.tsx`) rather than beside them: the same fake provider, the same real
// `<Board>`, and the same rule that a thing is asserted by what ends up in the document
// rather than by calling the model and hoping it looked right on the screen.
//
// Two things here are new to a pen and worth naming:
//
//   - A drawing tool is a sheet over the board, in screen space, so a gesture with the pen
//     up is dispatched **on that sheet** — which is what a browser does with a pointer over
//     it. A test that dispatched its drag on the viewport instead would be asserting that a
//     tool's sheet does not catch the pointer, which is not what one does.
//
//   - A pen records every point it is given, so the driver takes a *path* rather than a
//     start and an end, and decides how often to let a frame happen (`stride`). Flushing on
//     every point is what a real hand does; flushing every few hundred is what a test that
//     is about five thousand of them can afford.
import { act, fireEvent, screen, within } from '@testing-library/react';
import { objectBounds, snapshotObjects } from '../../../src/shared/board-model';
import {
  createStroke,
  readStrokeSnapshot,
  scaledPoints,
  type StrokeSnapshot,
} from '../../../src/shared/objects/stroke';
import { smoothPath } from '../../../src/shared/geometry/simplify';
import type { Rect } from '../../../src/shared/geometry';
import type { PenColor, PenThickness } from '../../../src/shared/config';
import type { Point } from '../../../src/client/canvas/camera';
import { dispatchPointer } from './events';

export { dispatchPointer };
import { doc, flush, pressKey, screenOfPoint } from './text-ui';

export {
  advance,
  camera,
  clickEmpty,
  doc,
  FakeWebsocketProvider,
  flush,
  open,
  pressEscape,
  pressKey,
  pressSelectTool,
  pressTextTool,
  screenOfPoint,
  selectToolActive,
  setCameraTo,
  textToolActive,
  VIEWPORT,
} from './shape-ui';

export {
  pressUndo,
  pressRedo,
  marquee,
  drag,
  makeNote,
  settleBeyondCaptureWindow,
  dragSlow,
  dragCancelled,
} from './board-ui';

// --- the tool ----------------------------------------------------------------

/** Ask for the Pen tool the way a person does: `P`. */
export const pressPenTool = (): void => pressKey({ key: 'p' });

const pressed = (testId: string): boolean =>
  (screen.getByTestId(testId) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';

export const penToolActive = (): boolean => pressed('tool-pen');

/** The pen's sheet: the element that catches the pointer while the pen is up. */
export const penSheet = (): HTMLElement => screen.getByTestId('pen-tool');

/** The pen's own options panel, which is up only while the pen is. */
export const penToolbar = (): HTMLElement => screen.getByTestId('pen-toolbar');

/** Nothing over the board: the board itself has the pointer again. */
export const noSheetIsUp = (): boolean => screen.queryByTestId('pen-tool') === null;

/** Click a colour swatch or a thickness button by the name it carries. */
export const clickPenColor = (color: PenColor): void => {
  fireEvent.click(screen.getByTestId(`pen-color-${color}`) as HTMLButtonElement);
  flush();
};

export const clickPenThickness = (thickness: PenThickness): void => {
  fireEvent.click(screen.getByTestId(`pen-thickness-${thickness}`) as HTMLButtonElement);
  flush();
};

export const penColorPressed = (color: PenColor): boolean =>
  (screen.getByTestId(`pen-color-${color}`) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';

export const penThicknessPressed = (thickness: PenThickness): boolean =>
  (screen.getByTestId(`pen-thickness-${thickness}`) as HTMLButtonElement).getAttribute('aria-pressed') === 'true';

/** How many colours and thicknesses the pen offers, so a test can count them. */
export const penColorButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll('[data-testid^="pen-color-"]')) as HTMLButtonElement[];

export const penThicknessButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll('[data-testid^="pen-thickness-"]')) as HTMLButtonElement[];

/** The stroke the pen is drawing right now, on this screen only, or null. */
export const penPreview = (): HTMLElement | null => screen.queryByTestId('pen-tool-preview');

/** Its `d`, which is what "the preview follows the pointer" is measured by. */
export const penPreviewD = (): string | null => {
  const path = screen.queryByTestId('pen-tool-preview-path');
  return path === null ? null : (path.getAttribute('d') ?? '');
};

/** The round mark that stands where the pen's thickness will land. */
export const penCursor = (): HTMLElement | null => screen.queryByTestId('pen-tool-cursor');

interface DrawOptions {
  /** Ask for the pen first. True unless a test is mid-tool already. */
  pressTool?: boolean;
  /** Let a frame happen every `stride` points; 0 draws without a frame in between. */
  stride?: number;
  /** Which button, so a right-click can be shown to be ignored. */
  button?: number;
}

/**
 * Draw a path with the pen: press at the first point, travel through the rest, let go at
 * the last. Returns the ids of the strokes that came of it, oldest first — normally one,
 * and two once the path passes `STROKE_MAX_POINTS` (`pen.long_stroke`).
 */
export function drawStroke(points: readonly Point[], options: DrawOptions = {}): string[] {
  const { pressTool = true, stride = 1, button = 0 } = options;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) throw new Error('drawStroke needs at least one point');
  const before = strokeIds();
  if (pressTool) pressPenTool();
  const sheet = penSheet();
  const start = screenOfPoint(first);
  dispatchPointer(sheet, 'pointerdown', start.x, start.y, { button });
  if (button !== 0) {
    // A press that is not the pen: nothing is being drawn, and the board under the sheet
    // must not have taken it either.
    flush();
    return [];
  }
  flush();
  for (let step = 1; step < points.length; step += 1) {
    const at = screenOfPoint(points[step] as Point);
    dispatchPointer(sheet, 'pointermove', at.x, at.y);
    if (stride > 0 && step % stride === 0) flush();
  }
  const end = screenOfPoint(last);
  dispatchPointer(sheet, 'pointerup', end.x, end.y);
  flush();
  return strokeIds().filter((id) => !before.includes(id));
}

/** Press and let go in one place without moving: a dot (`pen.dot`). */
export function dotWithPen(at: Point, options: DrawOptions = {}): string[] {
  return drawStroke([at], options);
}

/**
 * Draw a path and never let go: the pen is still down, the preview still up. The test that
 * follows finishes it with `releasePen` or interrupts it with `interruptPen`.
 */
export function pressPen(points: readonly Point[], options: DrawOptions = {}): void {
  const { pressTool = true, stride = 1 } = options;
  if (pressTool) pressPenTool();
  const sheet = penSheet();
  const start = screenOfPoint(points[0] as Point);
  dispatchPointer(sheet, 'pointerdown', start.x, start.y);
  flush();
  for (let step = 1; step < points.length; step += 1) {
    const at = screenOfPoint(points[step] as Point);
    dispatchPointer(sheet, 'pointermove', at.x, at.y);
    if (stride > 0 && step % stride === 0) flush();
  }
}

/** Let go of the pen where it is: the stroke is made from what was drawn. */
export function releasePen(at: Point): void {
  const spot = screenOfPoint(at);
  dispatchPointer(penSheet(), 'pointerup', spot.x, spot.y);
  flush();
}

/** The browser takes the pointer away mid-drag: what was drawn is kept (`pen.interrupted`). */
export function interruptPen(at: Point): void {
  const spot = screenOfPoint(at);
  dispatchPointer(penSheet(), 'pointercancel', spot.x, spot.y);
  flush();
}

/** A click on the pen's sheet, wherever the pen is: used to show it draws nothing extra. */
export function clickPenSheet(at: Point): void {
  const spot = screenOfPoint(at);
  dispatchPointer(penSheet(), 'pointerdown', spot.x, spot.y);
  flush();
  dispatchPointer(penSheet(), 'pointerup', spot.x, spot.y);
  flush();
}

/**
 * One pointer move carrying the samples a real browser coalesced into it (`pen.draw`).
 * jsdom has no `getCoalescedEvents`, so this builds the event the tool reads: a move whose
 * own position is the last sample, and whose `getCoalescedEvents` answers the whole run.
 * Without this there is no way to test, in jsdom, that the tool does not throw the
 * in-between of a fast stroke away.
 */
export function dispatchCoalescedMove(sheet: Element, samples: readonly Point[]): Event {
  const last = samples[samples.length - 1];
  if (last === undefined) throw new Error('a coalesced move needs at least one sample');
  const event = new Event('pointermove', { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: last.x,
    clientY: last.y,
    screenX: last.x,
    screenY: last.y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    pressure: 0.5,
    width: 1,
    height: 1,
    getCoalescedEvents: () => samples.map((sample) => ({ clientX: sample.x, clientY: sample.y })),
  });
  fireEvent(sheet, event);
  return event;
}

/** The screen positions of a run of world points: what a coalesced move is given. */
export const screenOfPoints = (points: readonly Point[]): Point[] =>
  points.map((point) => screenOfPoint(point));

// --- the objects -------------------------------------------------------------

const idsOf = (type: string): string[] =>
  snapshotObjects(doc())
    .filter((object) => object.type === type)
    .map((object) => object.id);

export const strokeIds = (): string[] => idsOf('stroke');

export function strokeObject(id: string): StrokeSnapshot {
  const object = readStrokeSnapshot(doc(), id);
  if (!object) throw new Error(`"${id}" is not a stroke in the document`);
  return object;
}

/** The box a stroke is drawn in, as the board reads it. */
export const strokeBox = (id: string): Rect => objectBounds(strokeObject(id));

/** The points as they are drawn at the stroke's current size, in world units. */
export const strokeDrawnPoints = (id: string): Point[] => scaledPoints(strokeObject(id));

/** The path the screen paints for a stroke. */
export const strokeD = (id: string): string => smoothPath(strokeDrawnPoints(id));

// --- the elements ------------------------------------------------------------

const elements = (testId: string): HTMLElement[] => screen.queryAllByTestId(testId) as HTMLElement[];

export const strokeElements = (): HTMLElement[] => elements('stroke-object');

export function strokeElement(id: string): HTMLElement {
  const found = strokeElements().find((element) => element.dataset.id === id);
  if (!found) throw new Error(`no stroke "${id}" on the screen`);
  return found;
}

/** Which strokes the board says are selected. */
export const selectedStrokeIds = (): string[] =>
  strokeElements()
    .filter((element) => element.dataset.selected === 'true')
    .map((element) => element.dataset.id as string);

/** The `d` the screen actually paints for a stored stroke, read off the element. */
export function drawnD(id: string): string {
  const path = within(strokeElement(id)).getByTestId('stroke-path');
  return path.getAttribute('d') ?? '';
}

/** The invisible target a stroke is clicked by, and how wide it is in board units. */
export function strokeHitPath(id: string): HTMLElement {
  return within(strokeElement(id)).getByTestId('stroke-hit');
}

export const strokeHitWidth = (id: string): number =>
  Number.parseFloat(strokeHitPath(id).getAttribute('stroke-width') ?? '0');

/** The colour and width the visible path is painted with. */
export const strokePaint = (id: string): { stroke: string; width: number } => {
  const path = within(strokeElement(id)).getByTestId('stroke-path');
  return {
    stroke: path.getAttribute('stroke') ?? '',
    width: Number.parseFloat(path.getAttribute('stroke-width') ?? '0'),
  };
};

// --- scenery -----------------------------------------------------------------

/**
 * A stroke put in through the model, because it is scenery rather than the thing under
 * test. The pen's own way of making a stroke is what the tests below are about; a test
 * that needed three strokes to click between would be a worse test for drawing them.
 */
export function makeStroke(
  points: readonly Point[],
  options: { color?: PenColor; thickness?: PenThickness; id?: string } = {},
): string {
  let id = '';
  act(() => {
    const created = createStroke(
      doc(),
      { points, color: options.color ?? 'black', thickness: options.thickness ?? 'medium' },
      'scenery',
    );
    if (created === null) throw new Error('the model refused a stroke this test asked for');
    id = created;
  });
  flush();
  return id;
}
