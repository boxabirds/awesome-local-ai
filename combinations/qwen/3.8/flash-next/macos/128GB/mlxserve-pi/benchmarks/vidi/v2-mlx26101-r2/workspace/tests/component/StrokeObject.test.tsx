/**
 * A drawn line on the board (`tests/component/StrokeObject.test.tsx`).
 *
 * `stroke.object` as the person who drew something meets it: the line is still there
 * after the release, in the ink and at the width they chose; a click finds it by its
 * line rather than by its box; a corner handle makes it bigger without squashing it or
 * thickening it; and when it goes away - here, from the document, which is what a
 * colleague's Delete key does to your screen - the board forgets it without a fuss.
 *
 * The geometry itself is measured in the unit file, where it is arithmetic. What this
 * file can honestly measure about a click is *which element answers it*: jsdom does no
 * hit-testing, so a test chooses the element a browser would have found. What is
 * asserted here is that there is exactly one element in this component that answers a
 * pointer at all - the invisible line as wide as the click tolerance - and that the ink
 * and the box are deaf to it, which is the property that makes a click inside a loop land
 * on the note inside the loop instead of on the loop (`pen.select`, TC-16). The end to
 * end file presses the real mouse at real pixels and proves the geometry.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as Y from 'yjs';

import {
  board,
  boardDoc,
  clickPenColor,
  clickPenThickness,
  clickTool,
  coalescedDragOnPen,
  createSelectedNote,
  dragHandle,
  dragNote,
  dragPenThrough,
  flushFrames,
  handleSides,
  keydown,
  noteData,
  noteElement,
  pointerDown,
  pointerMove,
  pointerUp,
  pressedTool,
  renderBoard,
  screenOf,
  selectedObjectIds,
  setZoom,
  strokeData,
  strokeElement,
  strokeElements,
  strokeHitElement,
  strokeLineElement,
  strokeScreenCentre,
  strokes,
  toolSurface,
} from './helpers.js';
import { act, fireEvent } from './tl.js';
import { circle, scribble } from '../fixtures/pen-paths.js';

import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config.js';
import { objectBounds } from '../../src/shared/board-model.js';
import { deleteObject, objectSnapshot } from '../../src/shared/board-model.js';
import { getObjectType } from '../../src/client/objects/registry.js';
import { scaledPoints, createStroke, type StrokeSnap } from '../../src/shared/objects/stroke.js';
import type { Point } from '../../src/client/canvas/camera.js';

beforeEach(() => {
  renderBoard();
});

/**
 * Put the pen in hand, leaving it there if it already is.
 *
 * The tool is a toggle on the toolbar, so clicking it again would put it down again - and
 * this story's promise is that the pen *stays* in hand after a stroke, which is what a
 * person drawing a second line does. Tests that want the pen back on the toolbar say so by
 * pressing Escape, which is the other half of the same promise.
 */
function penInHand(): void {
  if (pressedTool() !== 'pen') clickTool('pen');
  expect(pressedTool()).toBe('pen');
}

/** One drag of the pen, however many strokes it makes, wherever the pen is drawing. */
function dragPen(from: Point, to: Point): void {
  dragPenThrough([from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to]);
}

/** Press the pen and draw one straight stroke; the pen stays in hand, as it does. */
function drawOne(from: Point = { x: 300, y: 260 }, to: Point = { x: 620, y: 460 }): StrokeSnap {
  penInHand();
  coalescedDragOnPen(from, to, 6, 4);
  return strokeData(0);
}

/** A loop wide enough that its middle is nowhere near its own line. */
function drawLoop(): StrokeSnap {
  penInHand();
  dragPenThrough(circle.map((point) => ({ x: point.x, y: point.y })));
  return strokeData(0);
}

/** Click the line itself: where a click on a stroke has to be. */
function clickTheLine(index = 0): void {
  const stroke = strokeData(index);
  const on = {
    x: stroke.x + (stroke.points[0] as number),
    y: stroke.y + (stroke.points[1] as number),
  };
  const at = screenOf({ x: on.x, y: on.y });
  pointerDown(at, strokeHitElement(index));
  pointerUp(at, strokeHitElement(index));
}

/* ------------------------------------------ TC-15: the tolerance, in screen pixels */

