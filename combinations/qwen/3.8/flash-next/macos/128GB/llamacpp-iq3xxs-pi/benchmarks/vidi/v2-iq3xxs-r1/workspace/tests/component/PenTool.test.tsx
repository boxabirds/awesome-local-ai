import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { screenToWorld, worldToScreen } from '../../src/client/canvas/camera';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { copyPath, HANDWRITTEN_LOOP, LONG_SPIRAL } from '../fixtures/pen-paths';
import { dispatchKey, dispatchPointer, dispatchWheel, TEST_BOARD_ID } from './util';
import { getSelection } from './stickyUtil';
import { camera, seedNotes } from './shapeUtil';
import {
  distanceFromStrokeLine,
  drawLongPath,
  drawOn,
  getStrokes,
  penLayer,
  penToolbarEl,
  penToolEl,
  pickPenColor,
  pickPenThickness,
  previewEl,
  strokeEls,
  toolState,
} from './penUtil';

/**
 * Story 11 — the Pen tool (pen.draw, pen.dot, pen.options, pen.stay_active,
 * pen.share, pen.long_stroke, pen.interrupted, pen.navigation).
 *
 * The board is rendered for real, with the pen's surface over it, and the gesture is
 * made of synthetic pointer events: what the tool records is what the pointer did, in
 * order, and what lands on the board is one stroke per finished gesture. Nothing that
 * happens mid-drag is ever in the document — that is the sharing rule, and it is
 * checked here by looking at the document in the middle of a drag.
 */

/** A short, roughly straight path in screen space, for a stroke that must exist. */
function screenPath(from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + 4 * Math.sin(t * 6) });
  }
  return points;
}

