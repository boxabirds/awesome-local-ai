/**
 * What a drawing is to the pointer, and what happens when it stops existing (story 11, TC-15, TC-16, TC-21).
 *
 * A drawing is the first object on this board whose shape is a line rather than a rectangle, and that single
 * fact is what these three tests are about:
 *
 *   - TC-15 — a pointer cannot be asked to land on a two-pixel line at ten per cent zoom. So the press reaches
 *     as far from the line as a pointer's tolerance, *in screen pixels*: five pixels is a hit at every zoom and
 *     seven is not, which is what the board's own hit test is asked, at 50%, 100% and 200%.
 *   - TC-16 — a bounding box is a rectangle somebody would have to be able to see for it to make sense. A
 *     circle drawn round a sticky note has a box that covers the note; a click in the middle of that circle
 *     must hit the note, because the drawing is not there. The board's hit test says so, and the element that
 *     the browser would have hit is the note, so the note is what gets selected.
 *   - TC-21 — a drawing that is selected and then deleted by somebody else leaves the selection, not a
 *     dangling id and an exception on four other screens.
 *
 * The geometry is asked of the board's own hit test (`hitTestObject`), which is the code that answers this
 * question in the product — the same honest move the story 10 helpers describe. Where the question is instead
 * about what the browser would deliver, the test presses the element the browser would have delivered it to.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import {
  addNote,
  addStroke,
  armPenTool,
  frameAtOrigin,
  hitTestObject,
  penDraw,
  pressPenColor,
  penPressed,
  pressPenThickness,
  rendered,
  scaledPoints,
  screenOf,
  setZoom,
  somebodyElse,
  strokeById,
  strokes,
} from './helpers/tools';
import { dragHandle, outlinedIds, pressEscape, pressNote } from './helpers/selection';
import { pointerDown, pointerEvent, renderBoard, stickyById } from './helpers/stickyBoard';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import { deleteObjects } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { describeSelection, getObjectType } from '../../src/client/objects/registry';
import { handwrittenLoop, extent } from '../fixtures/pen-paths';

/**
 * A drawing, handed to the board's generic hit test.
 *
 * A stroke's `color` is one of six inks and the generic snapshot's is one of six papers, so the two do not
 * type-check together even though every field in them is right; the board itself holds snapshots of every type
 * side by side, which is what the cast says rather than what it hides.
 */
function asObject(stroke: ReturnType<typeof strokeById>): ObjectSnapshot {
  return stroke as unknown as ObjectSnapshot;
}

/** Press the drawing's own line — the strip the browser would hand a click to — and let go. */
function pressStroke(id: string): void {
  const stroke = strokeById(id);
  const line = scaledPoints(stroke);
  const middle = line[Math.floor(line.length / 2) - 1] ?? line[0]!;
  const at = screenOf(middle);
  const strip = document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-hit"]`);
  if (strip === null) throw new Error(`the drawing ${id} drew no press-target`);
  pointerDown(strip, at.x, at.y);
  fireEvent(window, pointerEvent('pointerup', at.x, at.y, { buttons: 0 }));
}

/** The visible line, or the invisible one underneath it: the paths a drawing is drawn from. */
function strokePaths(id: string): { hit: Element; paint: Element } {
  const hit = document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-hit"]`);
  const paint = document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-path"]`);
  if (hit === null || paint === null) throw new Error(`the drawing ${id} was not drawn`);
  return { hit, paint };
}