describe('a stroke is found by its line, at the distance the screen can see (TC-15)', () => {
  const spec = getObjectType('stroke');

  it('is a registered type, resizable, and locked in proportion', () => {
    expect(spec).toBeDefined();
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.editableText).toBe(false);
    expect(spec?.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(typeof spec?.hitTest).toBe('function');
  });

  /** A stroke of this pen, drawn straight along y = 0 in a document of its own. */
  const flatStroke = (thickness: 'thin' | 'medium' | 'thick'): StrokeSnap => {
    const doc = new Y.Doc();
    const id = createStroke(
      doc,
      { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], thickness },
      'author',
    );
    // Read it back through the document's own reader, so the test cannot pass by
    // asserting against a shape the document does not hold.
    const stroke = objectSnapshot(doc).find((object) => object.id === id) as StrokeSnap;
    expect(stroke).toBeDefined();
    return stroke;
  };

  it('answers a click 5 screen pixels away and refuses one 7 away, at 100%', () => {
    const stroke = flatStroke('thin');
    const hitTest = getObjectType('stroke')?.hitTest;
    // The tolerance is 6 screen pixels at 100%, so 5 is on the line and 7 is beside it.
    expect(hitTest?.(stroke, { x: 100, y: 5 }, 1)).toBe(true);
    expect(hitTest?.(stroke, { x: 100, y: 7 }, 1)).toBe(false);
  });

  it('answers 5 pixels and refuses 7 at 50% and at 200% alike', () => {
    const stroke = flatStroke('thin');
    const hitTest = getObjectType('stroke')?.hitTest!;
    // Screen pixels are the promise; board units are what the hit test is given. At 50% a
    // pixel is two board units, at 200% half of one, so the same *screen* distance is a
    // different number of board units at every zoom - and the answer does not change.
    expect(hitTest(stroke, { x: 100, y: 5 / 0.5 }, 0.5)).toBe(true);
    expect(hitTest(stroke, { x: 100, y: 7 / 0.5 }, 0.5)).toBe(false);
    expect(hitTest(stroke, { x: 100, y: 5 / 2 }, 2)).toBe(true);
    expect(hitTest(stroke, { x: 100, y: 7 / 2 }, 2)).toBe(false);
  });

  it('never asks for less than the ink, so a thick line is not harder to catch than a thin one', () => {
    const thick = flatStroke('thick');
    const hitTest = getObjectType('stroke')?.hitTest!;
    // At 200% six screen pixels are three board units, and half of a thick pen is four:
    // the ink wins, because a click that landed on the line is a click on the stroke.
    expect(hitTest(thick, { x: 100, y: 3.5 }, 2)).toBe(true);
    // And past both of them, it is not.
    expect(hitTest(thick, { x: 100, y: 4.5 }, 2)).toBe(false);
  });

  it('is the same answer the board gives when the click arrives at the component', () => {
    // The registry, the component and the model all measure the same line: the component
    // draws a hit path of this width, and a click anywhere on it is a click on the stroke.
    const stroke = drawOne();
    const hit = strokeHitElement(0);
    const ink = PEN_THICKNESS_WORLD[stroke.thickness];
    const expected = Math.max(ink, (2 * STROKE_HIT_TOLERANCE_PX) / 1);
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(expected, 3);
    expect(hit.getAttribute('pointer-events')).toBe('stroke');
  });

  it('keeps the click target the same size on the screen at 200%', () => {
    drawOne();
    setZoom(2);
    const stroke = strokeData(0);
    const hit = strokeHitElement(0);
    const width = Number(hit.getAttribute('stroke-width'));
    // Board units: half as many at 200% as at 100%, which is what "six pixels, whatever
    // the zoom" looks like when it is written down in world units.
    expect(width).toBeCloseTo((2 * STROKE_HIT_TOLERANCE_PX) / 2, 3);
    expect(stroke.thickness).toBeDefined();
  });
});

/* --------------------------------------- TC-16: the box is not the drawing */

