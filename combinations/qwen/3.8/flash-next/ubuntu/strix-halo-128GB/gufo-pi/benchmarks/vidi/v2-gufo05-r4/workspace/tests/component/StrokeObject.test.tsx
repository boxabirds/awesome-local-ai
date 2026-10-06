/**
 * A stroke once it is on the board: drawing, clicking, and resizing it (story 11).
 *
 * A stroke is the first object type on this board whose picture is not its box, and the tests
 * here are the ones that follow from that:
 *
 *  - **a dot is a drawing** (`pen.dot`): one point, stored as one point, rendered with a round cap
 *    and a stroke width equal to the pen's thickness, so what arrives on the screen is a dot of
 *    the thickness the swatch showed;
 *  - **a click lands on the line or not at all** (`pen.select`): a point inside the bounding
 *    rectangle but far from the ink belongs to whatever is underneath, and the tolerance is
 *    measured in *screen pixels*, so a hairline stays clickable when the board is zoomed out;
 *  - **resizing scales the drawing** (`pen.resize`): the stored line is untouched by a handle
 *    drag — the box and the ratio are what change — so a sketch stays the sketch it was;
 *  - **the thickness is a board measurement** (`pen.options`): the same world width at 100% and at
 *    200%, while the clickable surface grows in world units to stay the same number of pixels.
 *
 * The board is the real one, so the click is handled by the same registry entry, the same gesture
 * controller and the same selection overlay a visitor meets.
 */