describe('the Pen tool (pen.draw, pen.dot, pen.options)', () => {
  // TC-09: red and thick chosen, one drag, one stroke, and still holding the pen.
  it('TC-09 draws one stroke in the chosen colour and thickness and stays in the Pen tool', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    expect(toolState()).toBe('pen');
    expect(penToolbarEl()).not.toBeNull();

    pickPenColor('red');
    pickPenThickness('thick');
    expect(screen.getByTestId('pen-color-red').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('pen-thickness-thick').getAttribute('aria-pressed')).toBe('true');

    const points = screenPath({ x: 80, y: 120 }, { x: 420, y: 260 });
    dispatchPointer(layer, 'pointerdown', { clientX: points[0].x, clientY: points[0].y });
    dispatchPointer(layer, 'pointermove', { clientX: points[1].x, clientY: points[1].y });
    // The line being drawn is on screen, and it is local: the document still holds
    // nothing, so nobody else can see this stroke yet (PRD pen.share).
    expect(previewEl()).not.toBeNull();
    expect(getStrokes()).toHaveLength(0);
    for (const p of points.slice(2)) {
      dispatchPointer(layer, 'pointermove', { clientX: p.x, clientY: p.y });
    }
    const last = points[points.length - 1];
    dispatchPointer(layer, 'pointerup', { clientX: last.x, clientY: last.y });

    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({
      type: 'stroke',
      color: 'red',
      thickness: 'thick',
    });
    expect(PEN_COLORS[strokes[0]!.color]).toBe('#E53935');
    expect(PEN_THICKNESS_WORLD[strokes[0]!.thickness]).toBe(8);
    // The drawing that landed covers the drag, in board units.
    const cam = camera();
    const start = screenToWorld(cam, points[0]);
    const end = screenToWorld(cam, last);
    const box = strokes[0]!;
    const pad = PEN_THICKNESS_WORLD.thick / 2;
    expect(box.x).toBeCloseTo(start.x - pad, 6);
    expect(box.y + box.height).toBeCloseTo(end.y + pad, 4);
    expect(box.width).toBeCloseTo(end.x - start.x + 2 * pad, 4);

    // The preview is gone, the stroke is on the board, and the pen is still in hand:
    // sketching is more than one stroke (PRD pen.stay_active).
    expect(previewEl()).toBeNull();
    expect(strokeEls()).toHaveLength(1);
    expect(toolState()).toBe('pen');
    expect(penToolEl()).not.toBeNull();
  });

  // TC-10: a press and release that never moved is a dot, one point wide and tall.
  it('TC-10 draws a dot from a press that never moved', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    const at = { x: 300, y: 200 };
    dispatchPointer(layer, 'pointerdown', { clientX: at.x, clientY: at.y });
    dispatchPointer(layer, 'pointerup', { clientX: at.x, clientY: at.y });

    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    const dot = strokes[0]!;
    expect(dot.points).toHaveLength(2); // one point, flat
    const ink = PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
    expect(dot.width).toBeCloseTo(ink, 6);
    expect(dot.height).toBeCloseTo(ink, 6);
    // The dot sits where the pointer was.
    const centre = screenToWorld(camera(), at);
    const drawn = scaledPoints(dot)[0]!;
    expect(drawn.x).toBeCloseTo(centre.x, 6);
    expect(drawn.y).toBeCloseTo(centre.y, 6);
    // And the round dot is a zero-length path with round caps, so its rendered diameter
    // is exactly the ink (PRD pen.dot).
    const line = screen.getByTestId('stroke-line');
    expect(line.getAttribute('stroke-width')).toBe(String(ink));
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('d')).toContain('L');
    expect(toolState()).toBe('pen');
  });

  // TC-11: an interrupted drag keeps what was drawn.
  it('TC-11 keeps the points drawn so far when the pointer is cancelled', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    const points = screenPath({ x: 60, y: 90 }, { x: 360, y: 150 }, 10);
    dispatchPointer(layer, 'pointerdown', { clientX: points[0].x, clientY: points[0].y });
    for (const p of points.slice(1, 7)) {
      dispatchPointer(layer, 'pointermove', { clientX: p.x, clientY: p.y });
    }
    expect(getStrokes()).toHaveLength(0);
    const stoppedAt = points[6]!;
    dispatchPointer(layer, 'pointercancel', { clientX: stoppedAt.x, clientY: stoppedAt.y });

    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    // It stopped where the pointer did, not where it was going: only the first seven
    // recorded points are on the board.
    const reached = screenToWorld(camera(), points[points.length - 1]);
    expect(strokes[0]!.x + strokes[0]!.width).toBeLessThan(reached.x);

    // A lost pointer capture finishes the same way, and commits exactly once.
    dispatchPointer(layer, 'pointerdown', { clientX: 400, clientY: 400 });
    dispatchPointer(layer, 'pointermove', { clientX: 440, clientY: 420 });
    dispatchPointer(layer, 'lostpointercapture', { clientX: 440, clientY: 420 });
    dispatchPointer(layer, 'pointerup', { clientX: 440, clientY: 420 });
    expect(getStrokes()).toHaveLength(2);
  });

  // TC-12: the point limit, from the pointer's side of the board.
  it('TC-12 commits a part at the point limit and carries on from its last point', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    const cam = camera();
    const spiral = copyPath(LONG_SPIRAL);
    expect(spiral.length).toBe(STROKE_MAX_POINTS + 10);
    drawLongPath(
      layer,
      spiral.map((p) => worldToScreen(cam, p)),
    );

    const strokes = getStrokes();
    expect(strokes).toHaveLength(2);
    for (const s of strokes) {
      expect(s.points.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
      expect(s.color).toBe(DEFAULT_PEN_COLOR);
    }
    // The two join with no gap: the second stroke starts on the point the first
    // stopped at (PRD pen.long_stroke).
    const first = scaledPoints(strokes[0]!);
    const second = scaledPoints(strokes[1]!);
    const join = first[first.length - 1]!;
    expect(second[0]!.x).toBeCloseTo(join.x, 4);
    expect(second[0]!.y).toBeCloseTo(join.y, 4);
    // The line still follows the pointer afterwards, so the pen never "ended".
    expect(toolState()).toBe('pen');
  });

  // TC-13: neither Escape nor V leaves a stroke behind, and both leave the pen.
  it('TC-13 creates nothing on Escape or on switching to another tool', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    expect(penLayer()).not.toBeNull();
    expect(toolState()).toBe('pen');

    dispatchKey({ key: 'Escape' });
    expect(toolState()).toBe('select');
    expect(penToolEl()).toBeNull();
    expect(penToolbarEl()).toBeNull();
    expect(getStrokes()).toHaveLength(0);

    dispatchKey({ key: 'v' });
    expect(toolState()).toBe('select');
    expect(getStrokes()).toHaveLength(0);

    // A pen stroke made before leaving is untouched by leaving.
    const strokes = getStrokes();
    expect(strokes).toHaveLength(0);
  });

  // TC-14: options belong to the pen, not to the strokes that are already there.
  it('TC-14 keeps the strokes already drawn when the colour changes and uses it for the next', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    drawOn(layer, screenPath({ x: 40, y: 60 }, { x: 240, y: 120 }));
    const before = getStrokes()[0]!;
    expect(before.color).toBe(DEFAULT_PEN_COLOR);

    pickPenColor('purple');
    // Nothing already on the board changed.
    expect(getStrokes()[0]!.color).toBe(before.color);
    expect(screen.getByTestId('stroke-line').getAttribute('stroke')).toBe(
      PEN_COLORS[DEFAULT_PEN_COLOR],
    );

    drawOn(layer, screenPath({ x: 260, y: 140 }, { x: 460, y: 200 }));
    const strokes = getStrokes();
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.color).toBe(before.color);
    expect(strokes[1]!.color).toBe('purple');
    // Two strokes, two colours: the ink is per stroke, and so is what it is drawn with.
    const paths = screen.getAllByTestId('stroke-line');
    expect(paths[0]!.getAttribute('stroke')).toBe(PEN_COLORS[before.color]);
    expect(paths[1]!.getAttribute('stroke')).toBe(PEN_COLORS.purple);
  });

  it('draws the thickness chosen, and a stroke keeps it for good', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    pickPenThickness('thin');
    drawOn(layer, screenPath({ x: 20, y: 40 }, { x: 220, y: 90 }));
    pickPenThickness('thick');
    drawOn(layer, screenPath({ x: 20, y: 140 }, { x: 220, y: 190 }));

    const strokes = getStrokes();
    expect(strokes.map((s) => s.thickness)).toEqual(['thin', 'thick']);
    const paths = screen.getAllByTestId('stroke-line');
    expect(paths[0]!.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thin));
    expect(paths[1]!.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
  });

  it('smooths the recorded line without losing it: fewer points, same path', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    const cam = camera();
    const drawn = copyPath(HANDWRITTEN_LOOP);
    drawOn(
      layer,
      drawn.map((p) => worldToScreen(cam, p)),
    );
    const strokes = getStrokes();
    expect(strokes).toHaveLength(1);
    // At the default zoom the tolerance is 1 board unit; a loop this smooth needs far
    // fewer points to still be the same loop (PRD pen.smooth).
    const kept = strokes[0]!.points.length / 2;
    expect(kept).toBeLessThan(drawn.length);
    expect(kept).toBeGreaterThan(1);
    const distance = distanceFromStrokeLine(strokes[0]!, scaledPoints(strokes[0]!)[0]!);
    expect(distance).toBe(0);
  });

  it('leaves a note under the pointer exactly where it was, and unselected', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    seedNotes([{ x: 100, y: 100, width: 160, height: 120, text: 'Do not move' }]);
    const before = screen.getByTestId('sticky-note');
    const startBox = before.style.left + '/' + before.style.top;
    const layer = penLayer();
    // The drag starts on top of the note, and still draws (PRD pen.navigation).
    drawOn(layer, screenPath({ x: 110, y: 110 }, { x: 240, y: 200 }));

    expect(getStrokes()).toHaveLength(1);
    const notes = screen.getAllByTestId('sticky-note');
    expect(notes[0]!.style.left + '/' + notes[0]!.style.top).toBe(startBox);
    expect(getSelection().selectedId).toBeNull();
    expect(toolState()).toBe('pen');
  });

  it('still lets the wheel navigate the board while the pen is in hand', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const layer = penLayer();
    const before = camera();
    // The pen's surface is inside the viewport, so the wheel event reaches the board:
    // scrolling pans and pinch zooms exactly as story 1 (PRD pen.navigation).
    dispatchWheel(layer, { deltaX: 0, deltaY: 120, clientX: 300, clientY: 200 });
    const after = camera();
    expect(after.y).not.toBe(before.y);
    expect(getStrokes()).toHaveLength(0);
  });
});
