// What a drawing looks like, and what a click on one does (`stroke.object`, `pen.select`).
//
// Two things are under test here and both are about the screen rather than the document.
// The first is that a stroke is painted from what is stored and from nothing else: the same
// `d` on every screen, in board units, with round ends — which is what makes a shared sketch
// the same sketch to both people, and what makes a dot a dot. The second is that a stroke is
// *clicked by its line and not by its box*: a drawing's box is mostly empty air, and a click
// out in that air has to reach whatever is behind it (TC-16), while a click near the ink —
// within six screen pixels, or half the line's own thickness if the line is thicker — selects
// the drawing (`pen.select`).
//
// How jsdom is made to answer the second one honestly: jsdom hit-tests nothing, so a test
// says which element a browser would have landed on. A pointer within the target stroke's
// width is dispatched on that invisible stroke, which is what a browser does with it; a
// pointer nowhere near the ink is dispatched on the object underneath, because the drawing's
// own wrapper says `pointerEvents: none` and so cannot be landed on at all. What makes that
// more than a convention is that the target's width is asserted here to be exactly twice the
// distance `hitTestStroke` measures at the zoom on screen — the rule and the target are one
// number, so the browser cannot disagree with the function — and that the distances this test
// claims are measured from the stored points, not assumed from where it happened to click.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (stroke.object, pen.select)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, within } from '@testing-library/react';
import { screen } from '@testing-library/react';
import * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { objectBounds, deleteObjects, snapshotObjects } from '../../src/shared/board-model';
import { rectContains } from '../../src/shared/geometry';
import { smoothPath } from '../../src/shared/geometry/simplify';
import {
  hitTestStroke,
  strokeHitToleranceWorld,
} from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { penTest } from './helpers/stroke-assertions';
import {
  camera,
  clickPenColor,
  clickPenThickness,
  dispatchPointer,
  doc,
  drawStroke,
  drawnD,
  FakeWebsocketProvider,
  flush,
  makeNote,
  makeStroke,
  open,
  penToolActive,
  pressPenTool,
  screenOfPoint,
  selectedStrokeIds,
  setCameraTo,
  strokeBox,
  strokeDrawnPoints,
  strokeElement,
  strokeElements,
  strokeHitPath,
  strokeHitWidth,
  strokeObject,
  strokePaint,
} from './helpers/pen-ui';
import { handwrittenLoop, underline } from '../fixtures/pen-paths';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

