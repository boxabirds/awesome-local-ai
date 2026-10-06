/**
 * TC-15, TC-16, TC-21 — a drawing on the board: what a click finds, and what a delete leaves.
 *
 * A stroke is the only object on this board whose box is a lie. It is the box *around* a squiggle, and most
 * of it is not the squiggle: a circle drawn round three sticky notes has a box that covers those three notes
 * and a great deal of the air between them. If that box were the object's presence to the pointer, clicking a
 * note inside somebody's annotation would select the annotation, and the sketch would have put a sheet of
 * glass over the board. So the box is transparent, the line is what a pointer can hold, and these tests are
 * that decision taken from the three directions it can be attacked from:
 *
 * — TC-15 asks the rule directly, at the boundary: a point five screen pixels off the line is on the line
 *   and one seven pixels off is not, *at 50 % and at 200 % both*, which is the part a constant world tolerance
 *   gets right at one of those zooms and wrong at the other;
 * — TC-16 asks it of a board with a sticky note under the box where the line is not: the note is what is
 *   found, and the note was written *first*, so the drawing lies on top of it and a hit test that asked about
 *   boxes would have answered with the drawing. That ordering is the whole of the test — with the note on top
 *   it would pass for the wrong reason;
 * — TC-21 asks what a delete leaves: a drawing removed from under the selection — by a stranger, or by the
 *   model in the middle of the person who selected it — leaves no selection, no overlay, no handles and no
 *   exception, which is the stale-id rule every object obeys and the one a drawing can hit mid-drag because a
 *   second person is holding the same document.
 *
 * One thing about the method, because it is the thing a reader of these tests will wonder at. jsdom does no
 * hit testing: it has no layout, so it cannot tell which element is under a coordinate, and that deciding is
 * precisely what a drawing's box and its invisible stroke are for. So the presses here go where a browser's
 * hit test would have put them — on the invisible stroke when the coordinate is on the line, on the note when
 * it is not — and the questions asked afterwards are about what the board did with the press. The rule itself,
 * the one that decides *which* element a browser would have found, is asked of the registry directly, in
 * TC-15 and in the `topmostObjectAt` test below, where the answer is a value rather than a pixel.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { deleteObject } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { PenThickness } from '../../src/shared/config';
import {
  createStroke,
  isStrokeSnapshot,
  scaledPoints,
  strokeColorOf,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke';
import { hitTestObject, topmostObjectAt } from '../../src/client/objects/registry';
import type { HitContext } from '../../src/client/objects/registry';
import { strokeHitWidth } from '../../src/client/objects/StrokeObject';
import {
  act as actOn,
  board,
  nextFrame,
  pointer,
  renderBoard,
  renderedCamera,
  type BoardFixture,
} from './harness';
import type { Point } from '../../src/client/canvas/camera';

/** The line every test here draws: a wide chevron, so its box is mostly not its line. */
const CHEVRON: readonly Point[] = [
  { x: 700, y: 600 },
  { x: 900, y: 800 },
  { x: 1100, y: 600 },
];

/** A straight line, for the tests that need a distance they can state exactly. */
const FLAT: readonly Point[] = [
  { x: 700, y: 700 },
  { x: 900, y: 700 },
  { x: 1100, y: 700 },
];

/** A context the board hands a hit test at this zoom: a zoom, and no boxes to care about. */
const contextAt = (zoom: number): HitContext => ({ zoom, rects: new Map() });

/** The drawing, written through the model, read back as the snapshot the board is drawing. */
function seedStroke(fixture: BoardFixture, points = CHEVRON, thickness: PenThickness = 'medium'): StrokeSnapshot {
  let id = '';
  void actOn(() => {
    const created = createStroke(fixture.doc(), { points, thickness }, 'sam');
    id = typeof created === 'string' ? created : id;
  });
  const stroke = fixture.objects().find((object) => object.id === id);
  if (stroke === undefined || !isStrokeSnapshot(stroke)) throw new Error('the stroke was refused');
  return stroke;
}

/**
 * The point `distance` world units straight below the middle of a straight drawing's line.
 *
 * Straight, because the boundary tests are about a distance and not about a corner: on a chevron the
 * perpendicular from a point below the first end is not the offset you asked for, and the measurement would
 * have to be argued before the rule could be tested.
 */
