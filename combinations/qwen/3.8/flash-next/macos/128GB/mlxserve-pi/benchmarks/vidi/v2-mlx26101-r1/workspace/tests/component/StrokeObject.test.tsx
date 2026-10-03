// stroke.object component tests (story 11, TC-15, TC-16, TC-21).
//
// A stroke is an ordinary object of story 7's machinery with one extraordinary property: its box
// is not it. A squiggle's bounding box is a rectangle nobody drew, so the tests here are mostly
// about where a press lands — on the line, or through the box:
//
//  * TC-15 asks the model's own rule, `registry.hitTest`, at a distance of five and seven screen
//    pixels at two zooms. The tolerance is stated in screen pixels precisely so that the answer
//    does not change with the zoom, and the test says so by getting the same verdict at 50% and
//    at 200% — which it would not if the number were a board measurement.
//  * TC-16 is the negative half, and the half that a hit test alone cannot express: a press
//    inside the box, far from the line, with a sticky note behind it. That press belongs to the
//    note. If it selected the drawing, every stroke ever drawn would be an invisible shield over
//    the board (pen.select).
//  * TC-21 is the object vanishing underneath the selection, which story 7 already knows how to
//    survive and which a drawing has no right to handle differently.
//
// The path is drawn along the x axis from 0 to 100 wherever a distance matters: the perpendicular
// distance from a point to that line is then the point's own y, in board units, so "five screen
// pixels at this zoom" is written as 5 / zoom and needs no trigonometry to trust.

import { describe, expect, it } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { worldToScreen } from '../../src/client/canvas/camera';
import { deleteObjects, objectSnapshots } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX, STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { scaledPoints, strokePolyline } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { handwrittenLoop } from '../fixtures/pen-paths';
import {
  boardDoc,
  clickNote,
  clickStroke,
  createNote,
  noteSelected,
  peerTab,
  readCamera,
  renderBoard,
  selectionBarEl,
  selectionCountText,
  selectedIds,
  seedStroke,
  shiftClickStroke,
  strokeEl,
  strokeInkEl,
  strokeLineEl,
  strokeOf,
  strokes,
  windowKey,
} from './helpers';

/** A hundred board units of straight line, the default nib, in world coordinates. */
const FLAT: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

/** The stroke's own rule, from the registry the board selects with. */
const rule = () => {
  const spec = getObjectType('stroke');
  if (!spec) throw new Error('the board has no stroke type registered');
  return spec.hitTest;
};

/**
 * A point `pixels` screen pixels below the line, at `zoom`: the board units a press is `pixels`
 * away on the screen, given that a board unit is `zoom` pixels.
 */
const below = (pixels: number, zoom: number): Point => ({ x: 50, y: pixels / zoom });