describe('a drawing under the pointer (TC-15, TC-16)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-15: a pointer five pixels from the line hits it and seven does not, at every zoom', () => {
    // A dead-straight line across the board; the ends are what survive the smoothing, so this is the line.
    const id = addStroke(
      [
        { x: 200, y: 300 },
        { x: 400, y: 300 },
      ],
      { thickness: 'medium' },
    );
    const stroke = strokeById(id);
    // Screen pixels are turned into board units by the zoom, which is the whole of the test: at 50% five pixels
    // is ten board units, at 200% it is two and a half. The nib is four units, so half of it never dominates.
    const onTheLine = 300;
    for (const zoom of [0.5, 1, 2]) {
      expect(hitTestObject(asObject(stroke), { x: 300, y: onTheLine + 5 / zoom }, { scale: zoom })).toBe(true);
      expect(hitTestObject(asObject(stroke), { x: 300, y: onTheLine - 5 / zoom }, { scale: zoom })).toBe(true);
      expect(hitTestObject(asObject(stroke), { x: 300, y: onTheLine + 7 / zoom }, { scale: zoom })).toBe(false);
    }
    // …and the tolerance is a pointer's width, not a nib's: a thick pen does not make a drawing easier to hit.
    const thick = strokeById(
      addStroke(
        [
          { x: 200, y: 500 },
          { x: 400, y: 500 },
        ],
        { thickness: 'thick' },
      ),
    );
    expect(hitTestObject(asObject(thick), { x: 300, y: 507 }, { scale: 1 })).toBe(false);
    // Neither end is an exception: a press beyond the end of the line is beyond it however close it is.
    expect(hitTestObject(asObject(stroke), { x: 410, y: 300 }, { scale: 1 })).toBe(false);
    expect(hitTestObject(asObject(stroke), { x: 406, y: 300 }, { scale: 1 })).toBe(true);
  });

  it('TC-15: the strip that answers the pointer is as wide as the tolerance, in screen pixels, at any zoom', async () => {
    const id = addStroke(
      [
        { x: 200, y: 300 },
        { x: 400, y: 300 },
      ],
      { thickness: 'medium' },
    );
    // The picture and the press are drawn from one number: the invisible strip is twice the distance the hit
    // test allows, in board units, so a drawing is exactly as easy to click as the board says it is.
    for (const zoom of [0.5, 1, 2]) {
      setZoom(zoom);
      await rendered();
      const { hit } = strokePaths(id);
      const width = Number(hit.getAttribute('stroke-width'));
      expect(width / 2).toBeCloseTo(Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom), 6);
      // …and it is unpainted: a tolerance is not something you should be able to see.
      expect(hit.getAttribute('stroke')).toBe('transparent');
      expect(hit.getAttribute('fill')).toBe('none');
      expect((hit as HTMLElement).style.pointerEvents).toBe('stroke');
    }
  });

  it("TC-16: a click inside a drawing's box but away from its line goes to the note underneath", () => {
    const note = addNote({ x: 300, y: 300 });
    // A ring wound round the note: the note's centre is inside the drawing's bounding box and far away from the
    // drawing, which is exactly the case a bounding box cannot answer and a line can.
    const id = addStroke(handwrittenLoop({ x: 300, y: 300, radius: 120, count: 200 }));
    const stroke = strokeById(id);

    expect(hitTestObject(asObject(stroke), { x: 300, y: 300 }, { scale: 1 })).toBe(false);
    // The wrapper is a bounding box and does not answer to the pointer at all; only the line does.
    const wrapper = document.querySelector(`[data-stroke-id="${id}"]`);
    expect((wrapper as HTMLElement).style.pointerEvents).toBe('none');
    expect(strokePaths(id).paint.getAttribute('stroke')).toBe(PEN_COLORS.black);

    // So the browser's own hit test puts this click on the note, and the note is what the click selects.
    pressNote(note);
    expect(outlinedIds()).toEqual([note]);
    // The drawing that lies over it is untouched and unselected: it was never aimed at.
    expect(strokeById(id)).toEqual(stroke);
  });

  it('TC-16: the line itself is what a click selects, and a click on the note beside it is the note', () => {
    const note = addNote({ x: 300, y: 300 });
    const id = addStroke(
      [
        { x: 120, y: 120 },
        { x: 520, y: 120 },
      ],
      { color: 'blue' },
    );
    // The line runs above the note: a press on it is a press on the drawing, though the drawing has no fill.
    pressStroke(id);
    expect(outlinedIds()).toEqual([id]);
    // A press on the note, five pixels clear of the line, is the note's — the drawing's box reaches over the note
    // and does not claim it.
    pressNote(note);
    expect(outlinedIds()).toEqual([note]);
  });

  it('TC-16: a drawing is described to somebody who cannot see it, and the words do not lie', () => {
    const id = addStroke(
      [
        { x: 100, y: 100 },
        { x: 260, y: 180 },
      ],
      { color: 'purple', thickness: 'thin' },
    );
    const wrapper = document.querySelector(`[data-stroke-id="${id}"]`);
    expect(wrapper?.getAttribute('role')).toBe('img');
    expect(wrapper?.getAttribute('aria-label')).toBe('Drawing');
    // The svg is decoration over the same fact, so it is not announced twice.
    expect(document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-svg"]`)?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    // The ink and the nib are attributes of the record, not of the picture: they are read back off the paths.
    const { paint } = strokePaths(id);
    expect(paint.getAttribute('stroke')).toBe(PEN_COLORS.purple);
    expect(paint.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thin));
  });
});