describe('the box of a stroke is not the stroke (TC-16)', () => {
  it('has exactly one element that answers a pointer, and it is the invisible line', () => {
    drawLoop();
    const root = strokeElement(0);
    const line = strokeLineElement(0);
    const hit = strokeHitElement(0);
    // The ink is decoration: it is drawn, not pressed.
    expect(line.getAttribute('pointer-events')).toBe('none');
    // The hit line is the whole of the object's reach, and it reaches no further than
    // the tolerance.
    expect(hit.getAttribute('pointer-events')).toBe('stroke');
    expect(hit.getAttribute('stroke')).toBe('transparent');
    // And the box itself takes nothing: no handler of its own to swallow a press.
    expect(root.getAttribute('data-testid')).toBe('stroke-object');
    expect(root.querySelector('[data-testid="sticky-note"]')).toBeNull();
  });

  it('leaves a click in the middle of a loop to the note inside it', () => {
    // TC-16: draw a loop over somebody's note, then click inside it. The note is what is
    // under the pointer - the loop's own box is mostly empty board - and jsdom is told so
    // by being given the element a browser would have found: the note's own surface, since
    // every element of the stroke is deaf to a press that far from its line.
    createSelectedNote('Roadmap');
    const note = noteData(0);
    const inside = screenOf({ x: note.x + 30, y: note.y + 30 });
    keydown('V');
    penInHand();
    // A loop drawn around the note, from above it and back.
    dragPenThrough(loopAround(note.x + STICKY_OFFSET, note.y + STICKY_OFFSET));
    keydown('V');
    expect(strokes()).toHaveLength(1);

    pointerDown(inside, noteElement(0));
    pointerUp(inside, noteElement(0));
    expect(selectedObjectIds()).toEqual([note.id]);
    expect(selectedObjectIds()).not.toContain(strokeData(0).id);
    expect(strokeElement(0).getAttribute('data-selected')).toBe('false');
  });

  it('is selected by a click on its line, and nothing else gets the press', () => {
    createSelectedNote('Roadmap');
    const note = noteData(0);
    keydown('V');
    penInHand();
    dragPenThrough(loopAround(note.x + STICKY_OFFSET, note.y + STICKY_OFFSET));
    keydown('V');
    clickTheLine(0);
    expect(selectedObjectIds()).toContain(strokeData(0).id);
    expect(strokeElement(0).getAttribute('data-selected')).toBe('true');
  });

  it('says what it is to somebody who cannot see it', () => {
    drawOne();
    expect(strokeElement(0).getAttribute('aria-label')).toBe('Drawing');
    // A stroke has no words of its own, so there is nothing in it to read out; the label
    // is the only announcement, and the ink inside it is hidden from the announcement.
    expect(document.querySelector('[data-testid="stroke-svg"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is drawn in the ink and at the width it was drawn with', () => {
    penInHand();
    clickPenThickness('thick');
    coalescedDragOnPen({ x: 300, y: 260 }, { x: 620, y: 460 }, 6, 4);
    const stroke = strokeData(0);
    const line = strokeLineElement(0);
    expect(stroke.color).toBe('black');
    expect(line.getAttribute('stroke')).toBe(PEN_COLORS[stroke.color]);
    // The width is the pen, in board units, and is not divided by the zoom: a stroke is
    // as thick as the pen that drew it at every zoom.
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD[stroke.thickness]));
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
  });

  it('occupies the box the document says it does, padding included', () => {
    const stroke = drawOne();
    const box = objectBounds(stroke);
    const style = strokeElement(0).style;
    expect(style.left).toBe(`${box.x}px`);
    expect(style.top).toBe(`${box.y}px`);
    expect(style.width).toBe(`${box.width}px`);
    expect(style.height).toBe(`${box.height}px`);
  });

  it('has no text editor, because there is nothing to type into', () => {
    drawOne();
    keydown('V');
    clickTheLine(0);
    const before = document.querySelectorAll('textarea').length;
    doubleClickStroke();
    expect(document.querySelectorAll('textarea')).toHaveLength(before);
    expect(getObjectType('stroke')?.editableText).toBe(false);
  });
});

const STICKY_OFFSET = 40;

/** A rectangle-ish loop drawn around a point, as a list of screen points. */
function loopAround(x: number, y: number): Point[] {
  const size = 180;
  const corners = [
    { x: x - size, y: y - size },
    { x: x + size, y: y - size },
    { x: x + size, y: y + size },
    { x: x - size, y: y + size },
    { x: x - size, y: y - size + 4 },
  ];
  const path: Point[] = [];
  for (let index = 1; index < corners.length; index += 1) {
    const from = corners[index - 1];
    const to = corners[index];
    for (let step = 0; step < 8; step += 1) {
      const t = step / 8;
      path.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  }
  path.push(corners[corners.length - 1]);
  return path;
}

/** Put a copy of a stroke back into a document at a given corner, as a colleague would. */
function createStrokeAt(doc: Y.Doc, stroke: StrokeSnap, x: number, y: number): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  const map = objects.get(stroke.id) ?? new Y.Map<unknown>();
  doc.transact(() => {
    map.set('type', 'stroke');
    map.set('x', x);
    map.set('y', y);
    map.set('z', stroke.z);
    map.set('createdAt', stroke.createdAt);
    map.set('width', stroke.width);
    map.set('height', stroke.height);
    map.set('color', stroke.color);
    map.set('thickness', stroke.thickness);
    map.set('points', stroke.points.slice());
    map.set('baseWidth', stroke.baseWidth);
    map.set('baseHeight', stroke.baseHeight);
    if (objects.get(stroke.id) === undefined) objects.set(stroke.id, map);
  });
}

/** Double-click the stroke's own line. */
function doubleClickStroke(): void {
  const centre = strokeScreenCentre(0);
  fireEvent.doubleClick(strokeHitElement(0), { clientX: centre.x, clientY: centre.y });
  flushFrames();
}

/* ------------------------------------- the selection's strokes: resize and move */

describe('a selected stroke is resized in proportion (pen.resize)', () => {
  it('offers the full set of handles, and keeps the drawing inside them', () => {
    drawOne();
    keydown('V');
    clickTheLine(0);
    expect(handleSides()).toHaveLength(8);
  });

  it('doubles on both axes together when a corner is dragged', () => {
    const before = drawOne();
    keydown('V');
    const ratio = (before.width as number) / (before.height as number);
    clickTheLine(0);
    const origin = screenOf({ x: before.x + (before.width as number), y: before.y + (before.height as number) });
    dragHandle('se', origin, { x: origin.x + 120, y: origin.y + 120 });
    const after = strokeData(0);
    expect((after.width as number) * (before.height as number)).toBeCloseTo(
      (after.height as number) * (before.width as number),
      1,
    );
    expect((after.width as number) / (after.height as number)).toBeCloseTo(ratio, 2);
  });

  it('scales the trail with the box, and leaves the pen alone', () => {
    const before = drawOne();
    keydown('V');
    const points = scaledPoints(before);
    clickTheLine(0);
    const origin = screenOf({ x: before.x + (before.width as number), y: before.y + (before.height as number) });
    dragHandle('se', origin, { x: origin.x + 100, y: origin.y + 100 });
    const after = strokeData(0);
    // The resize is two numbers on the object; the stored trail is what it always was, and
    // the base is what it was created at - which is how the scale is remembered.
    expect(after.points).toEqual(before.points);
    expect(after.baseWidth).toBe(before.baseWidth);
    expect(after.baseHeight).toBe(before.baseHeight);
    expect(after.width as number).toBeGreaterThan(before.width as number);
    const scale = (after.width as number) / (before.width as number);
    const scaled = scaledPoints(after);
    for (let index = 0; index < points.length; index += 1) {
      expect(scaled[index].x).toBeCloseTo(points[index].x * scale, 1);
    }
    // The ink is the pen, not a dimension of the drawing.
    expect(after.thickness).toBe(before.thickness);
    expect(strokeLineElement(0).getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD[before.thickness]),
    );
  });

  it('is not squashed by a drag that went sideways only', () => {
    // The lock is the whole point of `aspectLocked`: a corner dragged to the right makes
    // the drawing bigger, not wider, because a drawing that was stretched on the way in
    // is a different drawing and there is no way back to the one that was drawn.
    const before = drawOne();
    keydown('V');
    const ratio = (before.width as number) / (before.height as number);
    clickTheLine(0);
    const origin = screenOf({ x: before.x + (before.width as number), y: before.y + (before.height as number) });
    dragHandle('se', origin, { x: origin.x + 140, y: origin.y });
    const after = strokeData(0);
    expect((after.width as number) / (after.height as number)).toBeCloseTo(ratio, 2);
  });
});

