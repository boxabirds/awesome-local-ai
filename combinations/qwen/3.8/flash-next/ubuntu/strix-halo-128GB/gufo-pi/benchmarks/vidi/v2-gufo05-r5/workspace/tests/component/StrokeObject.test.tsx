/**
 * A finished stroke on the board (story 11), TC-15, TC-16, TC-21 and the two model rules the picture
 * has to keep its word about.
 *
 * A stroke is drawn by the same two functions that answer every other question about it - `scaledPoints`
 * for where the ink is now that the box has been moved and resized, `hitStroke` for where a click counts
 * as a hit - so the tests here are mostly about the two agreeing. The invisible path is as wide as the
 * rule, the visible one is drawn from the same points the model reads, and resizing the box moves the
 * ink with it in proportion.
 *
 * One limit worth saying out loud: jsdom does no hit testing, so CSS `pointer-events` is not applied and
 * a click fired at an element reaches it whatever its style says. What a component test can therefore
 * prove is the pair the browser ends up trusting - the geometry rule, and the width of the path the
 * browser measures clicks against - which together are what make TC-16 come out right on a real board.
 * The click-itself half is carried by the end-to-end suite.
 */
import { act } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { describe, expect, test, vi } from 'vitest';
import type * as Y from 'yjs';
import { renderBoard, runFrames } from './helpers';
import {
  createSticky,
  deleteObjects,
  isStrokeSnapshot,
  moveObjects,
  objectBounds,
  resizeObjects,
  type StrokeSnapshot,
} from '../../src/shared/board-model';
import type { Point, Rect } from '../../src/shared/geometry';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { scaledPoints, createStroke, hitStroke } from '../../src/shared/objects/stroke';
import { smoothPath } from '../../src/shared/geometry/simplify';
import { getObjectType } from '../../src/client/objects/registry';

vi.useFakeTimers();

const pointer = (clientX: number, clientY: number, opts?: Record<string, unknown>) => ({
  pointerId: 7,
  pointerType: 'mouse',
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...opts,
});

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function strokeById(id: string): StrokeSnapshot {
  const found = (window.__vidi6?.getObjects() ?? []).find(
    (obj) => obj.id === id && isStrokeSnapshot(obj),
  );
  if (!found || !isStrokeSnapshot(found)) throw new Error(`stroke ${id} is not on the board`);
  return found;
}