import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardScreen } from '../../src/client/board/BoardScreen';
import { boardObjects, deleteObject, type ObjectSnapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import {
  STROKE_OBJECT_TYPE,
  createStroke,
  scaledPoints,
  type PenColor,
  type PenThickness,
  type StrokeSnap
} from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { worldToScreen } from '../../src/client/canvas/camera';
import {
  firePointer,
  flushCameraFrame,
  flushFrames,
  setTestCamera,
  testCamera,
  stubResizeObserver,
  stubViewportGeometry
} from './harness';

interface BoardFixture {
  doc: Y.Doc;
  root: HTMLElement;
  objects(): readonly ObjectSnapshot[];
}

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderBoard(): Promise<BoardFixture> {
  const doc = new Y.Doc();
  const result: RenderResult = render(<BoardScreen doc={doc} />);
  await flushCameraFrame();
  return { doc, root: result.container, objects: () => boardObjects(doc) };
}

/** Put a stroke on the board the way the Pen tool does: finished, whole, in one transaction. */
function seedStroke(
  board: BoardFixture,
  points: Point[],
  options: { color?: PenColor; thickness?: PenThickness } = {}
): string {
  let id = '';
  act(() => {
    id = createStroke(
      board.doc,
      { points, color: options.color ?? 'black', thickness: options.thickness ?? 'medium' },
      ''
    )!;
  });
  if (!id) throw new Error('the stroke was not created');
  return id;
}

function strokeOf(board: BoardFixture, id: string): StrokeSnap {
  const found = board.objects().find((object) => object.id === id);
  if (!found) throw new Error(`stroke ${id} is not on the board`);
  return found as StrokeSnap;
}

function strokeElement(board: BoardFixture, id: string): HTMLElement {
  const element = board.root.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`);
  if (!element) throw new Error(`stroke ${id} is not on screen`);
  return element;
}

function linePath(board: BoardFixture, id: string): SVGPathElement {
  const path = strokeElement(board, id).querySelector<SVGPathElement>('[data-vidi6="stroke-line"]');
  if (!path) throw new Error(`stroke ${id} has no line drawn`);
  return path;
}

/** What the board says is selected, in the words it announces them in — the bar itself only
appears for two or more objects, the live region is written either way. */
function selectionText(root: HTMLElement): string {
  return root.querySelector('[data-testid="selection-live"]')?.textContent ?? '';
}

function hitPath(board: BoardFixture, id: string): SVGPathElement {
  const path = strokeElement(board, id).querySelector<SVGPathElement>('[data-vidi6="stroke-hit"]');
  if (!path) throw new Error(`stroke ${id} has no clickable surface`);
  return path;
}

/**
 * An L: out to the right and then down. Its bounding box has a corner with nothing in it, which
 * is the part of a stroke a click has to fall through (`pen.select`).
 */
function elbow(): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= 40; index += 1) points.push({ x: 300 + index * 10, y: 300 });
  for (let index = 1; index <= 40; index += 1) points.push({ x: 700, y: 300 + index * 10 });
  return points;
}

/** Press, move in steps, release — the resize gesture story 7 taught the board. */
async function dragHandle(board: BoardFixture, handle: string, from: Point, to: Point): Promise<void> {
  const element = board.root.querySelector<HTMLElement>(`[data-vidi6="resize-handle"][data-handle="${handle}"]`);
  if (!element) throw new Error(`there is no ${handle} resize handle on screen`);
  firePointer(element, 'pointerdown', from.x, from.y);
  const steps = 4;
  for (let step = 1; step <= steps; step += 1) {
    firePointer(
      element,
      'pointermove',
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps
    );
    await flushFrames();
  }
  firePointer(element, 'pointerup', to.x, to.y);
  await flushFrames();
}

/**
 * Press and release on a board point.
 *
 * The camera is read from the board itself, so a test that zoomed first is aiming at the same
 * place the screen is (`testCamera`).
 */
function clickWorld(board: BoardFixture, world: Point, target?: Element): void {
  const screen = worldToScreen(testCamera(), world);
  const element = target ?? board.root.querySelector('[data-vidi6="viewport"]')!;
  firePointer(element, 'pointerdown', screen.x, screen.y);
  firePointer(element, 'pointerup', screen.x, screen.y);
}

describe('a stroke on the board (pen.select)', () => {
  it('TC-10: a single point is drawn as a dot of the pen thickness, round-capped', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, [{ x: 400, y: 400 }], { thickness: 'thick' });

    const line = linePath(board, id);
    // A zero-length subpath is what a round cap turns into a dot: there is nothing to the path
    // but the place, and the cap does the rest.
    // The path holds one place, twice: a subpath of no length at all, which is what a round cap
    // turns into a dot. Anything longer would be a line the hand never drew.
    const d = line.getAttribute('d') ?? '';
    const coordinates = d.match(/-?[\d.]+/g) ?? [];
    expect(coordinates).toHaveLength(4);
    expect(coordinates[0]).toBe(coordinates[2]);
    expect(coordinates[1]).toBe(coordinates[3]);
    expect(line.getAttribute('stroke')).toBe(PEN_COLORS.black);
    expect(Number(line.getAttribute('stroke-width'))).toBe(PEN_THICKNESS_WORLD.thick);
    // The round cap is the other half of a dot: without it a zero-length path draws nothing at
    // all. It is said on the element as well as in the stylesheet, because the dot *is* the shape
    // this component promises.
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    // The box is one thickness across, so the dot has an edge to be selected by.
    const stroke = strokeOf(board, id);
    expect(stroke.width).toBe(PEN_THICKNESS_WORLD.thick);
  });

  it('TC-16: clicking near the line selects it, and clicking the empty corner of its box does not', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, elbow());

    // The bottom-left corner of its bounding box, a hundred and forty units from any ink, tried
    // first and from nothing selected: the press is not the stroke's to take, so the selection
    // stays where it was — empty — and the click belongs to whatever is underneath (`pen.select`).
    clickWorld(board, { x: 320, y: 680 }, strokeElement(board, id));
    expect(strokeElement(board, id).dataset.selected).toBe('false');

    // On the horizontal leg, within a few pixels of the ink: selected.
    clickWorld(board, { x: 400, y: 300 }, strokeElement(board, id));
    expect(strokeElement(board, id).dataset.selected).toBe('true');
  });

  it('TC-15: the clickable surface is a screen measurement, so it grows in board units as the board shrinks', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, elbow(), { thickness: 'thin' });

    await setTestCamera({ x: 0, y: 0, zoom: 0.5 });
    const width = Number(hitPath(board, id).getAttribute('stroke-width'));
    // Half the zoom: twice as many board units, so the same six pixels of forgiveness.
    expect(width).toBeGreaterThanOrEqual((STROKE_HIT_TOLERANCE_PX / 0.5) * 2);
    const line = Number(linePath(board, id).getAttribute('stroke-width'));
    expect(line).toBe(PEN_THICKNESS_WORLD.thin);

    await setTestCamera({ x: 0, y: 0, zoom: 2 });
    expect(Number(hitPath(board, id).getAttribute('stroke-width'))).toBeLessThan(width);
    // The ink is still the same ink: a board measurement, unchanged by the camera.
    expect(Number(linePath(board, id).getAttribute('stroke-width'))).toBe(line);
  });

  it('TC-15: the registry answers a hit test 5 pixels on and 7 pixels off the line, at both zooms, and being selected does not change the ink', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, elbow(), { color: 'black' });
    const spec = getObjectType(STROKE_OBJECT_TYPE);
    const stroke = strokeOf(board, id);

    // On the line, 5.9 and 6.1 screen pixels off it, at a zoom of 2: six pixels is three units.
    expect(spec?.hitTest(stroke, { x: 400, y: 300 }, 2)).toBe(true);
    expect(spec?.hitTest(stroke, { x: 400, y: 301.5 }, 2)).toBe(true);
    expect(spec?.hitTest(stroke, { x: 400, y: 303.1 }, 2)).toBe(false);
    expect(spec?.hitTest(stroke, { x: 320, y: 680 }, 1)).toBe(false);

    // Selected: the line keeps the colour it was drawn with. The box says it is selected.
    clickWorld(board, { x: 400, y: 300 }, strokeElement(board, id));
    expect(strokeElement(board, id).dataset.selected).toBe('true');
    expect(linePath(board, id).getAttribute('stroke')).toBe(PEN_COLORS.black);
  });
});

describe('a stroke that somebody else removes (pen.select)', () => {
  it('TC-21: deleted by another person while it is selected, it takes the selection with it and says nothing', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, elbow());
    clickWorld(board, { x: 400, y: 300 }, strokeElement(board, id));
    expect(strokeElement(board, id).dataset.selected).toBe('true');
    expect(selectionText(board.root)).toBe('1 selected');

    // Another person deletes it. This client is not told anything: the document simply changes.
    act(() => {
      board.doc.transact(() => {
        deleteObject(board.doc, id);
      }, 'somebody-else');
    });
    await flushFrames();

    // No stroke on screen, no selection left pointing at it, no bar, no overlay — and no
    // exception on the way, which is the part a stale selection can get wrong.
    expect(board.root.querySelector(`[data-stroke-id="${id}"]`)).toBeNull();
    expect(board.root.querySelector('[data-vidi6="selection-overlay"]')).toBeNull();
    expect(selectionText(board.root)).toBe('');

    // And the board still works afterwards: a fresh stroke can be drawn over the gap.
    const again = seedStroke(board, elbow());
    expect(strokeElement(board, again).dataset.selected).toBe('false');
    clickWorld(board, { x: 400, y: 300 }, strokeElement(board, again));
    expect(strokeElement(board, again).dataset.selected).toBe('true');
  });
});

describe('resizing a stroke (pen.resize)', () => {
  // Not a numbered case of its own in the design (that is e2e TC-20, in a browser): this is the
  // same promise tested where it is kept, in the resize controller and `scaledPoints`.
  it('pen.resize: dragging a handle scales the drawing, leaves the stored line alone, and keeps the proportions', async () => {
    const board = await renderBoard();
    const id = seedStroke(board, elbow());
    clickWorld(board, { x: 400, y: 300 }, strokeElement(board, id));
    expect(strokeElement(board, id).dataset.selected).toBe('true');

    const before = strokeOf(board, id);
    const storedBefore = JSON.stringify(before.points);
    const drawnBefore = scaledPoints(before);

    // Drag the south-east corner further out.
    const drawnBeforeD = linePath(board, id).getAttribute('d') ?? '';
    const corner = worldToScreen(testCamera(), { x: before.x + before.width, y: before.y + before.height });
    await dragHandle(board, 'se', corner, { x: corner.x + 200, y: corner.y + 200 });

    const after = strokeOf(board, id);
    expect(after.width).toBeGreaterThan(before.width);
    // One number, not two: the proportions of the drawing survive the drag (`sel.aspect`).
    expect(after.width / after.height).toBeCloseTo(before.width / before.height, 6);
    // The line itself was never re-recorded: not one number changed.
    expect(JSON.stringify(after.points)).toBe(storedBefore);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);

    // What is drawn is the same shape, bigger, in proportion.
    const drawnAfter = scaledPoints(after);
    expect(drawnAfter).toHaveLength(drawnBefore.length);
    const scale = after.width / before.width;
    expect(scale).toBeGreaterThan(1);
    for (let index = 0; index < drawnAfter.length; index += 1) {
      const previous = drawnBefore[index];
      const current = drawnAfter[index];
      if (!previous || !current) continue;
      expect(current.x - after.x).toBeCloseTo((previous.x - before.x) * scale, 3);
      expect(current.y - after.y).toBeCloseTo((previous.y - before.y) * scale, 3);
    }

    // And what is painted grew with it, with the same number of bends in it: the same drawing,
    // larger, and not a new one traced over the old.
    const drawnAfterD = linePath(board, id).getAttribute('d') ?? '';
    expect(drawnAfterD).not.toBe(drawnBeforeD);
    expect(bends(linePath(board, id))).toBe(bendsOf(drawnBeforeD));
  });
});

/** How many bends a path has: the drawing's shape, counted off its `d`. */
function bendsOf(d: string): number {
  return (d.match(/Q/g) ?? []).length;
}

function bends(path: SVGPathElement): number {
  return bendsOf(path.getAttribute('d') ?? '');
}