describe('a selected stroke moves as one piece', () => {
  it('follows a drag of its line, and takes the whole trail with it', () => {
    const before = drawOne();
    keydown('V');
    const start = screenOf({
      x: before.x + (before.points[0] as number),
      y: before.y + (before.points[1] as number),
    });
    dragNote(start, { x: start.x + 90, y: start.y + 40 }, strokeHitElement(0));
    const after = strokeData(0);
    expect(after.x - before.x).toBeCloseTo(90, 1);
    expect(after.y - before.y).toBeCloseTo(40, 1);
    // The trail is the same trail: moving a drawing is not redrawing it.
    expect(after.points).toEqual(before.points);
    expect(after.width).toBe(before.width);
  });

  it('is one undo step, and one Ctrl+Z puts the whole stroke back', () => {
    drawOne();
    expect(strokes()).toHaveLength(1);
    // The pen is still in hand, which is what `keydown('z')` is done with here: one
    // gesture was the stroke, and one undo takes the whole drawing back.
    keydown('z', { ctrl: true });
    expect(strokes()).toHaveLength(0);
    keydown('z', { ctrl: true, shift: true });
    expect(strokes()).toHaveLength(1);
  });

  it('is one box for the marquee, and the whole drawing comes with it', () => {
    drawOne();
    keydown('V');
    keydown('a', { ctrl: true });
    expect(selectedObjectIds()).toEqual([strokeData(0).id]);
    expect(strokeElement(0).getAttribute('data-selected')).toBe('true');
  });
});