function elementOf(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`);
  if (!el) throw new Error(`stroke ${id} is not rendered`);
  return el;
}

function lineOf(id: string): SVGPathElement {
  const el = document.querySelector<SVGPathElement>(
    `[data-stroke-id="${id}"] [data-testid="stroke-line"]`,
  );
  if (!el) throw new Error(`stroke ${id} has no visible path`);
  return el;
}

function hitPathOf(id: string): SVGPathElement {
  const el = document.querySelector<SVGPathElement>(
    `[data-stroke-id="${id}"] [data-testid="stroke-hit"]`,
  );
  if (!el) throw new Error(`stroke ${id} has no hit path`);
  return el;
}

async function setCameraAt(zoom: number): Promise<void> {
  window.__vidi6!.setCamera({ x: 0, y: 0, zoom });
  await runFrames();
  await runFrames();
}

async function openBoard(): Promise<void> {
  renderBoard();
  await runFrames();
  await setCameraAt(1);
}

/** A stroke made the way the model means it to be made, at a stated thickness. */
async function addStroke(
  points: readonly Point[],
  thickness: 'thin' | 'medium' | 'thick' = 'thin',
): Promise<string> {
  let id = '';
  await act(() => {
    id = createStroke(doc(), { points, color: 'black', thickness }, 'local') ?? '';
  });
  await runFrames();
  return id;
}

/** A horizontal line at y = 200, from x = 200 to x = 600. */
const STRAIGHT: readonly Point[] = [
  { x: 200, y: 200 },
  { x: 400, y: 200 },
  { x: 600, y: 200 },
];

describe('a stroke is selected by its line (TC-15)', () => {
  test('the registry answers for the stroke type, with the box rules the Pen needs', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    // pen.resize: a drawing grows in proportion or not at all
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    // a drawing has nothing to type
    expect(spec!.editableText).toBe(false);
  });

  test('TC-15 a click 5 px off the line is a hit and 7 px off is not, at 50%, 100% and 200%', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);
    const spec = getObjectType('stroke')!;
    const stroke = strokeById(id);

    for (const zoom of [0.5, 1, 2]) {
      // a distance stated in *screen* pixels, converted to the world units that zoom is drawing them in
      const onLine: Point = { x: 400, y: 200 };
      // A distance stated in screen pixels, in world units: the world is `zoom` times smaller or
      // bigger than the screen, so a 5 px offset is 5 / zoom world units.
      const screenPx = (px: number): Point => ({ x: onLine.x, y: onLine.y + px / zoom });

      expect(spec.hitTest(stroke, onLine, zoom)).toBe(true);
      // just inside the tolerance, and just outside it
      expect(spec.hitTest(stroke, screenPx(STROKE_HIT_TOLERANCE_PX - 0.1), zoom)).toBe(true);
      expect(spec.hitTest(stroke, screenPx(STROKE_HIT_TOLERANCE_PX + 0.1), zoom)).toBe(false);
      // the two numbers the test is named for
      expect(spec.hitTest(stroke, screenPx(5), zoom)).toBe(true);
      expect(spec.hitTest(stroke, screenPx(7), zoom)).toBe(false);
      // and the same answer the component's own hit path is built from
      expect(hitStroke(stroke, screenPx(5), zoom)).toBe(true);
    }
  });

  test('TC-15 the invisible path the browser measures against is as wide as the rule, at the live zoom', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);

    // 1:1: half the thickness is 1 world unit, the tolerance is 6, so the hit path is 12 wide
    expect(Number(hitPathOf(id).getAttribute('stroke-width'))).toBe(
      STROKE_HIT_TOLERANCE_PX * 2,
    );

    await setCameraAt(2);
    // 200%: 6 screen pixels are 3 world units, so the path narrows to 6 and stays 12 px on screen
    expect(Number(hitPathOf(id).getAttribute('stroke-width'))).toBe(
      (STROKE_HIT_TOLERANCE_PX * 2) / 2,
    );

    await setCameraAt(0.5);
    // 50%: 6 screen pixels are 12 world units, so the path widens to 24 and is still 12 px on screen
    expect(Number(hitPathOf(id).getAttribute('stroke-width'))).toBe(
      (STROKE_HIT_TOLERANCE_PX * 2) / 0.5,
    );

    // a thick nib at a zoomed-in board is thicker than the tolerance, so the line itself wins
    const fat = await addStroke(STRAIGHT, 'thick');
    await setCameraAt(4);
    expect(Number(hitPathOf(fat).getAttribute('stroke-width'))).toBe(
      PEN_THICKNESS_WORLD.thick,
    );
    // and the rule agrees with the picture at that zoom
    const fatStroke = strokeById(fat);
    expect(
      hitStroke(fatStroke, { x: 400, y: 200 + PEN_THICKNESS_WORLD.thick / 2 - 0.5 }, 4),
    ).toBe(true);
    expect(
      hitStroke(fatStroke, { x: 400, y: 200 + PEN_THICKNESS_WORLD.thick / 2 + 0.5 }, 4),
    ).toBe(false);
  });

  test('a press on the line selects the stroke', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);

    fireEvent.pointerDown(hitPathOf(id), pointer(400, 200));
    fireEvent.pointerUp(hitPathOf(id), pointer(400, 200));
    await runFrames();

    expect(elementOf(id)).toHaveAttribute('data-selected', 'true');
    // and it is drawn from the model's own path, not from a copy of it
    expect(lineOf(id).getAttribute('d')).toBe(smoothPath(scaledPoints(strokeById(id))));
  });
});

describe('the empty inside of a drawing is not the drawing (TC-16)', () => {
  test('TC-16 a click inside the box of a loop, far from its line, belongs to what is underneath', async () => {
    await openBoard();
    let noteId = '';
    await act(() => {
      noteId = createSticky(doc(), { x: 340, y: 340 });
    });
    await runFrames();

    // a loop drawn round the note, on top of it: the loop's box swallows the note whole
    const loop: readonly Point[] = [
      { x: 300, y: 300 },
      { x: 620, y: 300 },
      { x: 620, y: 580 },
      { x: 300, y: 580 },
      { x: 300, y: 300 },
    ];
    const id = await addStroke(loop, 'medium');
    const stroke = strokeById(id);

    const note = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
    expect(note).not.toBeNull();

    // the middle of the note is inside the loop's box, and nowhere near its line
    const middle: Point = { x: 440, y: 440 };
    const box = objectBounds(stroke);
    expect(middle.x).toBeGreaterThan(box.x);
    expect(middle.x).toBeLessThan(box.x + box.width);
    expect(middle.y).toBeGreaterThan(box.y);
    expect(middle.y).toBeLessThan(box.y + box.height);
    expect(getObjectType('stroke')!.hitTest(stroke, middle, 1)).toBe(false);
    expect(hitStroke(stroke, middle, 1)).toBe(false);

    // so a click there is a click on the note: the note is selected and the loop is not
    fireEvent.pointerDown(note!, pointer(440, 440));
    fireEvent.pointerUp(note!, pointer(440, 440));
    await runFrames();
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(elementOf(id)).not.toHaveAttribute('data-selected', 'true');

    // and a click on the loop's own line is the other way round
    fireEvent.pointerDown(hitPathOf(id), pointer(440, 300));
    fireEvent.pointerUp(hitPathOf(id), pointer(440, 300));
    await runFrames();
    expect(elementOf(id)).toHaveAttribute('data-selected', 'true');
    expect(
      document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`),
    ).not.toHaveAttribute('data-selected', 'true');
  });
});

