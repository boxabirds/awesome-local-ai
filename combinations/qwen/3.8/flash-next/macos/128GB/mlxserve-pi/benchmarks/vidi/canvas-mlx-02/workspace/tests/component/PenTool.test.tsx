// Story 11, pen.tool and stroke.object (component): a drag with the Pen open becomes
// one stroke, an interrupted drag keeps what it drew, a stroke draws the path its box
// has become, and only the line itself is clickable.
//
// Everything here runs in the REAL board - the real toolbar, the real tool surface
// mounted inside the real viewport, the real registry, the real selection - so what is
// asserted is what a person gets, not what a component does in isolation. The board
// opens its camera centred on the world origin, so a pointer position is always taken
// through the harness's toScreen, which reads the live camera off the world layer:
// these tests name the WORLD point a pen was pressed at, which is the thing worth
// asserting about a drawing.
//
// TC-09 to TC-16 and TC-21 of the design.
import { describe, it, expect } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import type * as Y from 'yjs';
import { renderBoard7, seedSticky, settle } from './story7TestUtils.tsx';
import {
  deleteObjects,
  objectsSnapshot,
  resizeObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import {
  createStroke,
  isStrokeSnapshot,
  scaledPoints,
  type StrokeSnapshot,
} from '../../src/shared/objects/stroke.ts';
import { getObjectType } from '../../src/client/objects/registry.tsx';
import { distanceToPolyline } from '../../src/shared/geometry/polyline.ts';
import {
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  STROKE_MIN_SIZE_WORLD,
} from '../../src/shared/config.ts';
import type { PenColor, PenThickness } from '../../src/shared/config.ts';
import type { Point } from '../../src/shared/geometry.ts';
import { HANDWRITTEN_LOOP, SPIRAL_5010, UNDERLINE } from '../fixtures/pen-paths.ts';

type Harness = ReturnType<typeof renderBoard7>;

const pressed = (el: HTMLElement): boolean => el.getAttribute('aria-pressed') === 'true';
const penButton = (): HTMLElement => screen.getByTestId('tool-pen');
const selectButton = (): HTMLElement => screen.getByTestId('tool-select');
const surface = (): HTMLElement => screen.getByTestId('pen-tool');
const previewPath = (): SVGPathElement => screen.getByTestId('pen-preview-path') as unknown as SVGPathElement;
/** The element a click on the DRAWING lands on: the band drawn under the line. */
const lineOf = (id: string): HTMLElement => screen.getByTestId(`stroke-hit-${id}`) as unknown as HTMLElement;

/** Pointer event options AT A WORLD POINT - the board converts, as it does for real. */
const at = (h: Harness, x: number, y: number, pointerId = 31) => {
  const p = h.toScreen({ x, y });
  return { clientX: p.x, clientY: p.y, button: 0, pointerId, bubbles: true, cancelable: true };
};

function strokeOf(doc: Y.Doc, id: string): StrokeSnapshot {
  const obj = objectsSnapshot(doc).find((o) => o.id === id);
  if (!obj || !isStrokeSnapshot(obj)) throw new Error(`stroke ${id} is not on the board`);
  return obj;
}

/** Everything the board has that it did not have before. */
function createdSince(h: Harness, before: ReadonlySet<string>): ObjectSnapshot[] {
  return objectsSnapshot(h.doc()).filter((o) => !before.has(o.id));
}

/** The most a point of `raw` is away from the polyline `path`. */
function maxDistance(path: readonly Point[], raw: readonly Point[]): number {
  let max = 0;
  for (const p of raw) max = Math.max(max, distanceToPolyline(path, p));
  return max;
}

/**
 * A pen stroke, drawn the way a hand draws one: press on the pen's own surface, move
 * through every point, lift. The moves go to the surface because the surface is what
 * holds the pointer - which is the whole design of the tool.
 */
function drawPath(h: Harness, points: readonly Point[], pointerId = 31): void {
  const el = surface();
  fireEvent.pointerDown(el, at(h, points[0].x, points[0].y, pointerId));
  for (let i = 1; i < points.length; i++) {
    fireEvent.pointerMove(el, at(h, points[i].x, points[i].y, pointerId));
  }
  const last = points[points.length - 1];
  fireEvent.pointerUp(el, at(h, last.x, last.y, pointerId));
}

/** A stroke that already exists, put on the board through the model. */
function seedStroke(
  doc: Y.Doc,
  points: readonly Point[],
  opts: { color?: PenColor; thickness?: PenThickness; createdBy?: string } = {},
): string {
  let id = '';
  act(() => {
    id = createStroke(
      doc,
      { points, color: opts.color ?? 'black', thickness: opts.thickness ?? 'medium' },
      opts.createdBy ?? 'tester',
    )!;
  });
  return id;
}

describe('pen.tool / stroke.object (component)', () => {
  // TC-09: the pen is a tool you stay in. Red and thick are chosen, a line is drawn,
  // and exactly one stroke arrives wearing them - and the tool never steps aside.
  it('TC-09 draws with the colour and weight that were picked, and stays the pen', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    expect(pressed(penButton())).toBe(true);
    expect(pressed(selectButton())).toBe(false);
    // The pen's two settings are open for exactly as long as the pen is.
    expect(screen.getByTestId('pen-toolbar')).toBeTruthy();
    expect(screen.queryByTestId('shape-tool')).toBeNull();
    expect(screen.getAllByRole('button', { name: / pen$/ })).toHaveLength(6);

    fireEvent.click(screen.getByLabelText('red pen'));
    fireEvent.click(screen.getByLabelText('Thick'));
    expect(pressed(screen.getByLabelText('red pen'))).toBe(true);
    expect(pressed(screen.getByLabelText('black pen'))).toBe(false);
    expect(pressed(screen.getByLabelText('Thick'))).toBe(true);
    expect(pressed(screen.getByLabelText('Medium'))).toBe(false);

    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    drawPath(h, UNDERLINE);
    await settle();

    const made = createdSince(h, before);
    expect(made).toHaveLength(1); // one stroke for one drag, not one per frame
    const stroke = made[0] as StrokeSnapshot;
    expect(stroke.type).toBe('stroke');
    expect(stroke.color).toBe('red');
    expect(stroke.thickness).toBe('thick');
    // What arrived is the drawing with the hand-shake taken out of it: the same path,
    // fewer points, and a box as big as the line it holds.
    expect(stroke.points.length / 2).toBeLessThan(UNDERLINE.length);
    expect(stroke.x).toBeCloseTo(UNDERLINE[0].x - PEN_THICKNESS_WORLD.thick / 2, 1);
    expect(stroke.width! / stroke.baseWidth).toBeCloseTo(1, 6);
    expect(stroke.baseHeight).toBeGreaterThan(0);
    expect(maxDistance(scaledPoints(stroke), UNDERLINE)).toBeLessThanOrEqual(1);

    // The pen is still the tool, and the stroke that was just drawn is NOT selected:
    // a person drawing a line is about to draw the next one (pen.tool).
    expect(pressed(penButton())).toBe(true);
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    expect(h.selectedIds()).toEqual([]);
    // The preview went away with the drag that made it.
    expect(screen.queryByTestId('pen-preview')).toBeNull();
  });

  // The preview is what makes a pen feel like a pen: it is there while the pointer
  // moves, it follows the pointer, and it never reaches the document (pen.share).
  it('shows the line while it is being drawn and writes nothing until the pen lifts', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    const el = surface();
    fireEvent.pointerDown(el, at(h, 100, 100));
    expect(screen.getByTestId('pen-preview')).toBeTruthy();
    const d0 = previewPath().getAttribute('d');
    await h.frames(1);
    fireEvent.pointerMove(el, at(h, 200, 160));
    await h.frames(1);
    const d1 = previewPath().getAttribute('d');
    expect(d1).not.toBe(d0); // the line follows the pointer, frame by frame
    // ...and none of it is in the document, so nobody else is watching a drawing arrive
    // point by point.
    expect(objectsSnapshot(h.doc()).filter((o) => !before.has(o.id))).toHaveLength(0);

    fireEvent.pointerUp(el, at(h, 260, 120));
    await settle();
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(createdSince(h, before)).toHaveLength(1);
  });

  // TC-10: a press that never moved is a dot - an object with a box of its own, not a
  // mark nobody can find again.
  it('TC-10 makes a press that never moved into a dot', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    const el = surface();
    fireEvent.pointerDown(el, at(h, 400, 300, 32));
    fireEvent.pointerMove(el, at(h, 401, 301, 32)); // under the drag threshold: still a press
    fireEvent.pointerUp(el, at(h, 401, 301, 32));
    await settle();

    const made = createdSince(h, before);
    expect(made).toHaveLength(1);
    const dot = made[0] as StrokeSnapshot;
    expect(isStrokeSnapshot(dot)).toBe(true);
    expect(dot.points.length).toBe(2); // one point, flat
    // A dot is as big as the pen is thick, so it is selectable and resizable.
    expect(dot.width).toBe(PEN_THICKNESS_WORLD.medium);
    expect(dot.height).toBe(PEN_THICKNESS_WORLD.medium);
    expect(dot.x + dot.width! / 2).toBeCloseTo(400, 3);
    expect(dot.y + dot.height! / 2).toBeCloseTo(300, 3);
    expect(h.object(dot.id)?.getAttribute('aria-label')).toBe('Drawing');
  });

  // TC-11: an interrupted drag keeps its drawing. A stroke a person spent a second
  // drawing is not thrown away because the browser took the pointer away.
  it('TC-11 keeps the stroke drawn so far when the drag is cancelled', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    const el = surface();
    fireEvent.pointerDown(el, at(h, HANDWRITTEN_LOOP[0].x, HANDWRITTEN_LOOP[0].y));
    for (let i = 1; i < 120; i++) {
      fireEvent.pointerMove(el, at(h, HANDWRITTEN_LOOP[i].x, HANDWRITTEN_LOOP[i].y));
    }
    fireEvent.pointerCancel(el, { pointerId: 31, bubbles: true, cancelable: true });
    await settle();

    const made = createdSince(h, before) as StrokeSnapshot[];
    expect(made).toHaveLength(1);
    // What it kept is the 120 points that had been recorded, smoothed - not the 400
    // the test would have drawn, and not nothing.
    const pts = scaledPoints(made[0]);
    expect(pts.length).toBeLessThan(120);
    expect(pts.length).toBeGreaterThan(2);
    expect(pts[0].x).toBeCloseTo(HANDWRITTEN_LOOP[0].x, 0);
    expect(pts[pts.length - 1].x).toBeCloseTo(HANDWRITTEN_LOOP[119].x, 0);
    expect(made[0].color).toBe('black');

    // The pen is still open and the pointer is free again: the next drag draws too.
    expect(pressed(penButton())).toBe(true);
    const next = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    drawPath(h, UNDERLINE, 32);
    await settle();
    expect(createdSince(h, next)).toHaveLength(1);
  });

  // A lost pointer capture is the same interruption by another name: the browser says
  // "somebody else has the pointer now", not "this drawing was abandoned".
  it('TC-11b finishes the stroke when pointer capture is lost', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    const el = surface();
    fireEvent.pointerDown(el, at(h, 60, 60, 33));
    fireEvent.pointerMove(el, at(h, 160, 120, 33));
    fireEvent.pointerMove(el, at(h, 240, 200, 33));
    fireEvent.lostPointerCapture(el, { pointerId: 33, bubbles: true, cancelable: true });
    await settle();

    const made = createdSince(h, before) as StrokeSnapshot[];
    expect(made).toHaveLength(1);
    expect(scaledPoints(made[0])).toHaveLength(3); // the whole recording, kept
  });

  // TC-12: the point limit splits a very long drag into strokes that join up, instead
  // of letting one drawing grow past what one object may hold.
  it('TC-12 splits a drag longer than one stroke may hold, with no gap at the join', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    const el = surface();
    fireEvent.pointerDown(el, at(h, SPIRAL_5010[0].x, SPIRAL_5010[0].y, 34));
    for (let i = 1; i < SPIRAL_5010.length; i++) {
      fireEvent.pointerMove(el, at(h, SPIRAL_5010[i].x, SPIRAL_5010[i].y, 34));
    }
    const end = SPIRAL_5010[SPIRAL_5010.length - 1];
    fireEvent.pointerUp(el, at(h, end.x, end.y, 34));
    await settle();

    const made = createdSince(h, before) as StrokeSnapshot[];
    expect(made).toHaveLength(2); // one stroke filled up, one for what came after
    // The long one is the part that was put down first.
    const first = made[0].points.length > made[1].points.length ? made[0] : made[1];
    const second = first === made[0] ? made[1] : made[0];
    const firstPoints = scaledPoints(first);
    const secondPoints = scaledPoints(second);
    expect(firstPoints.length).toBeLessThanOrEqual(STROKE_MAX_POINTS);

    // The boundary the design names: the next stroke begins ON the point the previous
    // one ended on, so what was drawn is one unbroken line.
    expect(secondPoints[0].x).toBeCloseTo(firstPoints[firstPoints.length - 1].x, 1);
    expect(secondPoints[0].y).toBeCloseTo(firstPoints[firstPoints.length - 1].y, 1);

    // And nothing between the two strokes went missing: every point of the drawing is
    // on the board within the tolerance the split was drawn at.
    expect(maxDistance([...firstPoints, ...secondPoints], SPIRAL_5010)).toBeLessThanOrEqual(2);
  });

  // TC-13: Escape gives the pen back, and V does too. A tool that was left open must
  // not be able to draw one more thing afterwards.
  it('TC-13 leaves the pen on Escape and on V, drawing nothing on the way out', async () => {
    const h = renderBoard7();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));

    h.key('p');
    await settle();
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    h.key('Escape');
    await settle();
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByTestId('pen-toolbar')).toBeNull(); // the settings are the pen's too
    expect(pressed(selectButton())).toBe(true);

    h.key('p');
    await settle();
    expect(screen.getByTestId('pen-tool')).toBeTruthy();
    h.key('v');
    await settle();
    expect(pressed(selectButton())).toBe(true);
    expect(pressed(penButton())).toBe(false);
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    // Escape and V give up the tool and are never a stroke: nothing was drawn on the
    // way out of it.
    expect(createdSince(h, before)).toHaveLength(0);

    // And the board is back to its normal self: a double-click creates a note again.
    const notesBefore = h.notes().length;
    fireEvent.doubleClick(screen.getByTestId('viewport'), { clientX: 700, clientY: 500, bubbles: true, cancelable: true });
    await settle();
    expect(h.notes()).toHaveLength(notesBefore + 1);
  });

  // TC-14: the pen's settings are the pen's, not the drawings'. Choosing a different
  // colour cannot repaint what was already drawn - a stroke keeps the colour it was
  // drawn with, forever.
  it('TC-14 leaves the strokes already drawn alone when the colour changes', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();

    drawPath(h, UNDERLINE);
    await settle();
    const drawn = objectsSnapshot(h.doc()).filter((o) => o.type === 'stroke') as StrokeSnapshot[];
    expect(drawn).toHaveLength(1);
    const first = drawn[0];
    expect(first.color).toBe('black');

    fireEvent.click(screen.getByLabelText('blue pen'));
    await settle();

    const untouched = strokeOf(h.doc(), first.id);
    expect(untouched.color).toBe('black'); // the drawing did not change colour
    expect(untouched.x).toBe(first.x);
    expect(untouched.thickness).toBe(first.thickness);

    const seen = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    drawPath(h, UNDERLINE, 35);
    await settle();
    const next = createdSince(h, seen)[0] as StrokeSnapshot;
    expect(next.color).toBe('blue'); // the next line is drawn with the new pen

    // A pen that was merely re-chosen wrote nothing, so there was nothing to undo -
    // the step back belongs to the drawing before it.
    h.key('z', { ctrlKey: true });
    await settle();
    expect(objectsSnapshot(h.doc()).some((o) => o.id === next.id)).toBe(false);
    expect(objectsSnapshot(h.doc()).some((o) => o.id === first.id)).toBe(true);
  });

  // TC-15: the line's hit test is a SCREEN tolerance, so a stroke is exactly as easy
  // to click at 50% as at 200% - and it is the same tolerance the drawn clickable band
  // is as wide as, which is what makes "near the drawing" mean one thing.
  it('TC-15 hit-tests the line at a screen tolerance at any zoom', async () => {
    const h = renderBoard7();
    const line: Point[] = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 500, y: 100 },
    ];
    const id = seedStroke(h.doc(), line, { thickness: 'thin' });
    const stroke = strokeOf(h.doc(), id);
    const spec = getObjectType('stroke');
    if (!spec) throw new Error('the stroke type is not registered');
    // The line is at y = 100 - and the hit test's world units are screen pixels
    // divided by the zoom, which is what the two loops below are about.
    expect(scaledPoints(stroke)[1].y).toBeCloseTo(100, 6);

    // 5 px of screen is on it, 7 px is off it, at both zooms: the boundary the
    // requirement names, walked from both sides.
    for (const zoom of [0.5, 2]) {
      expect(spec.hitTest(stroke, { x: 300, y: 100 + 5 / zoom }, { zoom })).toBe(true);
      expect(spec.hitTest(stroke, { x: 300, y: 100 + 7 / zoom }, { zoom })).toBe(false);
    }

    // A line thicker than the tolerance is hit by half its own weight instead: a fat
    // stroke is not harder to click than a thin one.
    const fat = strokeOf(h.doc(), seedStroke(h.doc(), line, { thickness: 'thick' }));
    const half = PEN_THICKNESS_WORLD.thick / 2;
    expect(spec.hitTest(fat, { x: 300, y: 100 + half - 0.01 }, { zoom: 4 })).toBe(true);
    expect(spec.hitTest(fat, { x: 300, y: 100 + half + 0.01 }, { zoom: 4 })).toBe(false);

    // A point nowhere near the line but inside its box misses (the box is not the
    // drawing), and a stroke this build cannot read hits nothing at all.
    expect(spec.hitTest(stroke, { x: 100, y: 140 }, { zoom: 1 })).toBe(false);
    expect(spec.hitTest({ ...stroke, points: [] }, { x: 300, y: 100 }, { zoom: 1 })).toBe(false);
    expect(spec.hitTest({ ...stroke, type: 'sticky' }, { x: 300, y: 100 }, { zoom: 1 })).toBe(false);

    // What is drawn clickable IS what is hit: the band under the line is twice this
    // zoom's tolerance wide, and it - not the box - is what takes the click.
    await settle();
    expect(Number(lineOf(id).getAttribute('stroke-width'))).toBeCloseTo(
      (2 * STROKE_HIT_TOLERANCE_PX) / h.cam().zoom,
      3,
    );
    expect(lineOf(id).style.pointerEvents).toBe('stroke');
    expect(screen.getByTestId(`stroke-${id}`).style.pointerEvents).toBe('none');
  });

  // A stroke resized by the generic machinery still hit-tests the line it became,
  // because the hit test asks the same question the component draws the answer to.
  it('hit-tests the drawing at the size its box has become', async () => {
    const h = renderBoard7();
    const id = seedStroke(h.doc(), [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const stroke = strokeOf(h.doc(), id);
    const spec = getObjectType('stroke')!;
    expect(spec.resizable).toBe(true);
    expect(spec.aspectLocked).toBe(true);
    expect(spec.minSize).toBe(STROKE_MIN_SIZE_WORLD);
    expect(spec.editableText).toBe(false);

    // Twice as wide, twenty times as tall: the box grew, so the line is elsewhere -
    // the drawing follows the box, it does not stay where it was.
    act(() => {
      resizeObjects(h.doc(), new Map([[id, { x: stroke.x, y: stroke.y, width: stroke.width! * 2, height: stroke.height! * 20 }]]));
    });
    await settle();
    const grown = strokeOf(h.doc(), id);
    const points = scaledPoints(grown);
    expect(points[1].y).not.toBeCloseTo(100, 0);
    // Where the line used to be is off it now; where it now is, is on it.
    expect(spec.hitTest(grown, { x: 150, y: 100 }, { zoom: 1 })).toBe(false);
    expect(spec.hitTest(grown, points[0], { zoom: 1 })).toBe(true);
    expect(spec.hitTest(grown, { x: points[0].x, y: points[0].y - 20 }, { zoom: 1 })).toBe(false);
    // The line's own weight never scaled with the picture.
    expect(grown.thickness).toBe('medium');
    expect(Number(screen.getByTestId(`stroke-path-${id}`).getAttribute('stroke-width'))).toBe(
      PEN_THICKNESS_WORLD.medium,
    );
    expect(screen.getByTestId(`stroke-${id}`).getAttribute('data-thickness')).toBe('medium');
  });

  // TC-16: a sketch laid across a note never steals that note's clicks. The box is
  // mostly empty space and takes none of them; only the line takes any.
  it('TC-16 lets a click inside a stroke box but far from its line reach the note underneath', async () => {
    const h = renderBoard7();
    const note = seedSticky(h.doc(), { x: 0, y: 0 });
    // A stroke drawn across the note, corner to corner, so most of its box is nowhere
    // near the line.
    const id = seedStroke(h.doc(), [
      { x: 20, y: 20 },
      { x: 180, y: 180 },
    ]);
    const stroke = strokeOf(h.doc(), id);
    const spec = getObjectType('stroke')!;

    // The far corner of the box is a click on the note as far as the board is
    // concerned: inside the box, further from the line than the tolerance.
    const far = { x: stroke.x + stroke.width! - 1, y: stroke.y + 1 };
    expect(far.x).toBeLessThanOrEqual(stroke.x + stroke.width!);
    expect(spec.hitTest(stroke, far, { zoom: 1 })).toBe(false);
    // A point on the line is the opposite, in the very same box.
    expect(spec.hitTest(stroke, { x: 100, y: 100 }, { zoom: 1 })).toBe(true);

    // So a click there selects the note, and the drawing stays unselected.
    fireEvent.pointerDown(h.object(note)!, at(h, far.x, far.y, 36));
    await settle();
    expect(h.selectedIds()).toEqual([note]);
    expect(screen.getByTestId(`stroke-${id}`).getAttribute('data-selected')).toBe('false');

    // And a click on the line selects the drawing, which is the other half of the same
    // rule: a sketch is an object, not a decoration.
    fireEvent.pointerDown(lineOf(id), at(h, 100, 100, 37));
    await settle();
    expect(h.selectedIds()).toEqual([id]);
    expect(screen.getByTestId(`stroke-selection-${id}`)).toBeTruthy();
  });

  // TC-21: a stroke taken out from under the selection leaves nothing behind - not a
  // phantom outline, not a stuck selection, not an exception.
  it('TC-21 clears the selection when a selected stroke is deleted from under it', async () => {
    const h = renderBoard7();
    const id = seedStroke(h.doc(), UNDERLINE);
    await settle();

    fireEvent.pointerDown(lineOf(id), at(h, 120, 300, 38));
    await settle();
    expect(h.selectedIds()).toEqual([id]);
    expect(screen.getByTestId(`stroke-selection-${id}`)).toBeTruthy(); // wearing its selection
    expect(h.outline(id)).toBeTruthy();

    act(() => {
      deleteObjects(h.doc(), [id]); // somebody else tidied it away
    });
    await settle();

    expect(screen.queryByTestId(`stroke-${id}`)).toBeNull();
    expect(h.selected()).toHaveLength(0);
    expect(h.outline(id)).toBeNull(); // no outline left behind for an object that is gone
    // The board is still there and still drawing afterwards.
    h.key('p');
    await settle();
    const before = new Set(objectsSnapshot(h.doc()).map((o) => o.id));
    drawPath(h, HANDWRITTEN_LOOP, 39);
    await settle();
    expect(createdSince(h, before)).toHaveLength(1);
  });

  // The point of the object being an object: story 7's machinery acts on a drawing
  // exactly as it acts on a note, and a drawing is one undoable step.
  it('is moved by the generic gesture and undone as one step', async () => {
    const h = renderBoard7();
    h.key('p');
    await settle();
    drawPath(h, UNDERLINE);
    await settle();
    const stroke = (objectsSnapshot(h.doc()).filter((o) => o.type === 'stroke') as StrokeSnapshot[])[0];
    h.key('v');
    await settle();

    // Select it by its line, then drag the line: the generic move gesture writes the box.
    const grab = { x: 120, y: 300 };
    const put = { x: 220, y: 400 };
    fireEvent.pointerDown(lineOf(stroke.id), at(h, grab.x, grab.y, 41));
    await settle();
    expect(h.selectedIds()).toEqual([stroke.id]);
    const from = h.toScreen(grab);
    const to = h.toScreen(put);
    h.drag(lineOf(stroke.id), from, to, { pointerId: 41 });
    await settle();

    const zoom = h.cam().zoom;
    const moved = strokeOf(h.doc(), stroke.id);
    expect(moved.x).toBeCloseTo(stroke.x + (to.x - from.x) / zoom, 1);
    expect(moved.y).toBeCloseTo(stroke.y + (to.y - from.y) / zoom, 1);
    expect(moved.points).toEqual(stroke.points); // the drawing itself was never rewritten
    expect(moved.width).toBe(stroke.width); // moving never resizes

    // One undo step takes the whole move and nothing else; one more takes the stroke.
    h.key('z', { ctrlKey: true });
    await settle();
    expect(strokeOf(h.doc(), stroke.id).x).toBeCloseTo(stroke.x, 1);
    h.key('z', { ctrlKey: true });
    await settle();
    expect(objectsSnapshot(h.doc()).some((o) => o.id === stroke.id)).toBe(false);
  });
});