const below = (stroke: StrokeSnapshot, distance: number): Point => ({
  x: scaledPoints(stroke)[1]!.x,
  y: scaledPoints(stroke)[1]!.y + distance,
});

/** A point on the first leg of the chevron: where the presses that mean the line land. */
const onLine: Point = { x: 800, y: 700 };

/** A point inside the chevron's box and nowhere near its line: the point that has to fall through. */
const throughTheBox: Point = { x: 760, y: 780 };

/**
 * The only part of a drawing a pointer can catch: the invisible stroke over the line.
 *
 * A browser puts a press here when the coordinate is on the line, and on something else when it is not —
 * which is what the element's `pointer-events: stroke` is for, and what jsdom cannot do for itself.
 */
function hitPath(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"] [data-testid="stroke-hit"]`);
  if (el === null) throw new Error('the drawing has no line for a pointer to catch');
  return el;
}

/** Presses a drawing's line where the board draws it, and lifts without moving: a click on the line. */
async function clickLine(fixture: BoardFixture, id: string, world = onLine): Promise<void> {
  const at = fixture.screen(world);
  await actOn(async () => {
    pointer('pointerDown', hitPath(id), at);
    pointer('pointerUp', hitPath(id), at);
    await nextFrame();
  });
}

/** Presses the line and pulls it, in screen pixels: a move of the drawing. */
async function dragLine(fixture: BoardFixture, id: string, world: Point, to: Point): Promise<void> {
  const from = fixture.screen(world);
  const far = fixture.screen({ x: world.x + to.x, y: world.y + to.y });
  pointer('pointerDown', hitPath(id), from);
  await actOn(nextFrame);
  pointer('pointerMove', board(), { x: from.x + 20, y: from.y + 20 });
  await actOn(nextFrame);
  pointer('pointerMove', board(), far);
  await actOn(nextFrame);
  pointer('pointerUp', board(), far);
  await actOn(nextFrame);
}