describe('a drawing in the selection (TC-20, TC-21)', () => {
  beforeEach(() => {
    renderBoard();
    frameAtOrigin();
  });

  it('TC-20: a drawing is registered as resizable, proportional, and not something you type into', () => {
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.editableText).toBe(false);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    // Which is what the selection says of it, because the selection asks the registry and not the object.
    const id = addStroke(
      [
        { x: 100, y: 100 },
        { x: 300, y: 220 },
      ],
      { thickness: 'thin' },
    );
    expect(describeSelection([asObject(strokeById(id))])).toMatchObject({ aspectLocked: true, resizable: true });
    // A drawing selected with a note keeps the proportions: one scale is applied to the whole box, and a
    // drawing inside it would come out stretched. The rule the registry states is the rule the handles follow.
    const note = addNote({ x: 600, y: 600 });
    const noteObject = { ...stickyById(note) } as unknown as ObjectSnapshot;
    expect(describeSelection([asObject(strokeById(id)), noteObject]).aspectLocked).toBe(true);
  });

  it('TC-20: pulling a corner scales the drawing and leaves the ink and the nib alone', () => {
    const id = addStroke(
      [
        { x: 100, y: 300 },
        { x: 300, y: 380 },
      ],
      { color: 'green', thickness: 'medium' },
    );
    pressStroke(id);
    expect(outlinedIds()).toEqual([id]);

    const before = strokeById(id);
    const ratio = before.width / before.height;
    // The corner goes sideways only, and the height follows: the axis the pointer travelled further along is
    // the one that decides, and the other keeps the picture a picture of the same thing.
    dragHandle('se', 100, 0);

    const after = strokeById(id);
    expect(after.width).toBeCloseTo(before.width + 100, 1);
    expect(after.width / after.height).toBeCloseTo(ratio, 1);
    expect(after.width).toBeGreaterThan(before.width);
    // Every point moved with the box, by the box's own scale — which is why a resize of a signature is four
    // numbers written and five thousand points nobody had to rewrite. The drawing keeps its place inside the
    // box it grew with, and its shape with it.
    const line = scaledPoints(after);
    expect(line[0]!.x).toBeGreaterThanOrEqual(after.x - 0.001);
    expect(extent(line).width / extent(scaledPoints(before)).width).toBeCloseTo(after.width / before.width, 1);
    expect(extent(line).height / extent(scaledPoints(before)).height).toBeCloseTo(after.height / before.height, 1);
    // The nib is the same thickness it was drawn with, in board units: a drawing made larger is a drawing made
    // larger, not a drawing drawn again with a thicker pen.
    expect(after.thickness).toBe('medium');
    expect(strokePaths(id).paint.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    expect(after.color).toBe('green');
  });

  it('TC-20: a drawing cannot be shrunk below its own minimum', () => {
    const id = addStroke(
      [
        { x: 100, y: 300 },
        { x: 140, y: 340 },
      ],
      { thickness: 'thin' },
    );
    pressStroke(id);
    const before = strokeById(id);
    dragHandle('se', -400, -400);
    const after = strokeById(id);
    expect(after.width).toBeGreaterThanOrEqual(Math.max(STROKE_MIN_SIZE_WORLD, 0));
    expect(after.height).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
    expect(after.width).toBeLessThan(before.width);
  });

  it('TC-21: a drawing deleted by somebody else while it is selected leaves the selection', async () => {
    const id = addStroke(
      [
        { x: 200, y: 200 },
        { x: 400, y: 260 },
      ],
      {},
    );
    pressStroke(id);
    await waitFor(() => expect(outlinedIds()).toEqual([id]));

    // Somebody else deletes it. The selection has to notice, because a selection that holds an id that is no
    // longer there is a delete button that does nothing and a resize handle on nothing at all.
    somebodyElse((d) => {
      deleteObjects(d, [id]);
    });

    await waitFor(() => expect(strokes()).toHaveLength(0));
    expect(outlinedIds()).toEqual([]);
    expect(document.querySelector(`[data-stroke-id="${id}"]`)).toBeNull();
    // The board is still there, and still works: no exception on this side of the network either.
    pressEscape();
    expect(screen.getByTestId('board-root')).toBeInTheDocument();
    const sheet = await armPenTool();
    expect(sheet).toBeInTheDocument();
    expect(penPressed().colors).toEqual(['black']);
  });

  it('TC-21: the Delete key takes a drawing back, and the pen is still in the hand afterwards', async () => {
    await armPenTool();
    pressPenColor('red');
    pressPenThickness('thin');
    penDraw([
      { x: 150, y: 200 },
      { x: 350, y: 260 },
    ]);
    await waitFor(() => expect(strokes()).toHaveLength(1));
    const id = strokes()[0]!.id;
    expect(outlinedIds()).toEqual([id]);

    fireEvent.keyDown(window, { key: 'Delete' });
    await waitFor(() => expect(strokes()).toHaveLength(0));
    expect(outlinedIds()).toEqual([]);
    // One line back, and the pen still armed with the ink it was set to: an undo of a drawing is not a reason to
    // be handed a different tool.
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    await waitFor(() => expect(strokes()).toHaveLength(1));
    expect(strokes()[0]!.color).toBe('red');
    // …and the pen is still armed with the same ink in it, because taking the tool away would be a punishment
    // for using the keyboard.
    expect(penPressed()).toEqual({ colors: ['red'], thicknesses: ['thin'] });
    expect(screen.getByTestId('pen-tool')).toBeInTheDocument();
  });
});