const BOARD_ID = 'stroke-object-under-test';

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebsocketProvider.reset();
  open(BOARD_ID);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('stroke.object', () => {
  // TC-15
  it('TC-15 paints the stored path as one smooth path, in board units, whatever the zoom', () => {
    const id = makeStroke(handwrittenLoop({ x: 0, y: -20 }, 140, 60));
    const drawn = drawnD(id);

    // Smooth curves rather than a polyline of straight runs, because the drawing is what a
    // hand made and a polyline is what a mouse would have made.
    expect(drawn).not.toBe('');
    expect(drawn).toContain('Q');
    // Exactly what the stored points say, recomputed here: nothing about the screen, the
    // zoom or the camera goes into it, which is the whole reason two screens holding the
    // same stroke cannot help agreeing about what it looks like.
    expect(drawn).toBe(smoothPath(strokeDrawnPoints(id)));

    // Look at it from the other end of the zoom range: the same string, because the path is
    // in board units and the world layer is the thing that scales it.
    setCameraTo(2);
    expect(drawnD(id)).toBe(drawn);
    setCameraTo(0.4);
    expect(drawnD(id)).toBe(drawn);
    setCameraTo(1);
    expect(drawnD(id)).toBe(drawn);

    // A drawing and nothing else: there is no text in it to edit.
    expect(within(strokeElement(id)).queryByTestId('sticky-note-text')).toBeNull();
    expect(strokeElement(id).dataset.selected).toBe('false');
  });

  // TC-15
  it('TC-15 paints a stroke with the colour and thickness it was drawn with', () => {
    pressPenTool();
    const black = drawStroke(underline({ x: -200, y: -120 }, 300, 12))[0] as string;
    expect(strokePaint(black)).toEqual({
      stroke: PEN_COLORS.black,
      width: PEN_THICKNESS_WORLD.medium,
    });

    clickPenColor('red');
    const red = drawStroke(underline({ x: -200, y: -80 }, 300, 12), { pressTool: false })[0] as string;
    expect(strokePaint(red).stroke).toBe(PEN_COLORS.red);
    expect(strokePaint(red).width).toBe(PEN_THICKNESS_WORLD.medium);

    clickPenColor('blue');
    clickPenThickness('thick');
    const thick = drawStroke(underline({ x: -200, y: -40 }, 300, 12), { pressTool: false })[0] as string;
    expect(strokePaint(thick).stroke).toBe(PEN_COLORS.blue);
    expect(strokePaint(thick).width).toBe(PEN_THICKNESS_WORLD.thick);

    // Round ends and round joins, which is what makes a hard turn read as a bend a pen made
    // rather than as a corner somebody forgot to finish.
    const path = within(strokeElement(thick)).getByTestId('stroke-path');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('fill')).toBe('none');

    // And the element says what it is, so none of the above depends on reading colours off
    // a screen.
    expect(strokeElement(thick).dataset.color).toBe('blue');
    expect(strokeElement(thick).dataset.thickness).toBe('thick');
  });

  // TC-15
  it('TC-15 draws one stored stroke once, and calls it a drawing to a screen reader', () => {
    const id = makeStroke(underline({ x: -100, y: 200 }, 200, 10));
    expect(strokeElements()).toHaveLength(1);
    expect(within(strokeElement(id)).getByTestId('stroke-object-svg').getAttribute('aria-label')).toBe(
      'Drawing',
    );

    // The box on the screen is the box in the document, in board units: the world layer's
    // transform is what turns it into pixels, which is why the string above never changes.
    const style = strokeElement(id).style;
    const box = strokeBox(id);
    expect(Number.parseFloat(style.left)).toBeCloseTo(box.x, 3);
    expect(Number.parseFloat(style.top)).toBeCloseTo(box.y, 3);
    expect(Number.parseFloat(style.width)).toBeCloseTo(box.width, 3);
    expect(Number.parseFloat(style.height)).toBeCloseTo(box.height, 3);
  });

  // The box is a stroke's place and not its shape: the drawing may be painted outside it,
  // and the box is not the thing that takes the pointer.
  it('TC-15 gives a stroke a box that holds it and hands the pointer on', () => {
    const id = makeStroke(underline({ x: -260, y: 100 }, 400, 12));
    const box = strokeBox(id);
    expect(box.width).toBeGreaterThan(400);
    expect(box.height).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
    expect(strokeElement(id).style.pointerEvents).toBe('none');
    // The invisible target is the only part of the drawing that takes the pointer, and it is
    // the part a click is measured against.
    expect(strokeHitPath(id).getAttribute('stroke')).toBe('transparent');
    expect(strokeHitPath(id).style.pointerEvents).toBe('stroke');
    expect(strokeElement(id).style.overflow).toBe('visible');
  });

  // TC-15, at the size a stroke cannot go below.
  it('TC-15 keeps the box of a stroke at least as big as the smallest it may be', () => {
    const id = makeStroke([{ x: 0, y: 0 }], { thickness: 'thin' });
    expect(strokeBox(id).width).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
    expect(strokeBox(id).height).toBeGreaterThanOrEqual(STROKE_MIN_SIZE_WORLD);
    expect(strokeDrawnPoints(id)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('pen.select', () => {
  // TC-16
  it('TC-16 selects a stroke from a click near its line', () => {
    const id = makeStroke(underline({ x: -200, y: 40 }, 400, 12));
    expect(selectedStrokeIds()).toHaveLength(0);

    // A pointer that lands on the target stroke is, by construction, a pointer within the
    // tolerance of the ink: the target is drawn exactly twice as wide as the tolerance,
    // which is the test after this one's arithmetic. This is how a browser puts a pointer
    // on a stroke.
    clickOnTarget(id);
    expect(selectedStrokeIds()).toEqual([id]);
    expect(strokeElement(id).dataset.selected).toBe('true');

    // The drawing is what is selected, which is what the selection's own overlay is for —
    // and it is resizable, because the registry says a drawing is: these are the handles
    // that resize it in proportion.
    expect(screen.getByTestId('selection-box')).toBeTruthy();
    expect(screen.getAllByTestId('resize-handle').length).toBeGreaterThan(0);
  });

  // TC-16, in the one respect jsdom will never show by itself.
  it('TC-16 stops the browser picking a drawing up when its line is pressed', () => {
    const id = makeStroke(handwrittenLoop({ x: 0, y: 0 }, 120, 40));
    const spot = screenOfPoint(penTest.firstPoint(strokeDrawnPoints(id)));
    const down = dispatchPointer(strokeHitPath(id), 'pointerdown', spot.x, spot.y);

    // Firefox reads an `<svg>` as a picture it may pick up and drag: press a drawing, move
    // a few pixels, and it fires `dragstart` and then `pointercancel` for that pointer, so
    // the gesture sees a cancelled pointer and the drawing never moves. That is what TC-20's
    // e2e run found in Firefox and in no other browser, and it is the reason the press that
    // selects a drawing also cancels the action behind it.
    expect(down.defaultPrevented).toBe(true);

    // And it is still a press the board can use: the drawing becomes the selection and
    // stays it, which is the half the test before this one checks from the other side.
    expect(selectedStrokeIds()).toEqual([id]);
    dispatchPointer(strokeHitPath(id), 'pointerup', spot.x, spot.y);
    flush();
    expect(selectedStrokeIds()).toEqual([id]);
  });

  // TC-16
  it('TC-16 lets a click inside the box of a stroke but far from its line through to what is behind', () => {
    const note = makeNote(-40, 60);
    const id = makeStroke(handwrittenLoop({ x: 0, y: 40 }, 150, 60));

    // The drawing is on top of the note: it was made second, and so has the higher z. So an
    // empty click inside its box would be the drawing's, if the box were the drawing.
    const objects = snapshotObjects(doc());
    const strokeZ = objects.find((object) => object.id === id)?.z;
    const noteZ = objects.find((object) => object.id === note)?.z;
    if (strokeZ === undefined || noteZ === undefined) throw new Error('the scenery went missing');
    expect(strokeZ).toBeGreaterThan(noteZ);

    const centre = { x: 0, y: 40 };
    // The middle of a ring is inside its box and nowhere near its ink: both halves of what
    // this test is about, measured from the stored points rather than assumed.
    expect(rectContains(objectBounds(strokeObject(id)), { ...centre, width: 0, height: 0 })).toBe(true);
    expect(penTest.distanceFromPath(centre, strokeDrawnPoints(id))).toBeGreaterThan(100);

    // The box takes no pointer and nothing in the drawing is near this point, so a browser
    // hands the press to the note underneath: the note is selected and the stroke is not.
    clickOn(note, centre);
    expect(screen.getByTestId('sticky-note').dataset.selected).toBe('true');
    expect(selectedStrokeIds()).toEqual([]);

    // The same pointer, moved onto the ink, is the drawing's: the distance rule holds from
    // both sides of the line.
    clickOnTarget(id, penTest.firstPoint(strokeDrawnPoints(id)));
    expect(selectedStrokeIds()).toEqual([id]);
  });

  // The number that makes the two tests above one sentence: the target is twice as wide as
  // the tolerance, in board units, at whatever zoom the board is at.
  it('TC-16 makes the target exactly as grabbable as the tolerance says, at any zoom', () => {
    const id = makeStroke(underline({ x: -180, y: -200 }, 300, 12), { thickness: 'thin' });
    // At this zoom a thin line's target is the six screen pixels the PRD promises rather
    // than the line's own two board units, which is the whole reason a fine pen is still
    // something you can click.
    expect(strokeHitWidth(id)).toBeCloseTo(
      2 * Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / camera().zoom),
      6,
    );
    expect(strokeHitWidth(id)).toBeCloseTo(2 * STROKE_HIT_TOLERANCE_PX, 6);
    expect(strokeHitToleranceWorld('thin', 1)).toBeCloseTo(STROKE_HIT_TOLERANCE_PX, 6);
    expect(strokeHitToleranceWorld('thin', 1)).toBeGreaterThan(PEN_THICKNESS_WORLD.thin / 2);

    // A line is never harder to grab than its own thickness, and the pixel half of the rule
    // is what shrinks when the board is zoomed in.
    const thick = makeStroke(underline({ x: -180, y: -160 }, 300, 12), { thickness: 'thick' });
    expect(strokeHitWidth(thick)).toBeCloseTo(
      2 * Math.max(PEN_THICKNESS_WORLD.thick / 2, STROKE_HIT_TOLERANCE_PX),
      6,
    );
    expect(strokeHitWidth(thick)).toBeGreaterThanOrEqual(PEN_THICKNESS_WORLD.thick);
    setCameraTo(3);
    expect(strokeHitWidth(id)).toBeCloseTo(
      2 * Math.max(PEN_THICKNESS_WORLD.thin / 2, STROKE_HIT_TOLERANCE_PX / 3),
      6,
    );
    // The thick line's target is its own four units wide by then, twice the thin line's.
    expect(strokeHitWidth(thick)).toBeGreaterThan(strokeHitWidth(id));

    // And what that comes to in pixels is the same at every zoom, which is what "within six
    // screen pixels" means: the world width moves so that the screen width does not.
    expect(strokeHitWidth(id) * 3).toBeCloseTo(2 * STROKE_HIT_TOLERANCE_PX, 6);
    setCameraTo(0.4);
    expect(strokeHitWidth(id)).toBeCloseTo(2 * (STROKE_HIT_TOLERANCE_PX / 0.4), 6);
    expect(strokeHitWidth(id) * 0.4).toBeCloseTo(2 * STROKE_HIT_TOLERANCE_PX, 6);
    setCameraTo(1);
  });

  // A stroke drawn over other things is above them and still not in their way.
  it('TC-16 keeps a stroke that lies over a note from holding the note down', () => {
    const note = makeNote(120, -120);
    const id = makeStroke(underline({ x: 40, y: -140 }, 200, 10), { thickness: 'thick' });
    // The drawing crosses the note: a click in the empty part of its box is the note's, and
    // a click on its ink is the drawing's, with both of them on the screen at once.
    clickOn(note, { x: 200, y: -40 });
    expect(screen.getByTestId('sticky-note').dataset.selected).toBe('true');
    expect(selectedStrokeIds()).toEqual([]);

    clickOnTarget(id, { x: 140, y: -140 });
    expect(selectedStrokeIds()).toEqual([id]);
    expect(strokeElements()).toHaveLength(1);
    expect(screen.getAllByTestId('sticky-note')).toHaveLength(1);
  });

  // The error path of a chosen drawing: the other person deletes it. Story 7's selection is
  // what drops ids that are gone, so all this type has to do is not be the thing that
  // throws — a drawing that is asked to draw itself when it is no longer in the document
  // draws nothing, and the selection is simply empty afterwards.
  it('TC-21 stops being selected when somebody else deletes the drawing', () => {
    const id = makeStroke(handwrittenLoop({ x: -100, y: 200 }, 150, 60));
    clickOnTarget(id);
    expect(selectedStrokeIds()).toEqual([id]);
    expect(screen.getByTestId('selection-box')).toBeTruthy();

    // A second person, in their own copy of the board, deletes it.
    const other = new Y.Doc();
    act(() => {
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc()));
      deleteObjects(other, [id]);
      Y.applyUpdate(doc(), Y.encodeStateAsUpdate(other));
    });
    flush();

    // The drawing is off the screen, the selection is empty rather than full of an id that
    // is not there, and the board is still working: the pen draws, and the drawing it makes
    // is the only object left.
    expect(strokeElements()).toHaveLength(0);
    expect(selectedStrokeIds()).toEqual([]);
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(screen.queryByTestId('selection-outline')).toBeNull();

    const next = drawStroke(underline({ x: -200, y: -200 }, 300, 10));
    expect(next).toHaveLength(1);
    expect(strokeElements()).toHaveLength(1);
    expect(penToolActive()).toBe(true);
  });
});

describe('pen.resize', () => {
  // A drawing is the first type in this board that is *scaled* rather than reflowed when
  // its box grows, and the first whose resize must not pick one axis. What the type owns is
  // the drawing's side of that; the handle, the clamp and the lock itself are story 4's and
  // are tested in Selection and TransformGesture, so this writes the box that the locked
  // handle would have written and asks what the drawing did about it — which is how
  // ShapeObject tests the same seam.
  it('TC-15 tells the resize gesture to scale a drawing in proportion, down to a floor', () => {
    const type = getObjectType('stroke');
    if (!type) throw new Error('a stroke was never registered');
    expect(type.resizable).toBe(true);
    // Both ways at once, so the thing that was drawn is the thing that is bigger.
    expect(type.aspectLocked).toBe(true);
    expect(type.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    // A drawing has nothing to type into, and it is not one of the types that drag by
    // their sides only: it has all eight handles like anything else.
    expect(type.editableText).toBe(false);
    expect(type.handles ?? null).not.toBe('horizontal');
  });

  // TC-15
  it('TC-15 scales a drawing with its box and keeps it the same drawing', () => {
    const id = makeStroke(handwrittenLoop({ x: 0, y: -40 }, 150, 60), { thickness: 'medium' });
    const before = strokeBox(id);
    const beforeInk = strokeDrawnPoints(id);
    const stored = [...strokeObject(id).points];
    // A fresh stroke is drawn at exactly the size it was made at: the scale a resize works
    // from is the box the stroke was born with.
    expect(strokeObject(id).baseWidth).toBeCloseTo(before.width, 6);
    expect(strokeObject(id).baseHeight).toBeCloseTo(before.height, 6);

    // Twice the box, both ways: what the aspect-locked corner handle writes.
    resizeBox(id, { width: before.width * 2, height: before.height * 2 });
    const after = strokeBox(id);
    expect(after.width).toBeCloseTo(before.width * 2, 4);
    expect(after.height).toBeCloseTo(before.height * 2, 4);

    // The drawing is twice as big and no different in any other way: the same points, the
    // same proportions, the same corner it was anchored to. Nothing was redrawn and nothing
    // was added, which is all a *scaled* sketch can mean.
    const afterInk = strokeDrawnPoints(id);
    expect(afterInk).toHaveLength(beforeInk.length);
    beforeInk.forEach((point, index) => {
      const grown = afterInk[index];
      if (!grown) throw new Error('the drawing lost a point when it was resized');
      expect(grown.x).toBeCloseTo(before.x + (point.x - before.x) * 2, 3);
      expect(grown.y).toBeCloseTo(before.y + (point.y - before.y) * 2, 3);
    });

    // And the document still holds the path as it was drawn: a resize writes a box and
    // never a drawing, so the same points that were drawn are in the document afterwards.
    expect([...strokeObject(id).points]).toEqual(stored);
    expect(strokeObject(id).baseWidth).toBeCloseTo(before.width, 6);
    expect(strokeObject(id).baseHeight).toBeCloseTo(before.height, 6);
    expect(strokeObject(id).thickness).toBe('medium');
  });

  // What the aspect lock exists to prevent, shown from the side the type can be held to:
  // a drawing renders its box, so a box that grew on one axis only stretches the drawing.
  it('TC-15 draws a drawing at whatever shape its box became, which is what the lock is for', () => {
    const id = makeStroke(handwrittenLoop({ x: -100, y: 100 }, 200, 100), { thickness: 'medium' });
    const before = strokeBox(id);
    const beforeInk = strokeDrawnPoints(id);

    resizeBox(id, { width: before.width * 2, height: before.height });
    const afterInk = strokeDrawnPoints(id);
    afterInk.forEach((point, index) => {
      const was = beforeInk[index];
      if (!was) throw new Error('the drawing lost a point when it was resized');
      expect(point.x).toBeCloseTo(before.x + (was.x - before.x) * 2, 3);
      expect(point.y).toBeCloseTo(was.y, 3);
    });

    // The hit test follows the drawing rather than the box it was drawn in, so a stretched
    // drawing is grabbed where the stretched line now is and nowhere else. The ring starts
    // at its widest point, which is the end the stretch moves most and the end the stretched
    // ring comes back nowhere near — the honest place to ask which of the two lines a click
    // is on.
    const side = 0;
    const was = beforeInk[side];
    const now = afterInk[side];
    if (!was || !now) throw new Error('the ring is shorter than its own middle');
    expect(hitTestStroke(strokeObject(id), now, 1)).toBe(true);
    expect(hitTestStroke(strokeObject(id), was, 1)).toBe(false);
    expect(penTest.distanceFromPath(was, afterInk)).toBeGreaterThan(STROKE_HIT_TOLERANCE_PX);
  });
});

// --- how a pointer is put somewhere, given that jsdom hit-tests nothing -------

/** Write the box of a stroke, which is the only thing a resize of a drawing ever writes. */
function resizeBox(id: string, size: { width: number; height: number }): void {
  const map = doc().getMap<Y.Map<unknown>>('objects').get(id);
  if (!map) throw new Error(`"${id}" is not in the document`);
  act(() => {
    map.set('width', size.width);
    map.set('height', size.height);
  });
  flush();
}

/**
 * Press and release where the drawing's own invisible target is. A browser puts a pointer
 * that is within the target's width on that element; this says the same thing in jsdom.
 */
function clickOnTarget(id: string, at?: { x: number; y: number }): void {
  const spot = screenOfPoint(at ?? penTest.firstPoint(strokeDrawnPoints(id)));
  const target = strokeHitPath(id);
  dispatchPointer(target, 'pointerdown', spot.x, spot.y);
  dispatchPointer(target, 'pointerup', spot.x, spot.y);
  flush();
}

/**
 * Press and release on an object the drawing lies over, at a world point the drawing is
 * nowhere near. The drawing's wrapper takes no pointer, so this is where a browser sends it.
 */
function clickOn(id: string, at: { x: number; y: number }): void {
  const spot = screenOfPoint(at);
  const element =
    (screen.queryAllByTestId('sticky-note') as HTMLElement[]).find((note) => note.dataset.id === id) ??
    screen.getByTestId('board-viewport');
  dispatchPointer(element, 'pointerdown', spot.x, spot.y);
  dispatchPointer(element, 'pointerup', spot.x, spot.y);
  flush();
}
