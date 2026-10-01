// stroke.object (ui-component): a drawing is clicked by its line, scaled by its box,
// and deleted like anything else.
//
// A stroke is the first object on the board whose box is not the thing. It is moved,
// resized, deleted and stacked by story 7's rules through a box like any other box,
// but the drawing is a line inside that box - so the two rules that decide whether it
// behaves like a drawing rather than a rectangle are both about measurement: what a
// click is measured against (the line, at a distance that is a fixed number of screen
// pixels), and what a resize does to the line (scales it, and leaves its thickness
// alone).
//
// The negative case is the one that keeps a scribble usable as an annotation: a click
// inside a drawing's box and away from its line belongs to whatever is underneath, so
// a person can write between the lines of the thing they drew over.

import { describe, expect, it } from 'vitest';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
  TYPE_STROKE,
} from '../../src/shared/config';
import { scaledPoints, strokeSnapshot } from '../../src/shared/objects/stroke';
import { getObjectType, hitTestObject } from '../../src/client/objects/registry';
import { distanceToPolyline } from '../../src/shared/geometry/polyline';
import { snapshot } from '../../src/shared/board-model';
import {
  clickOn,
  clickOnStrokeLine,
  doubleClickOn,
  dragHandle,
  drawOnPen,
  expectedInk,
  flushFrames,
  handlesShown,
  holdPenTool,
  linePoints,
  newNote,
  newStroke,
  noteAt,
  notePosition,
  penToolLayer,
  pointerOn,
  remoteDelete,
  renderBoard,
  screenOf,
  selectedStrokes,
  snapshotStrokes,
  strokeAt,
  strokeBox,
  strokeCount,
  strokeHalo,
  strokeHit,
  strokeInk,
  strokePathOf,
  useBoardTestLifecycle,
} from './helpers';

type Point = { x: number; y: number };

/** A line drawn over a box and down across it: an arc that leans on what is under it. */
function arcOver(x: number, y: number, width: number, depth: number): Point[] {
  return [
    { x, y },
    { x: x + width / 2, y: y + depth },
    { x: x + width, y },
  ];
}

/** The point `screenPx` screen pixels below the line, on the board, at this zoom. */
function offLine(on: Point, screenPx: number, zoom: number): Point {
  return { x: on.x, y: on.y + screenPx / zoom };
}

/** How many handles the selection has put on screen. */
const handleCount = (): number => handlesShown().length;