describe('a drawing on the board', () => {
  it('TC-15 is hit at five screen pixels off the line and missed at seven, at 50 % and at 200 %', () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture, FLAT);
    // The medium pen, so that the margin is the pixels and not the ink: half of 4 world units of ink is 2,
    // and the rule's own margin is 6 screen pixels, which is wider at both of these zooms.
    expect(stroke.thickness).toBe('medium');
    expect(PEN_THICKNESS_WORLD.medium / 2).toBeLessThan(STROKE_HIT_TOLERANCE_PX);

    for (const zoom of [0.5, 2]) {
      const context = contextAt(zoom);
      // Six screen pixels are twelve world units at half size and three at double: the same distance a hand
      // can hold a pointer to, whichever way the board is scaled.
      expect(hitTestObject(stroke, below(stroke, 5 / zoom), context)).toBe(true);
      expect(hitTestObject(stroke, below(stroke, 7 / zoom), context)).toBe(false);
    }

    // The same click, in screen terms, at both zooms: it is the screen distance that decides, and a
    // tolerance written in world units would have hit at one of these two and missed at the other.
    expect(hitTestObject(stroke, below(stroke, 5 / 0.5), contextAt(0.5))).toBe(
      hitTestObject(stroke, below(stroke, 5 / 2), contextAt(2)),
    );
  });

  it('TC-15 lets a thick line be clicked anywhere inside its own ink', () => {
    const fixture = renderBoard();
    const thick = seedStroke(fixture, FLAT, 'thick');
    // At 400 % the pixel margin has shrunk to 1.5 world units and half the ink is 4: the ink is wider than
    // the tolerance, so all of the ink is clickable. Nobody who draws with the fat pen should have to aim at
    // the middle of the line the fat pen drew.
    const zoom = 4;
    expect(STROKE_HIT_TOLERANCE_PX / zoom).toBeLessThan(PEN_THICKNESS_WORLD.thick / 2);
    expect(hitTestObject(thick, below(thick, 3), contextAt(zoom))).toBe(true);
    expect(hitTestObject(thick, below(thick, 4), contextAt(zoom))).toBe(true);
    // Past the ink and past the margin both, it is not.
    expect(hitTestObject(thick, below(thick, 5), contextAt(zoom))).toBe(false);
  });

  it('TC-15 is enclosed by its box when nothing is asking about a click', () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    // The marquee and *select all* ask "is this object in this rectangle", which is a question about the box
    // and not about the line — so they get the box, and the line rule is only in force when a context with a
    // zoom comes with the question.
    // The bottom corner of the box, on the other side of the drawing from its line: a rectangle drawn round
    // a sketch reaches this point, and the point is what encloses the sketch.
    const farCorner: Point = { x: 700, y: 800 };
    expect(scaledPoints(stroke).some((point) => point.x === farCorner.x && point.y === farCorner.y)).toBe(false);
    expect(hitTestObject(stroke, farCorner)).toBe(true);
    expect(hitTestObject(stroke, farCorner, contextAt(1))).toBe(false);
  });

  it('TC-16 gives the point inside its box to the sticky note underneath, though it lies on top', async () => {
    const fixture = renderBoard();
    // Note first, drawing second: the drawing is the top of the stack here, and a hit test that went by boxes
    // would answer with the drawing.
    const note = await fixture.create(760, 780);
    const stroke = seedStroke(fixture);
    const stack = fixture.objects();
    expect(stack.findIndex((object) => object.id === stroke.id)).toBeGreaterThan(
      stack.findIndex((object) => object.id === note),
    );

    // The question the board asks itself, asked outright: what is under this point?
    const found = topmostObjectAt(stack, throughTheBox, contextAt(1));
    expect(found?.id).toBe(note);
    // …and one step nearer the rule, the drawing alone at the same point is nothing at all.
    expect(hitTestObject(stroke, throughTheBox, contextAt(1))).toBe(false);
    expect(hitTestObject(stroke, throughTheBox)).toBe(true);
  });

  it('TC-16 gives the press that falls on the note to the note, and takes nothing for itself', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(760, 780);
    const stroke = seedStroke(fixture);
    const before = fixture.boundsOf(stroke.id);

    // Where a browser's hit test would have put this press: on the note, because the drawing's box lets the
    // pointer through and its line is a hundred world units away.
    const at = fixture.screen(throughTheBox);
    pointer('pointerDown', fixture.objectEl(note) as HTMLElement, at);
    await actOn(nextFrame);
    pointer('pointerUp', fixture.objectEl(note) as HTMLElement, at);
    await actOn(nextFrame);

    expect(fixture.selection().selectedId).toBe(note);
    expect(fixture.selection().ids.has(stroke.id)).toBe(false);
    expect(fixture.boundsOf(stroke.id)).toEqual(before);
  });

  it('TC-16 keeps the note under the drawing clickable everywhere its box is not its line', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(760, 780);
    const stroke = seedStroke(fixture);
    const noteBox = fixture.boundsOf(note);

    // A row of presses over the note, every one of them inside the drawing's box. None of them selects the
    // drawing, because none of them is on its line — which is the difference between an annotation and a
    // sheet of glass laid over the board.
    for (const world of [
      { x: noteBox.x + 20, y: noteBox.y + 20 },
      { x: noteBox.x + noteBox.width / 2, y: noteBox.y + noteBox.height / 2 },
      { x: noteBox.x + noteBox.width - 20, y: noteBox.y + noteBox.height - 20 },
    ]) {
      const el = fixture.objectEl(note) as HTMLElement;
      const at = fixture.screen(world);
      pointer('pointerDown', el, at);
      await actOn(nextFrame);
      pointer('pointerUp', el, at);
      await actOn(nextFrame);
      expect(fixture.selection().selectedId).toBe(note);
    }
    expect(fixture.objects().length).toBe(2);
    expect(fixture.selection().ids.has(stroke.id)).toBe(false);
  });

  it('TC-16 takes the press for itself when the press is on the line', async () => {
    const fixture = renderBoard();
    const note = await fixture.create(760, 780);
    const stroke = seedStroke(fixture);

    // The other side of the same rule, without which everything above only proves that a drawing is never
    // selected — which is not what it is for. A press on the invisible stroke selects the drawing and drops
    // the note, exactly as a press on a shape selects the shape.
    await clickLine(fixture, stroke.id);

    expect(fixture.selection().selectedId).toBe(stroke.id);
    expect(fixture.selection().ids.has(note)).toBe(false);
    expect(fixture.overlayEl()).not.toBeNull();
  });

  it('TC-21 lets go of a drawing that was deleted while it was selected', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    await clickLine(fixture, stroke.id);
    expect(fixture.selection().selectedId).toBe(stroke.id);
    expect(fixture.overlayEl()).not.toBeNull();
    expect(fixture.handles().length).toBeGreaterThan(0);

    // Somebody else deleted it — or the model did, from under the person who had selected it. The selection
    // is told in the same document change that removed the object, so there is no frame in which the board is
    // drawing handles around nothing.
    await actOn(async () => {
      deleteObject(fixture.doc(), stroke.id);
      await nextFrame();
    });

    expect(fixture.selection().size).toBe(0);
    expect(fixture.selection().selectedId).toBeNull();
    expect(fixture.overlayEl()).toBeNull();
    expect(fixture.barEl()).toBeNull();
    expect(fixture.objectEl(stroke.id)).toBeNull();
    expect(fixture.objects().length).toBe(0);
  });

  it('TC-21 survives a delete of the drawing being dragged, and writes nothing after it', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    const from = fixture.screen(onLine);

    // Pressed on the line, dragged, and deleted by a stranger in the middle of the drag: the worst ordering
    // this board has, and the one the selection's prune rule exists for.
    pointer('pointerDown', hitPath(stroke.id), from);
    await actOn(nextFrame);
    pointer('pointerMove', board(), { x: from.x + 40, y: from.y + 30 });
    await actOn(nextFrame);
    await actOn(async () => {
      deleteObject(fixture.doc(), stroke.id);
      await nextFrame();
    });
    pointer('pointerMove', board(), { x: from.x + 80, y: from.y + 60 });
    await actOn(nextFrame);
    pointer('pointerUp', board(), { x: from.x + 80, y: from.y + 60 });
    await actOn(nextFrame);

    // No throw, no selection, no object, and nothing left in the history that would undo a move of a drawing
    // that is not there to be moved.
    expect(fixture.objects().length).toBe(0);
    expect(fixture.selection().size).toBe(0);
    expect(fixture.objectEl(stroke.id)).toBeNull();

    // And the board still works afterwards: the pointer is a pointer again, and a press on empty board is a
    // press on empty board.
    pointer('pointerDown', board(), from);
    await actOn(nextFrame);
    pointer('pointerUp', board(), from);
    await actOn(nextFrame);
    expect(fixture.selection().size).toBe(0);
  });

  it('draws the line in the colour and the width it was drawn with', async () => {
    const fixture = renderBoard();
    const red = seedStroke(fixture, CHEVRON, 'thick');
    await actOn(async () => {
      createStroke(fixture.doc(), { points: [{ x: 700, y: 900 }, { x: 760, y: 940 }], color: 'blue' }, 'sam');
      await nextFrame();
    });

    const line = fixture.objectEl(red.id)?.querySelector<SVGPathElement>('[data-testid="stroke-line"]');
    expect(line).not.toBeNull();
    expect(line?.getAttribute('stroke')).toBe(PEN_COLORS[red.color]);
    expect(line?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    // Round caps and round joins: the caps are what make a one-point stroke a dot rather than nothing, and a
    // join that mitres turns a slow hand at a corner into a spike.
    expect(line?.getAttribute('stroke-linecap')).toBe('round');
    expect(line?.getAttribute('stroke-linejoin')).toBe('round');
    // The points the object holds, smoothed into one path, in the box the path is drawn in.
    expect(line?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+/);
    expect(line?.getAttribute('fill')).toBe('none');

    const second = fixture.objects().filter(isStrokeSnapshot)[1] as StrokeSnapshot;
    const secondLine = fixture.objectEl(second.id)?.querySelector<SVGPathElement>('[data-testid="stroke-line"]');
    expect(secondLine?.getAttribute('stroke')).toBe(strokeColorOf('blue'));
    // A thickness nobody named is the middle pen, which is neither the first one nor the last.
    expect(second.thickness).toBe('medium');
    expect(secondLine?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
  });

  it('puts an invisible stroke over the line, as wide as the rule that selects it', () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture, CHEVRON, 'thin');
    const el = fixture.objectEl(stroke.id) as HTMLElement;
    const hit = el.querySelector<SVGPathElement>('[data-testid="stroke-hit"]');
    expect(hit).not.toBeNull();

    const zoom = renderedCamera().zoom;
    // Twice the radius, because a width is measured across and a radius from the middle — and the same number
    // the registry answers a click with, so that the line a person can catch is exactly the line the board
    // will select. The two cannot disagree, which is the property story 10's arrows rest on.
    expect(hit?.getAttribute('stroke-width')).toBe(String(strokeHitWidth(stroke, zoom)));
    expect(hit?.getAttribute('stroke-width')).toBe(
      String((STROKE_HIT_TOLERANCE_PX * 2) / zoom),
    );
    expect(hit?.getAttribute('stroke')).toBe('transparent');
    // `stroke` and not `all`: the inside of a curve is not the curve.
    expect(hit?.getAttribute('pointer-events')).toBe('stroke');
    // And the box around all of it is nothing at all to the pointer.
    expect(el.style.pointerEvents).toBe('none');
  });

  it('is moved by a drag of its line, and the whole line moves with it', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    const before = fixture.boundsOf(stroke.id);
    const points = scaledPoints(stroke);

    await clickLine(fixture, stroke.id);
    expect(fixture.selection().selectedId).toBe(stroke.id);
    await dragLine(fixture, stroke.id, onLine, { x: 90, y: 60 });

    const after = fixture.boundsOf(stroke.id);
    expect(after.x).toBeCloseTo(before.x + 90, 3);
    expect(after.y).toBeCloseTo(before.y + 60, 3);
    // The line moved with the box, rigidly and in proportion and no other way: what is written when a drawing
    // moves is two numbers, which is the whole reason a two-thousand-point sketch costs the same as a dot.
    const moved = scaledPoints(fixture.objects().find(isStrokeSnapshot) as StrokeSnapshot);
    expect(moved).toHaveLength(points.length);
    const dx = moved[0]!.x - points[0]!.x;
    const dy = moved[0]!.y - points[0]!.y;
    for (let index = 1; index < points.length; index += 1) {
      expect(moved[index]!.x - points[index]!.x).toBeCloseTo(dx, 6);
      expect(moved[index]!.y - points[index]!.y).toBeCloseTo(dy, 6);
    }
    // What was drawn is what is stored: the line was not re-sampled, re-simplified or re-smoothed by being
    // moved.
    expect(fixture.objects().find(isStrokeSnapshot)?.points).toEqual(stroke.points);
  });

  it('pans the board when the drag starts inside the box and not on the line', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    const camera = renderedCamera();
    const box = fixture.boundsOf(stroke.id);

    // The same drag as the test above, a hundred world units away from the line: the board takes it as a pan,
    // because that is what a drag on empty board is, and the drawing stays where it was.
    const from = fixture.screen(throughTheBox);
    pointer('pointerDown', board(), from);
    await actOn(nextFrame);
    pointer('pointerMove', board(), { x: from.x + 90, y: from.y + 40 });
    await actOn(nextFrame);
    pointer('pointerUp', board(), { x: from.x + 90, y: from.y + 40 });
    await actOn(nextFrame);

    expect(renderedCamera().x).not.toBe(camera.x);
    expect(fixture.boundsOf(stroke.id)).toEqual(box);
    expect(fixture.selection().size).toBe(0);
  });

  it('grows from its corner with its proportions kept and its pen unchanged', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    await clickLine(fixture, stroke.id);

    const box = fixture.boundsOf(stroke.id);
    const ratio = box.width / box.height;
    const ink = PEN_THICKNESS_WORLD[stroke.thickness];
    const corner = fixture.screen({ x: box.x + box.width, y: box.y + box.height });
    expect(fixture.handles()).toContain('se');

    await fixture.dragHandle('se', corner, { x: corner.x + 120, y: corner.y + 120 });

    const after = fixture.boundsOf(stroke.id);
    expect(after.width).toBeGreaterThan(box.width);
    expect(after.height).toBeGreaterThan(box.height);
    // Within one percent, which is what "kept" means once a pointer has travelled over a handle: the circle a
    // person drew stays a circle, and a drag that was mostly sideways is still a growth and not a squash.
    expect(Math.abs(after.width / after.height / ratio - 1)).toBeLessThan(0.01);

    // The pen is not part of the shape. A sketch enlarged is the same sketch drawn with the same pen: the
    // width of the ink does not follow the box, and the stored line is scaled where it lies rather than
    // rewritten, which is the only reason it cannot.
    const grown = fixture.objects().find(isStrokeSnapshot) as StrokeSnapshot;
    expect(grown.thickness).toBe(stroke.thickness);
    expect(grown.baseWidth).toBe(stroke.baseWidth);
    expect(grown.baseHeight).toBe(stroke.baseHeight);
    expect(grown.points).toEqual(stroke.points);
    const line = fixture.objectEl(grown.id)?.querySelector<SVGPathElement>('[data-testid="stroke-line"]');
    expect(line?.getAttribute('stroke-width')).toBe(String(ink));
    // And the line inside the grown box has grown with it, in the same ratio.
    const points = scaledPoints(grown);
    const drawn = scaledPoints(stroke);
    expect(points[2]!.x - points[0]!.x).toBeGreaterThan(drawn[2]!.x - drawn[0]!.x);
    expect((points[2]!.x - points[0]!.x) / (drawn[2]!.x - drawn[0]!.x)).toBeCloseTo(after.width / box.width, 3);
  });

  it('offers no text to edit, because its whole content is the line', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    await clickLine(fixture, stroke.id);

    // Double-clicked: on anything else on this board that means "type into me".
    const at = fixture.screen(onLine);
    await actOn(async () => {
      fireEvent.doubleClick(hitPath(stroke.id), at);
      await nextFrame();
    });

    expect(fixture.selection().selectedId).toBe(stroke.id);
    expect(fixture.selection().editingId).toBeNull();
    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('input[role="textbox"]')).toBeNull();
  });

  it('is a dot the size of its pen, and is clickable at its centre and not beyond', () => {
    const fixture = renderBoard();
    const dot = seedStroke(fixture, [{ x: 800, y: 700 }], 'thick');
    // A dot's box is the dot: as wide as the pen and no wider, and the round cap is the drawing.
    expect(dot.width).toBe(PEN_THICKNESS_WORLD.thick);
    expect(dot.height).toBe(PEN_THICKNESS_WORLD.thick);
    expect(scaledPoints(dot)).toEqual([{ x: 800, y: 700 }]);
    const el = fixture.objectEl(dot.id);
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-color')).toBe('black');

    expect(hitTestObject(dot, { x: 800, y: 700 }, contextAt(1))).toBe(true);
    expect(hitTestObject(dot, { x: 820, y: 700 }, contextAt(1))).toBe(false);
    expect(fixture.objects().length).toBe(1);
  });

  it('is listed, and draws nothing, when the line it holds is unusable', async () => {
    const fixture = renderBoard();
    // A stroke from a client that wrote a line with nothing in it, or with half a pair on the end. The board
    // must not take itself down over a drawing it cannot draw, and must not lose the object either: the
    // document says it is there, and only the document gets to say what is on the board.
    await fixture.seedObject('empty-line', {
      type: 'stroke',
      x: 700,
      y: 600,
      width: 100,
      height: 100,
      z: 3,
      createdAt: 1,
      points: [],
      baseWidth: 100,
      baseHeight: 100,
      color: 'black',
      thickness: 'medium',
    });
    await fixture.seedObject('half-a-pair', {
      type: 'stroke',
      x: 900,
      y: 600,
      width: 100,
      height: 100,
      z: 4,
      createdAt: 1,
      points: [10, 10, 60, 70, 90],
      baseWidth: 100,
      baseHeight: 100,
      color: 'chartreuse',
      thickness: 'extra-fine',
    });

    const listed = fixture.objects().filter(isStrokeSnapshot);
    expect(listed).toHaveLength(2);
    // Both are elements, neither throws, and the one with a truncated pair draws the points it can read and
    // leaves the half of one that has no partner.
    expect(fixture.objectEl('empty-line')).not.toBeNull();
    expect(fixture.objectEl('half-a-pair')).not.toBeNull();
    expect(scaledPoints(listed[0] as StrokeSnapshot)).toHaveLength(0);
    expect(scaledPoints(listed[1] as StrokeSnapshot)).toHaveLength(2);
    // A colour and a thickness this build has no name for are drawn as the defaults rather than dropped: a
    // stroke that arrived from a newer client is not this client's to break.
    const drawn = fixture.objectEl('half-a-pair')?.querySelector<SVGPathElement>('[data-testid="stroke-line"]');
    expect(drawn?.getAttribute('stroke')).toBe(PEN_COLORS.black);
    expect(drawn?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    // Nothing to catch a pointer with: a drawing with no line is selected by the marquee and left by a click.
    expect(hitTestObject(listed[0] as StrokeSnapshot, { x: 750, y: 650 }, contextAt(1))).toBe(false);
    expect(hitTestObject(listed[0] as StrokeSnapshot, { x: 750, y: 650 })).toBe(true);
    expect(screen.getAllByTestId('stroke-object')).toHaveLength(2);
  });

  it('holds the line once, in its own box, with the two choices it was drawn with', () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    // The four numbers every object has, the box the line was drawn into, and the line measured from that
    // box's corner — which is what makes moving a drawing two numbers rather than six.
    expect(stroke.type).toBe('stroke');
    expect(stroke.baseWidth).toBeCloseTo(400 + PEN_THICKNESS_WORLD.medium, 6);
    expect(stroke.baseHeight).toBeCloseTo(200 + PEN_THICKNESS_WORLD.medium, 6);
    expect(stroke.points).toHaveLength(CHEVRON.length * 2);
    expect(stroke.points.slice(0, 2)).toEqual([CHEVRON[0]!.x - stroke.x, CHEVRON[0]!.y - stroke.y]);
    expect(scaledPoints(stroke).map((point) => Math.round(point.x))).toEqual(CHEVRON.map((point) => point.x));
    // The padding is half the ink on every side, so nothing of the drawing is outside the box it is in.
    expect(stroke.x).toBeCloseTo(700 - PEN_THICKNESS_WORLD.medium / 2, 6);
    // It is the top of the stack: a drawing goes over what it was drawn round.
    expect(stroke.z).toBe(1);
  });

  it('is enclosed by a marquee drawn round its box, and not by one that only crosses its line', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    const box = fixture.boundsOf(stroke.id);

    // A marquee encloses a drawing by its box, like every other object on the board: it is the honest answer
    // to "what is inside this rectangle", and the line rule is for clicks, which are about a pointer and not
    // about a rectangle. This is the same rule an arrow follows, and for the same reason — the person who
    // draws a big rectangle means to pick up everything inside it.
    await fixture.selectByMarquee(
      fixture.screen({ x: box.x - 20, y: box.y - 20 }),
      fixture.screen({ x: box.x + box.width + 20, y: box.y + box.height + 20 }),
    );
    expect(fixture.selection().ids.has(stroke.id)).toBe(true);

    // And a rectangle that crosses the line but reaches nowhere near the box takes nothing: the drawing's
    // box is 400 units wide and the rectangle is 20, so the drawing is not in it — which is what makes a
    // marquee a rectangle and not a lasso.
    await actOn(async () => {
      fixture.handle.current!.selection.clear();
      await nextFrame();
    });
    const leg = fixture.screen({ x: 790, y: 690 });
    await fixture.selectByMarquee({ x: leg.x - 10, y: leg.y - 10 }, { x: leg.x + 10, y: leg.y + 10 });
    expect(fixture.selection().ids.has(stroke.id)).toBe(false);
  });

  it('is deleted by the Delete key like any other object, in one step of the history', async () => {
    const fixture = renderBoard();
    const stroke = seedStroke(fixture);
    await clickLine(fixture, stroke.id);
    expect(fixture.selection().selectedId).toBe(stroke.id);

    await actOn(async () => {
      fireEvent.keyDown(window, { key: 'Delete' });
      await nextFrame();
    });
    expect(fixture.objects().length).toBe(0);
    expect(fixture.selection().size).toBe(0);

    // One thing a person did is one thing to take back: the drawing and its deletion are each a step, and
    // neither is made of the pointer events that made them.
    await actOn(async () => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
      await nextFrame();
    });
    expect(fixture.objects().length).toBe(1);
    expect(fixture.objects().find(isStrokeSnapshot)?.id).toBe(stroke.id);
  });
});