describe('a stroke is an ordinary object once it is finished', () => {
  test('moving it moves the box, and the ink comes with it', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);
    const before = strokeById(id);
    const dBefore = lineOf(id).getAttribute('d');

    await act(() => {
      moveObjects(doc(), new Map([[id, { x: before.x + 120, y: before.y + 60 }]]));
    });
    await runFrames();

    const after = strokeById(id);
    expect(after.x).toBeCloseTo(before.x + 120, 9);
    expect(after.y).toBeCloseTo(before.y + 60, 9);
    // the box moved by that much and the path moved with it, one-for-one
    expect(after.width).toBe(before.width);
    expect(lineOf(id).getAttribute('d')).not.toBe(dBefore);
    expect(lineOf(id).getAttribute('d')).toBe(smoothPath(scaledPoints(after)));
    expect(hitStroke(after, { x: 520, y: 260 }, 1)).toBe(true);
    expect(hitStroke(before, { x: 520, y: 260 }, 1)).toBe(false);
  });

  test('resizing the box scales the drawing inside it in proportion', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);
    const before = strokeById(id);

    // the box twice as big, in the same place - what an aspect-locked corner drag writes
    const next: Rect = {
      x: before.x,
      y: before.y,
      width: before.width * 2,
      height: before.height * 2,
    };
    await act(() => {
      resizeObjects(doc(), new Map([[id, next]]));
    });
    await runFrames();

    const after = strokeById(id);
    expect(after.width).toBeCloseTo(before.width * 2, 9);
    // the ink kept its own thickness and doubled its reach
    expect(lineOf(id).getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD.thin),
    );
    const points = scaledPoints(after);
    expect(points[2]!.x).toBeCloseTo(before.x + (scaledPoints(before)[2]!.x - before.x) * 2, 9);
    expect(lineOf(id).getAttribute('d')).toBe(smoothPath(points));
    // the stretched line now reaches where the old one did not
    expect(hitStroke(after, { x: before.x + (scaledPoints(before)[2]!.x - before.x) * 2, y: after.y }, 1)).toBe(
      true,
    );
  });

  test('TC-21 a stroke deleted by someone else while it is selected simply leaves', async () => {
    await openBoard();
    const id = await addStroke(STRAIGHT);

    fireEvent.pointerDown(hitPathOf(id), pointer(400, 200));
    fireEvent.pointerUp(hitPathOf(id), pointer(400, 200));
    await runFrames();
    expect(elementOf(id)).toHaveAttribute('data-selected', 'true');
    expect(document.querySelector('[data-testid="selection-overlay"]')).not.toBeNull();

    // the other person deletes it: a change from somewhere else, not from this screen
    await act(() => {
      doc().transact(() => {
        deleteObjects(doc(), [id]);
      }, new Uint8Array([0x00]));
    });
    await runFrames();
    await runFrames();

    expect(document.querySelector(`[data-stroke-id="${id}"]`)).toBeNull();
    // the selection let it go rather than holding on to an id that is gone
    expect(document.querySelector('[data-testid="selection-overlay"]')).toBeNull();
    expect(window.__vidi6!.getObjects().length).toBe(0);
  });
});
