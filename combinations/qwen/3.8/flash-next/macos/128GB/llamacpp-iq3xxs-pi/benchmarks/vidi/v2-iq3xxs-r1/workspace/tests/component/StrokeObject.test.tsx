import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Board } from '../../src/client/board/Board';
import { worldToScreen } from '../../src/client/canvas/camera';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { copyPath, UNDERLINE } from '../fixtures/pen-paths';
import { dispatchPointer, flushFrame, TEST_BOARD_ID } from './util';
import { getSelection, modelDelete, noteEl } from './stickyUtil';
import { camera, seedNote, setCamera } from './shapeUtil';
import { getStrokes, seedStroke, strokeEls, strokeHit, strokePathD } from './penUtil';

/**
 * Story 11 — a drawn stroke on the board (pen.select, pen.resize, stroke.object).
 *
 * A stroke's box is where its handles live, but the box is not what a click hits: only
 * the wide invisible path along the line answers to a pointer, so clicking inside the
 * box of a squiggle picks up the note underneath instead of the squiggle (PRD
 * pen.select). The line itself stays grabbable at every zoom, because the tolerance is
 * counted in screen pixels.
 */

/** Press and release on an element at a point, as one pointer would. */
function clickOn(el: Element, at: { x: number; y: number }, pointerId: number): void {
  dispatchPointer(el, 'pointerdown', { pointerId, clientX: at.x, clientY: at.y });
  dispatchPointer(el, 'pointerup', { pointerId, clientX: at.x, clientY: at.y });
}

//** A perfectly straight line, so "5 pixels off the line" means exactly that. */
const STRAIGHT = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 200, y: 0 },
];

/** A tall right angle, so its box holds a note that its line never comes near. */
const FRAME = [
  { x: 100, y: 100 },
  { x: 100, y: 400 },
  { x: 400, y: 400 },
];