describe('Stroke object (stroke.object)', () => {
  it('TC-15 is caught by its line at five screen pixels and missed at seven, at 50% and at 200%', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    const stroke = strokeOf(id);
    const nib = PEN_THICKNESS_WORLD[stroke.thickness];

    for (const zoom of [0.5, 2]) {
      // The same verdict at both zooms, which is what "the allowance is six screen pixels" means:
      // it is asked in board units only after being divided by the zoom it is looked at through.
      expect(rule()(stroke, below(5, zoom), zoom)).toBe(true);
      expect(rule()(stroke, below(7, zoom), zoom)).toBe(false);
      // Above or below the line: it is a line and not a one-sided rule.
      expect(rule()(stroke, { x: 50, y: -5 / zoom }, zoom)).toBe(true);
      // And past the end of it there is nothing to catch a press, however close: the box that
      // contains that point contains no ink.
      expect(rule()(stroke, { x: 200, y: 0 }, zoom)).toBe(false);
    }

    // A zoom that was not passed is taken to be 100%, because that is the zoom the board opens at.
    expect(rule()(stroke, { x: 50, y: 5 })).toBe(true);
    expect(rule()(stroke, { x: 50, y: 7 })).toBe(false);

    // The nib itself counts too: a press closer than half its width is on the ink wherever the
    // screen allowance has already let it through, and a nib wider than the allowance is caught
    // by its own width — which is why the rule asks for the wider of the two and not the sum.
    const bold = strokeOf(seedStroke(FLAT, 'black', 'thick'));
    expect(rule()(bold, below(3, 2), 2)).toBe(true);
    expect(nib / 2).toBeLessThan(STROKE_HIT_TOLERANCE_PX);
  });

  it('TC-16 lets a press inside its box but far from its line through to the note underneath', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    // A note behind the whole drawing, so that every point of the drawing's box is a point of
    // something the person could mean to press.
    const note = createNote(-10, -40);
    const box = strokeEl(id);

    // The box takes no presses: this is the DOM's half of the rule, and without it a stroke would
    // be an invisible shield over everything its rectangle happens to cover.
    expect(box.style.pointerEvents).toBe('none');
    expect(box.dataset.objectType).toBe('stroke');

    // A press in the middle of the box, thirty board units clear of the line, which is a point of
    // the note: the browser hands the press to the note, and that is the whole of the test.
    clickNote(note);

    expect(noteSelected(note)).toBe(true);
    expect(box.getAttribute('data-selected')).toBe('false');
    expect(selectedIds()).toEqual([note]);
    // The model's rule agrees that the press was nowhere near the drawing — DOM and hit test are
    // the same distance from the same line, which is what keeps them from drifting apart.
    expect(rule()(strokeOf(id), { x: 50, y: 30 }, readCamera().zoom)).toBe(false);

    // And the line itself is still a handle: pressing it selects the drawing and lets go of the
    // note, because a person who aims at a line means the line.
    clickStroke(id);
    expect(selectedIds()).toEqual([id]);
    expect(noteSelected(note)).toBe(false);
  });

  it('TC-21 lets go of a drawing another person deleted', () => {
    renderBoard();
    const id = seedStroke(handwrittenLoop(30));
    const note = createNote(300, 300);
    // Two things selected, so that the selection itself is something the screen can show: the bar
    // counts what is held, and a count is the only honest way to see it shrink.
    clickNote(note);
    shiftClickStroke(id);
    // Both are held. Compared as a set: the DOM reports them in the order the object types are
    // listed in, which is nothing a test should be depending on.
    expect([...selectedIds()].sort()).toEqual([note, id].sort());
    expect(selectionCountText()).toBe('2 selected');

    // Another tab deletes the drawing. The update arrives with a foreign origin, which is all
    // "remote" means to this client.
    const peer = peerTab();
    act(() => {
      deleteObjects(peer, [id]);
    });

    // Gone from the document, gone from the screen, and gone from the selection: story 7's
    // stale-id handling, which a drawing joins rather than replacing (pen.consistent).
    expect(strokes()).toHaveLength(0);
    expect(document.querySelector(`[data-object-id="${id}"]`)).toBeNull();
    expect(selectedIds()).toEqual([note]);
    // The bar counts what is held, and one thing held is no bar at all: it went with the count
    // dropping under two, which is story 7's rule and not a drawing's.
    expect(selectionBarEl()).toBeNull();
    expect(noteSelected(note)).toBe(true);

    // No error, and nothing left behind: the board still answers afterwards, which is more than
    // any log line.
    clickNote(note);
    expect(selectedIds()).toEqual([note]);
    const again = seedStroke(FLAT);
    clickStroke(again);
    expect(selectedIds()).toEqual([again]);
    expect(document.querySelector('[data-testid="load-failure"]')).toBeNull();
  });

  it('is an ordinary object as far as the board machinery is concerned', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    const spec = getObjectType('stroke');
    expect(spec).toBeDefined();
    // Resizable, and aspect-locked like a note and a shape: a drawing stretched sideways is the
    // same drawing, and one stretched in one axis only is a different one (pen.resize).
    expect(spec!.resizable).toBe(true);
    expect(spec!.aspectLocked).toBe(true);
    expect(spec!.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    // No text to edit, so the board's Enter and double-click-to-edit have nothing to open.
    expect(spec!.editableText).toBe(false);

    // It appears in the object list, and Delete removes it through the generic path.
    windowKey('Escape');
    clickStroke(id);
    windowKey('Delete');
    expect(strokes()).toHaveLength(0);
    expect(objectSnapshots(boardDoc())).toHaveLength(0);
  });

  it('draws the path in its own box, and resizes with it', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    const stroke = strokeOf(id);
    const svg = strokeEl(id).querySelector('svg')!;
    const ink = strokeInkEl(id);

    // The svg is the box, and the viewBox says so: the path is written in the box's own units,
    // which is what lets a handle scale the drawing by changing the box alone.
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${stroke.width} ${stroke.height}`);
    expect(ink.getAttribute('stroke')).toBe(PEN_COLORS[stroke.color]);
    expect(ink.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD[stroke.thickness]));
    expect(ink.getAttribute('stroke-linecap')).toBe('round');

    // Every drawn coordinate lies inside the box it is claimed to lie in.
    const local = scaledPoints(stroke);
    const d = ink.getAttribute('d') ?? '';
    for (const p of local) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(stroke.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(stroke.height);
    }
    // One point of the path is where the model says the line starts, in box units: an offset that
    // was applied twice, or not at all, would show up here as the first number of the path.
    expect(d.startsWith('M ')).toBe(true);
    expect(d).toContain(String(Math.round(local[0]!.x * 100) / 100));
  });

  it('gives the line a hit path as wide as the model asks for', () => {
    renderBoard();
    const id = seedStroke(FLAT, 'blue', 'thin');
    const zoom = readCamera().zoom;
    const stroke = strokeOf(id);
    const nib = PEN_THICKNESS_WORLD[stroke.thickness];
    const hit = strokeLineEl(id);

    // Twice the registry's tolerance: the DOM's band and the model's band are the same band, and
    // a press cannot be "on the line" to one and "beside it" to the other.
    expect(Number(hit.getAttribute('stroke-width'))).toBeCloseTo(
      2 * Math.max(nib / 2, STROKE_HIT_TOLERANCE_PX / zoom),
      6,
    );
    // Painted with nothing, and hit by its stroke: an invisible line is not a line to a browser
    // unless it is told otherwise, and an element painted with zero opacity is not painted.
    expect(hit.getAttribute('stroke')).toBe('transparent');
    expect(hit.style.pointerEvents).toBe('stroke');
    expect(strokeEl(id).getAttribute('role')).toBe('img');
    expect(strokeEl(id).getAttribute('aria-label')).toBe('Drawing');
  });

  it('is a dot on the screen as well as in the document', () => {
    renderBoard();
    // One point, the width of the nib: the box the model gives it, and the path that box holds.
    const id = seedStroke([{ x: 20, y: 20 }], 'red', 'thick');
    const stroke = strokeOf(id);
    const nib = PEN_THICKNESS_WORLD.thick;
    expect(stroke.width).toBe(nib);
    expect(stroke.height).toBe(nib);
    expect(strokePolyline(stroke)).toEqual([{ x: 20, y: 20 }]);

    const ink = strokeInkEl(id);
    // A zero-length subpath with a round cap is a dot; writing the same point twice is what makes
    // the browser draw a cap at all, since an empty path is drawn as nothing.
    expect(ink.getAttribute('d')).toBe(`M ${nib / 2} ${nib / 2} L ${nib / 2} ${nib / 2}`);
    expect(ink.getAttribute('stroke-linecap')).toBe('round');
    expect(ink.getAttribute('stroke')).toBe(PEN_COLORS.red);

    // The press that catches a dot is the screen allowance wide, not two pixels wide: a dot of a
    // fine nib is a hard thing to aim at otherwise.
    expect(Number(strokeLineEl(id).getAttribute('stroke-width'))).toBeCloseTo(
      2 * Math.max(nib / 2, STROKE_HIT_TOLERANCE_PX / readCamera().zoom),
      6,
    );
    clickStroke(id);
    expect(selectedIds()).toEqual([id]);
  });

  it('keeps its box and its line where they were when the board was resized around it', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    const before = strokeOf(id);
    const screenOf = (p: Point) => worldToScreen(readCamera(), p);

    // A press on the line is a press at the screen point the line is drawn at — which is what
    // makes `clickStroke` above, dispatched at the element's own origin, a press on the ink.
    const onLine = screenOf({ x: 50, y: 0 });
    expect(onLine.y).toBeCloseTo(screenOf({ x: 0, y: 0 }).y, 6);
    // A horizontal line is as long as it is and as wide as its nib: the box is the line's, grown
    // by half a nib on every side so that the ink it holds is inside it.
    expect(before.width).toBeCloseTo(100 + PEN_THICKNESS_WORLD.medium, 6);
    expect(before.height).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 6);

    // A stroke two hundred units away is not in the same place as the box: the box is the line's
    // and not the board's.
    const far = seedStroke([
      { x: 400, y: 400 },
      { x: 500, y: 500 },
    ]);
    expect(strokeOf(far).x).toBeGreaterThan(before.x);
    expect(strokeEl(id).style.left).toBe(`${before.x}px`);
    expect(strokeEl(id).style.top).toBe(`${before.y}px`);
  });

  it('takes a double-click for itself instead of letting the board make a note', () => {
    renderBoard();
    const id = seedStroke(FLAT);
    const before = objectSnapshots(boardDoc()).length;
    fireEvent.doubleClick(strokeInkEl(id), { clientX: 0, clientY: 0 });
    expect(objectSnapshots(boardDoc()).length).toBe(before);
    expect(objectSnapshots(boardDoc()).some((o) => o.type === 'sticky')).toBe(false);
  });
});