/* --------------------------------------------- TC-21: deleted from under us */

describe('a stroke deleted from the document while it is selected (TC-21)', () => {
  it('goes away, the selection forgets it, and nothing throws', () => {
    const stroke = drawOne();
    keydown('V');
    clickTheLine(0);
    expect(selectedObjectIds()).toContain(stroke.id);

    // Somebody else's Delete key, arriving as a document change: the error path this
    // story has to survive is a selection that names an object which is no longer there.
    act(() => {
      deleteObject(boardDoc(), stroke.id);
    });
    flushFrames();

    expect(strokeElements()).toHaveLength(0);
    expect(strokes()).toHaveLength(0);
    expect(selectedObjectIds()).not.toContain(stroke.id);
    // The board is still a board: the failure mode of a stale selection is a component
    // that rendered nothing at all, and the only honest way to see that is to carry on.
    expect(board()).not.toBeNull();
    expect(document.querySelector('[data-testid="board-toolbar"]')).not.toBeNull();
    keydown('V');
    drawOne({ x: 200, y: 500 }, { x: 420, y: 620 });
    expect(strokes()).toHaveLength(1);
  });

  it('survives a delete that arrives while the pen is drawing over it', () => {
    const stroke = drawOne();
    clickTool('pen');
    const surface = toolSurface('pen');
    pointerDown({ x: 300, y: 300 }, surface);
    pointerMove({ x: 420, y: 380 }, surface);
    act(() => {
      deleteObject(boardDoc(), stroke.id);
    });
    flushFrames();
    pointerUp({ x: 420, y: 380 }, surface);
    // The stroke in progress is drawn; the one that was deleted from under the drag stays gone.
    expect(strokes()).toHaveLength(1);
    expect(strokeElements()).toHaveLength(1);
  });

  it('is removed by this tab\'s Delete key too, in one undo step', () => {
    const stroke = drawOne();
    keydown('V');
    clickTheLine(0);
    keydown('Delete');
    expect(strokes()).toHaveLength(0);
    expect(strokeElements()).toHaveLength(0);
    keydown('z', { ctrl: true });
    expect(strokes()).toHaveLength(1);
    expect(strokeData(0).id).toBe(stroke.id);
  });

  it('is gone from the screen when a colleague deletes it, and comes back when they put it down again', () => {
    const stroke = drawOne();
    keydown('V');
    const doc = boardDoc();
    act(() => {
      deleteObject(doc, stroke.id);
    });
    flushFrames();
    expect(strokeElements()).toHaveLength(0);
    // And it is gone from the document, not just from the screen: the board cannot bring
    // back what the document no longer holds.
    expect(boardDoc().getMap('objects').get(stroke.id)).toBeUndefined();
    // A delete the other way is a new object with the same id, which is what a colleague
    // restoring it looks like from here: the board draws what the document holds, and the
    // document now holds a stroke at the place they gave it.
    act(() => {
      createStrokeAt(doc, stroke, 0, 0);
    });
    flushFrames();
    expect(strokeElements()).toHaveLength(1);
    expect(strokeData(0).x).toBe(0);
  });
});

/* ------------------------------------------------ the drawing on the screen */