describe('a stroke on the board (stroke.object, pen.select)', () => {
  // TC-15: the line is clickable 6 px around it at any zoom, and not 7 px.
  it('TC-15 hits the line within 6 screen pixels and misses beyond it, at 50% and 200%', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const stroke = seedStroke({ points: copyPath(STRAIGHT), thickness: 'thin' });
    const line = scaledPoints(stroke);
    // A point straight off the middle of the line, so only the perpendicular matters.
    const middle = { x: (line[0].x + line[line.length - 1].x) / 2, y: line[0].y };
    const ink = PEN_THICKNESS_WORLD[stroke.thickness];

    for (const zoom of [0.5, 2]) {
      // `px` screen pixels are `px / zoom` board units at this zoom.
      const within = 5 / zoom;
      const beyond = 7 / zoom;
      const near = { x: middle.x, y: middle.y - within };
      const far = { x: middle.x, y: middle.y - beyond };
      // Sanity: these really are the perpendicular distances we asked for.
      expect(Math.abs(middle.y - near.y)).toBeCloseTo(5 / zoom, 6);
      expect(Math.abs(middle.y - far.y)).toBeCloseTo(7 / zoom, 6);

      // Half the ink is 1 board unit, 6 px of screen is wider at both these zooms,
      // so the 6 px rule decides both answers (PRD pen.select).
      expect(Math.max(ink / 2, STROKE_HIT_TOLERANCE_PX / zoom)).toBeCloseTo(
        STROKE_HIT_TOLERANCE_PX / zoom,
        6,
      );
      expect(strokeHit(stroke, near, zoom)).toBe(true);
      expect(strokeHit(stroke, far, zoom)).toBe(false);
    }

    // The rendered band follows the same rule: it is the stroke's width in board
    // units, and it widens as the board shrinks, so it is always ~6 px on screen.
    setCamera({ ...camera(), zoom: 1 });
    const bandAt1 = screen.getByTestId('stroke-hit').getAttribute('stroke-width');
    setCamera({ ...camera(), zoom: 4 });
    const bandAt4 = screen.getByTestId('stroke-hit').getAttribute('stroke-width');
    expect(Number(bandAt1)).toBeCloseTo(STROKE_HIT_TOLERANCE_PX * 2, 6);
    expect(Number(bandAt4)).toBeCloseTo((STROKE_HIT_TOLERANCE_PX * 2) / 4, 6);
  });

  // A thick line is its own generous target: half the ink beats 6 px when zoomed in.
  it('is grabbable by half its own thickness when that is wider than 6 screen pixels', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const stroke = seedStroke({ points: FRAME, thickness: 'thick' });
    const zoom = 4;
    // Half of 8 board units is 4 units, while 6 px of screen slack is only 1.5 units
    // at 400 %, so the ink decides how wide the clickable band around the line is.
    const tolerance = Math.max(
      PEN_THICKNESS_WORLD[stroke.thickness] / 2,
      STROKE_HIT_TOLERANCE_PX / zoom,
    );
    expect(tolerance).toBe(PEN_THICKNESS_WORLD[stroke.thickness] / 2);
    // The vertical leg of the frame runs at x = 100; step off it sideways.
    expect(strokeHit(stroke, { x: 100 + tolerance * 0.9, y: 250 }, zoom)).toBe(true);
    expect(strokeHit(stroke, { x: 100 + tolerance * 1.1, y: 250 }, zoom)).toBe(false);
  });

  // TC-16: inside the box, away from the line, the click belongs to what is underneath.
  it('TC-16 leaves a click inside its box but away from its line to the note underneath', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const noteId = seedNote({ x: 150, y: 120, width: 160, height: 120 });
    const stroke = seedStroke({ points: FRAME });

    // The click: inside the stroke's box, far from its line, on top of the note.
    const at = { x: 230, y: 180 };
    expect(stroke.x).toBeLessThan(at.x);
    expect(stroke.x + stroke.width).toBeGreaterThan(at.x);
    expect(stroke.y).toBeLessThan(at.y);
    expect(stroke.y + stroke.height).toBeGreaterThan(at.y);
    expect(strokeHit(stroke, at, camera().zoom)).toBe(false);

    const strokeBox = screen.getByTestId('stroke-object');
    expect(strokeBox.getAttribute('data-selected')).toBe('false');

    // Press and release on the note, without ever touching the drawn line.
    const screenAt = worldToScreen(camera(), at);
    const note = noteEl();
    clickOn(note, screenAt, 3);

    expect(getSelection().selectedId).toBe(noteId);
    expect(screen.getByTestId('stroke-object').getAttribute('data-selected')).toBe('false');
    expect(getStrokes()).toHaveLength(1);
  });

  // Selecting by the line does work — that is how a stroke is grabbed at all.
  it('selects when the press lands on the line itself', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const stroke = seedStroke({ points: FRAME });
    const at = worldToScreen(camera(), { x: 100, y: 250 }); // on the vertical leg
    clickOn(screen.getByTestId('stroke-hit'), at, 4);

    expect(getSelection().selectedId).toBe(stroke.id);
    // The box, and only the box, is drawn as selected: that is where the handles are.
    expect(screen.getByTestId('stroke-object').getAttribute('data-selected')).toBe('true');
    expect(strokeEls()).toHaveLength(1);
  });

  // TC-21: someone else deletes the stroke I have selected.
  it('TC-21 clears the selection when the stroke I selected is deleted elsewhere', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const stroke = seedStroke({ points: copyPath(UNDERLINE) });
    const at = worldToScreen(camera(), scaledPoints(stroke)[3]!);
    clickOn(screen.getByTestId('stroke-hit'), at, 5);
    expect(getSelection().selectedId).toBe(stroke.id);

    // A stroke vanishes from the document while it is selected — the stale selection
    // is dropped quietly, exactly as it is for every other object (story 7).
    modelDelete(stroke.id);
    await flushFrame();

    expect(getStrokes()).toHaveLength(0);
    expect(strokeEls()).toHaveLength(0);
    expect(getSelection().selectedId).toBeNull();
  });

  it('is drawn as one smooth path in its ink, with the ink as its own width', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const stroke = seedStroke({ points: copyPath(UNDERLINE), color: 'green', thickness: 'thick' });
    const svg = screen.getByTestId('stroke-svg');
    const line = screen.getByTestId('stroke-line');

    expect(svg.getAttribute('aria-label')).toBe('Drawing');
    expect(line.getAttribute('stroke')).toBe(PEN_COLORS.green);
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    // A path built from midpoint curves: several quadratic segments, not straight lines.
    const d = strokePathD();
    expect(d.startsWith(`M`)).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBeGreaterThan(2);
    // A curve only closes with one straight segment, to the very last point.
    expect((d.match(/L/g) ?? []).length).toBe(1);
    // And the path stays inside its box, which is what makes the handles land right.
    const box = screen.getByTestId('stroke-object');
    expect(box.style.width).toBe(`${stroke.width}px`);
    expect(svg.getAttribute('width')).toBe(String(stroke.width));
  });
});