describe('a drawing on the board', () => {
  useBoardTestLifecycle();

  it('is registered as a drawing: resizable, proportionally, with no words in it', () => {
    const spec = getObjectType(TYPE_STROKE);
    expect(spec).toBeDefined();
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(spec!.editableText).toBe(false);
    expect(spec!.handles).toBe('all');
    expect(spec!.hitTest).toBeTypeOf('function');
  });

  it('TC-15 is hit by its line within six screen pixels and missed beyond them', () => {
    const { doc } = renderBoard();
    // A level line, four board units thick, so the only thing a click is measured
    // against is how far it stands from the line.
    const id = newStroke(doc, linePoints({ x: 0, y: 100 }, { x: 400, y: 100 }, 5));
    const stroke = strokeSnapshot(doc, id)!;
    const on = { x: 200, y: 100 };
    expect(stroke.thickness).toBe('medium');

    // Half the line's own thickness is two board units, so at 200% the click tolerance
    // is the six screen pixels and at 50% those same six pixels are twelve board units.
    // A drawing stays as easy to hit with a mouse at any zoom - and no easier.
    for (const zoom of [2, 0.5]) {
      const tolerance = Math.max(PEN_THICKNESS_WORLD.medium / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      expect(tolerance).toBeGreaterThan(5 / zoom);
      expect(tolerance).toBeLessThan(7 / zoom);
      expect(hitTestObject(stroke, offLine(on, 5, zoom), zoom)).toBe(true);
      expect(hitTestObject(stroke, offLine(on, 7, zoom), zoom)).toBe(false);
    }

    // The same answer, from the model's own measurement of the same line.
    expect(distanceToPolyline(scaledPoints(stroke), offLine(on, 5, 2))).toBeLessThanOrEqual(
      STROKE_HIT_TOLERANCE_PX / 2,
    );

    // Along the line's own thickness the click is measured the same way: a thick line is
    // clickable across all of it, so its half-thickness is the floor under the tolerance.
    const thick = newStroke(doc, linePoints({ x: 0, y: 300 }, { x: 200, y: 300 }, 3), {
      thickness: 'thick',
    });
    const thickStroke = strokeSnapshot(doc, thick)!;
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(hitTestObject(thickStroke, { x: 100, y: 300 + half }, 1)).toBe(true);
    expect(hitTestObject(thickStroke, { x: 100, y: 300 + half + 3 }, 1)).toBe(false);
  });

  it('TC-16 gives a click inside its box, off its line, to the note underneath', () => {
    const { doc } = renderBoard();
    const noteId = newNote(doc, { x: 0, y: 0 });
    // A line drawn over a note and down across it, so the note's middle sits deep inside
    // the drawing's box and a long way from its ink.
    const strokeId = newStroke(doc, arcOver(-40, -30, 340, 230));
    flushFrames();
    expect(strokeCount()).toBe(1);

    const stroke = strokeSnapshot(doc, strokeId)!;
    const note = snapshot(doc).find((object) => object.id === noteId)!;
    const middle = { x: 60, y: 40 };
    const box = strokeBox(0);
    expect(middle.x).toBeGreaterThan(box.x);
    expect(middle.y).toBeGreaterThan(box.y);
    expect(middle.x).toBeLessThan(box.x + box.width);
    expect(middle.y).toBeLessThan(box.y + box.height);

    // The drawing does not answer for that point; the note does.
    expect(hitTestObject(stroke, middle, 1)).toBe(false);
    expect(hitTestObject(note, middle, 1)).toBe(true);
    expect(distanceToPolyline(scaledPoints(stroke), middle)).toBeGreaterThan(
      STROKE_HIT_TOLERANCE_PX,
    );

    // Which is what the note's own element then receives: the click that lands between
    // the lines selects the note, not the scribble drawn over it.
    clickOn(noteAt(0), screenOf(middle).x, screenOf(middle).y);
    flushFrames();
    expect(noteAt(0).dataset.selected).toBe('true');
    expect(selectedStrokes()).toHaveLength(0);
    expect(strokeAt(0).dataset.selected).toBe('false');

    // and the note was selected, never moved by the click that came through the drawing
    expect(snapshot(doc).find((object) => object.id === noteId)).toBeDefined();
    expect(noteAt(0).style.left).toBe(`${note.x}px`);
  });

  it('is selected by a click on its line, and wears the selection in its own colour', () => {
    const { doc } = renderBoard();
    const id = newStroke(doc, linePoints({ x: 0, y: 0 }, { x: 300, y: 120 }, 6), {
      color: 'purple',
    });
    flushFrames();

    const points = scaledPoints(strokeSnapshot(doc, id)!);
    clickOnStrokeLine(0, points[3]!);
    flushFrames();

    expect(strokeAt(0).dataset.selected).toBe('true');
    expect(handleCount()).toBeGreaterThan(0);
    // The ink keeps the colour it was drawn in: a selection is not a repaint of it.
    expect(strokeInk(0).getAttribute('stroke')).toBe(PEN_COLORS.purple);
    // and the line the handles belong to is drawn behind it, which is what says which
    // object on the board those handles are for
    expect(strokeHalo(0)).not.toBeNull();

    // The fat invisible line a click is measured against is as wide as the tolerance on
    // both sides, and the ink itself takes no pointer at all.
    const hit = strokeHit(0);
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(
      Math.max(PEN_THICKNESS_WORLD.medium, STROKE_HIT_TOLERANCE_PX * 2),
      6,
    );
    expect(strokeAt(0).getAttribute('aria-label')).toBe('Drawing');
    expect(strokeInk(0).getAttribute('aria-label')).toBe('Drawing');
  });

  it('draws the line the document holds, and scales it without thickening it', () => {
    const { doc } = renderBoard();
    const id = newStroke(doc, linePoints({ x: 0, y: 0 }, { x: 320, y: 220 }, 4));
    flushFrames();

    // The path the board paints is the stored line, scaled by its box and smoothed.
    const before = strokePathOf(0);
    expect(before).toBe(expectedInk(doc, id));
    const beforeBox = strokeBox(0);
    const ratio = beforeBox.width / beforeBox.height;
    const thickness = strokeInk(0).getAttribute('stroke-width');
    const base = strokeSnapshot(doc, id)!;

    // A corner dragged out: story 7's handle and story 7's gesture, and a drawing that
    // grows the way a drawing grows - proportionally, at the thickness it was drawn with.
    clickOnStrokeLine(0, scaledPoints(base)[2]!);
    dragHandle('se', 160, 40);
    flushFrames();

    const after = strokeSnapshot(doc, id)!;
    expect(after.width).toBeGreaterThan(base.width);
    // The line the drawing was made at is what a resize scales against, so it is kept.
    expect(after.baseWidth).toBeCloseTo(base.baseWidth, 6);
    expect(after.baseHeight).toBeCloseTo(base.baseHeight, 6);
    const afterBox = strokeBox(0);
    // Within one percent: proportion, not shear.
    expect(afterBox.width / afterBox.height).toBeCloseTo(ratio, 2);
    expect(strokeInk(0).getAttribute('stroke-width')).toBe(thickness);
    expect(strokePathOf(0)).toBe(expectedInk(doc, id));
    expect(strokePathOf(0)).not.toBe(before);

    // The line reached where its box was dragged to: bigger, in the same shape.
    const grown = scaledPoints(after);
    const scale = after.width / base.baseWidth;
    expect(grown[grown.length - 1]!.x).toBeCloseTo(
      after.x + (base.baseWidth - PEN_THICKNESS_WORLD.medium / 2) * scale,
      3,
    );
  });

  it('TC-21 goes out of the selection when somebody else erases it', () => {
    const { doc } = renderBoard();
    const id = newStroke(doc, linePoints({ x: 0, y: 0 }, { x: 240, y: 100 }, 5));
    flushFrames();
    clickOnStrokeLine(0, scaledPoints(strokeSnapshot(doc, id)!)[2]!);
    flushFrames();
    expect(selectedStrokes()).toHaveLength(1);
    expect(handleCount()).toBeGreaterThan(0);

    // Erased elsewhere on the board while it is the selection.
    remoteDelete(doc, id);
    flushFrames();

    expect(strokeCount()).toBe(0);
    expect(selectedStrokes()).toHaveLength(0);
    expect(handleCount()).toBe(0);
    expect(document.querySelectorAll('[data-selected="true"]')).toHaveLength(0);

    // The board still works: the pen still draws, and what it draws is selectable.
    holdPenTool();
    expect(penToolLayer()).not.toBeNull();
    drawOnPen({ x: 100, y: 100 }, { x: 260, y: 180 }, 4);
    expect(strokeCount()).toBe(1);
    expect(selectedStrokes()).toHaveLength(1);
  });

  it('holds no words: double-clicking the line opens no editor and drops no note', () => {
    const { doc } = renderBoard();
    newStroke(doc, linePoints({ x: 0, y: 0 }, { x: 200, y: 60 }, 4));
    flushFrames();
    const on = scaledPoints(snapshotStrokes(doc)[0]!)[2]!;
    const at = screenOf(on);

    clickOnStrokeLine(0, on);
    flushFrames();
    expect(strokeAt(0).dataset.selected).toBe('true');

    doubleClickOn(strokeHit(0), at.x, at.y);
    flushFrames();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="sticky-note"]')).toHaveLength(0);
    expect(strokeCount()).toBe(1);
    expect(strokeAt(0).dataset.editable).toBe('true');
  });

  it('is dragged by its line, and moves the note under it not at all', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const id = newStroke(doc, arcOver(-40, -30, 340, 230));
    flushFrames();
    const noteBefore = notePosition(0);
    const before = strokeBox(0);

    // A press held on the drawing's own line is the drawing's: the whole thing moves,
    // and the note it was drawn across stays where it was.
    const on = scaledPoints(strokeSnapshot(doc, id)!)[1]!;
    const at = screenOf(on);
    const hit = strokeHit(0);
    pointerOn(hit, 'pointerdown', { clientX: at.x, clientY: at.y });
    for (let i = 1; i <= 4; i += 1) {
      pointerOn(hit, 'pointermove', { clientX: at.x + 30 * i, clientY: at.y + 20 * i });
      flushFrames();
    }
    pointerOn(hit, 'pointerup', { clientX: at.x + 120, clientY: at.y + 80 });
    flushFrames();

    const after = strokeBox(0);
    expect(after.x).toBeGreaterThan(before.x + 100);
    expect(after.y).toBeGreaterThan(before.y + 60);
    expect(after.width).toBeCloseTo(before.width, 3);
    expect(notePosition(0)).toEqual(noteBefore);
    expect(strokeAt(0).dataset.selected).toBe('true');
    // and the line moved is still the line that was drawn
    expect(strokePathOf(0)).toBe(expectedInk(doc, id));
  });
});