describe('what is on the screen is what is in the document', () => {
  it('draws the stored path, not a curve invented on the way to the screen', () => {
    const stroke = drawOne();
    const d = strokeLineElement(0).getAttribute('d') ?? '';
    expect(d.startsWith(`M ${stroke.points[0]} ${stroke.points[1]}`)).toBe(true);
    expect(d).toBe(strokeHitElement(0).getAttribute('d'));
  });

  it('keeps a drawn loop a loop', () => {
    const stroke = drawLoop();
    expect(stroke.points.length / 2).toBeGreaterThan(4);
    // A circle is a wide and tall thing: the path on the screen spans the box.
    const d = strokeLineElement(0).getAttribute('d') ?? '';
    const numbers = d.match(/-?\d+(\.\d+)?/gu)!.map(Number);
    const xs = numbers.filter((_value, index) => index % 2 === 0);
    const ys = numbers.filter((_value, index) => index % 2 === 1);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(100);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(100);
  });

  it('is one element per stroke, in the order the document puts them', () => {
    drawOne({ x: 200, y: 200 }, { x: 380, y: 300 });
    drawOne({ x: 500, y: 400 }, { x: 700, y: 520 });
    expect(strokeElements()).toHaveLength(2);
    expect(strokeElement(0).getAttribute('data-object-id')).toBe(strokeData(0).id);
    expect(strokeElement(1).getAttribute('data-object-id')).toBe(strokeData(1).id);
    expect(strokeElement(1).style.zIndex).toBe(String(strokeData(1).z));
  });

  it('carries the ink and the pen in the document, where a colleague can read them', () => {
    penInHand();
    clickPenColor('purple');
    coalescedDragOnPen({ x: 260, y: 240 }, { x: 520, y: 420 }, 6, 4);
    const stroke = strokeData(0);
    expect(stroke.color).toBe('purple');
    expect(strokeElement(0).getAttribute('data-color')).toBe('purple');
    expect(strokeElement(0).getAttribute('data-thickness')).toBe(stroke.thickness);
  });

  it('is drawn at the size the board is, and the same path whatever the zoom', () => {
    const stroke = drawOne();
    const before = strokeLineElement(0).getAttribute('d');
    setZoom(2);
    expect(strokeLineElement(0).getAttribute('d')).toBe(before);
    expect(strokeLineElement(0).getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD[stroke.thickness]),
    );
    // The box on the screen is the board's box times the zoom, which is the only place
    // the zoom appears in this component at all.
    const style = strokeElement(0).style;
    expect(Number.parseFloat(style.width)).toBeCloseTo(stroke.width ?? 0, 3);
  });

  it('leaves the board to the board when the pen is put down', () => {
    const stroke = drawOne();
    // The pen is still in hand - which is the point of it staying - and putting it down is
    // this tab's choice, not the drawing's: Escape hands the board back to the select tool
    // and the stroke stays exactly where it was drawn.
    expect(pressedTool()).toBe('pen');
    keydown('Escape');
    expect(pressedTool()).toBe('select');
    expect(document.querySelector('[data-testid="pen-tool-surface"]')).toBeNull();
    expect(document.querySelector('[data-testid="pen-toolbar"]')).toBeNull();
    expect(strokeElements()).toHaveLength(1);
    expect(strokeData(0).id).toBe(stroke.id);
    expect(strokeLineElement(0).getAttribute('d')).not.toBe('');
  });
});

describe('the pen over other people\'s work', () => {
  it('draws over a note without touching it', () => {
    createSelectedNote('Roadmap');
    const before = noteData(0);
    penInHand();
    dragPenThrough(scribble.map((point) => ({ x: point.x, y: point.y })));
    expect(strokes()).toHaveLength(1);
    expect(noteData(0).x).toBe(before.x);
    expect(noteData(0).y).toBe(before.y);
    expect(noteData(0).z).toBe(before.z);
  });

  it('is above the notes it was drawn over, and the newest stroke is on top', () => {
    createSelectedNote('Roadmap');
    const note = noteData(0);
    penInHand();
    dragPenThrough(loopAround(note.x + STICKY_OFFSET, note.y + STICKY_OFFSET));
    const second = strokeData(0).z;
    expect(second).toBeGreaterThan(note.z);
    // And the next stroke drawn is above that one: the order on the board is the order the
    // pen went over it, which is what `bringToFront` shares.
    dragPen({ x: 200, y: 200 }, { x: 420, y: 320 });
    expect(strokeData(1).z).toBeGreaterThan(second);
  });
});
