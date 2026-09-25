/**
 * pen.tool (story 11) on the real board with a real Y.Doc, synthetic pointer events and fake
 * animation frames: TC-09 to TC-14, plus preview, undo and routing checks.
 */
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
} from '../../src/shared/config';
import { scaledPoints } from '../../src/shared/objects/stroke';
import { SPIRAL, UNDERLINE } from '../fixtures/pen-paths';
import { drawPath, penDown, penMove, penPreview, penTool, penUp, strokeEls, strokes } from './penHelpers';
import { toolPressed } from './shapeHelpers';
import { camera, createSelectedNote, flushFrame, notes, renderBoard } from './stickyHelpers';
import { pressKey } from './textHelpers';

const SHORT_DRAG = [
  { x: 100, y: 100 },
  { x: 140, y: 120 },
  { x: 200, y: 110 },
  { x: 260, y: 160 },
];
/** Screen offset that keeps the spiral fixture on the board. */
const SPIRAL_ORIGIN = { x: 600, y: 400 };
const SPIRAL_SCALE = 0.9;

function pressButton(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('pen.tool', () => {
  it('P shows the pen toolbar (black and Medium pressed) and the round cursor sized to the thickness', () => {
    renderBoard();
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    pressKey('p');
    expect(toolPressed('Pen (P)')).toBe('true');
    const bar = screen.getByRole('toolbar', { name: 'Pen' });
    const colours = ['Black pen', 'Blue pen', 'Red pen', 'Green pen', 'Orange pen', 'Purple pen'];
    for (const name of colours) expect(screen.getByRole('button', { name })).toBeTruthy();
    for (const name of ['Thin', 'Medium', 'Thick']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(bar.querySelectorAll('[aria-pressed="true"]')).toHaveLength(2);
    expect(toolPressed('Black pen')).toBe('true');
    expect(toolPressed('Medium')).toBe('true');
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS] * camera().zoom}px`);
    pressButton('Thick');
    expect(screen.getByTestId('pen-cursor').style.width).toBe(`${PEN_THICKNESS_WORLD.thick * camera().zoom}px`);
    // The Pen button in the left toolbar also chooses the tool.
    pressKey('v');
    pressButton('Pen (P)');
    expect(toolPressed('Pen (P)')).toBe('true');
  });

  it('TC-09 with red + Thick, a drag creates one stroke in red/thick; the preview follows per frame; the Pen stays active', () => {
    renderBoard();
    pressKey('p');
    pressButton('Red pen');
    pressButton('Thick');
    const layer = penTool();
    penDown(SHORT_DRAG[0]!, layer);
    penMove(SHORT_DRAG[1]!, layer);
    // Redrawn at the next animation frame, not synchronously per event.
    expect(penPreview().getAttribute('d')).toBe('');
    flushFrame();
    const first = penPreview().getAttribute('d')!;
    expect(first).toMatch(/^M100\.0 100\.0L140\.0 120\.0$/);
    penMove(SHORT_DRAG[2]!, layer);
    penMove(SHORT_DRAG[3]!, layer);
    flushFrame();
    expect(penPreview().getAttribute('d')).not.toBe(first);
    expect(penPreview().getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick * camera().zoom));
    // Nothing in the document while drawing.
    expect(strokes()).toHaveLength(0);
    penUp(SHORT_DRAG[3]!, layer);

    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    const cam = camera();
    const pts = scaledPoints(all[0]!);
    expect(pts[0]!.x).toBeCloseTo(SHORT_DRAG[0]!.x / cam.zoom + cam.x, 6);
    expect(pts[pts.length - 1]!.y).toBeCloseTo(SHORT_DRAG[3]!.y / cam.zoom + cam.y, 6);
    expect(penPreview().getAttribute('d')).toBe('');
    expect(toolPressed('Pen (P)')).toBe('true');
    expect(strokeEls()).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Drawing' })).toBeTruthy();
  });

  it('TC-10 a click without movement adds a single-point dot whose diameter is the thickness', () => {
    renderBoard();
    pressKey('p');
    penDown({ x: 300, y: 300 });
    penMove({ x: 301, y: 301 }); // under DRAG_THRESHOLD_PX: still a click
    penUp({ x: 301, y: 301 });
    const [dot] = strokes();
    expect(dot!.points).toHaveLength(2);
    const t = PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS];
    expect(dot).toMatchObject({ width: t, height: t, color: DEFAULT_PEN_COLOR });
    const cam = camera();
    expect(scaledPoints(dot!)[0]!.x).toBeCloseTo(300 / cam.zoom + cam.x, 6);
  });

  it('TC-11 pointercancel mid-drag keeps the stroke with the points drawn so far', () => {
    renderBoard();
    pressKey('p');
    const layer = penTool();
    penDown(SHORT_DRAG[0]!, layer);
    penMove(SHORT_DRAG[1]!, layer);
    penMove(SHORT_DRAG[2]!, layer);
    fireEvent.pointerCancel(layer, { pointerId: 1, clientX: 999, clientY: 999 });
    const all = strokes();
    expect(all).toHaveLength(1);
    const cam = camera();
    const pts = scaledPoints(all[0]!);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(SHORT_DRAG[2]!.x / cam.zoom + cam.x, 6);
    // Lost pointer capture is treated the same way.
    penDown({ x: 500, y: 500 }, layer);
    penMove({ x: 560, y: 520 }, layer);
    fireEvent.lostPointerCapture(layer, { pointerId: 1 });
    expect(strokes()).toHaveLength(2);
    expect(toolPressed('Pen (P)')).toBe('true');
  });

  it('TC-12 STROKE_MAX_POINTS + 10 points: two strokes, the second starts at the first one’s last point', () => {
    renderBoard();
    pressKey('p');
    const layer = penTool();
    const screenPts = SPIRAL.slice(0, STROKE_MAX_POINTS + 10).map((p) => ({
      x: SPIRAL_ORIGIN.x + p.x * SPIRAL_SCALE,
      y: SPIRAL_ORIGIN.y + p.y * SPIRAL_SCALE,
    }));
    penDown(screenPts[0]!, layer);
    for (const p of screenPts.slice(1)) penMove(p, layer);
    // The first part is committed as soon as it reaches the limit, while still drawing.
    expect(strokes()).toHaveLength(1);
    penUp(screenPts[screenPts.length - 1]!, layer);
    const all = [...strokes()].sort((a, b) => a.z - b.z);
    expect(all).toHaveLength(2);
    const firstPts = scaledPoints(all[0]!);
    const secondPts = scaledPoints(all[1]!);
    const join = firstPts[firstPts.length - 1]!;
    expect(secondPts[0]!.x).toBeCloseTo(join.x, 6);
    expect(secondPts[0]!.y).toBeCloseTo(join.y, 6);
    const cam = camera();
    expect(join.x).toBeCloseTo(screenPts[STROKE_MAX_POINTS - 1]!.x / cam.zoom + cam.x, 6);
  });

  it('TC-13 Escape and V switch to Select and create nothing; Escape mid-drag discards the preview', () => {
    renderBoard();
    pressKey('p');
    pressKey('Escape');
    expect(toolPressed('Select (V)')).toBe('true');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    pressKey('p');
    pressKey('v');
    expect(toolPressed('Select (V)')).toBe('true');
    pressKey('p');
    penDown(SHORT_DRAG[0]!);
    penMove(SHORT_DRAG[1]!);
    flushFrame();
    pressKey('Escape');
    expect(toolPressed('Select (V)')).toBe('true');
    flushFrame();
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14 changing the colour after a stroke exists leaves it unchanged; the next stroke uses the new colour', () => {
    renderBoard();
    pressKey('p');
    drawPath(SHORT_DRAG);
    const first = strokes()[0]!;
    expect(first.color).toBe('black');
    pressButton('Green pen');
    pressButton('Thin');
    expect(strokes()[0]).toEqual(first);
    drawPath(SHORT_DRAG.map((p) => ({ x: p.x, y: p.y + 200 })));
    const second = strokes().find((s) => s.id !== first.id)!;
    expect(second).toMatchObject({ color: 'green', thickness: 'thin' });
    expect(strokes().find((s) => s.id === first.id)).toMatchObject({ color: 'black', thickness: 'medium' });
    // Choices are kept across tool switches (until reload).
    pressKey('v');
    pressKey('p');
    expect(toolPressed('Green pen')).toBe('true');
    expect(toolPressed('Thin')).toBe('true');
  });

  it('each finished stroke is one undo step', () => {
    renderBoard();
    pressKey('p');
    drawPath(UNDERLINE.map((p) => ({ x: p.x, y: p.y })));
    drawPath(SHORT_DRAG);
    expect(strokes()).toHaveLength(2);
    pressKey('z', { ctrlKey: true });
    expect(strokes()).toHaveLength(1);
    pressKey('z', { ctrlKey: true });
    expect(strokes()).toHaveLength(0);
  });

  it('a Pen drag starting on a sticky note draws and never moves or selects the note (negative)', () => {
    renderBoard();
    createSelectedNote(400, 300);
    const before = notes()[0]!;
    const camBefore = camera();
    pressKey('p');
    drawPath([
      { x: 400, y: 300 },
      { x: 450, y: 330 },
      { x: 520, y: 360 },
    ]);
    expect(notes()[0]).toMatchObject({ x: before.x, y: before.y });
    expect(strokes()).toHaveLength(1);
    expect(camera()).toEqual(camBefore);
    expect(window.__vidi6!.getSelection()).toEqual([before.id]);
  });

  it('a simplified stroke has fewer points than were recorded', () => {
    renderBoard();
    pressKey('p');
    drawPath(UNDERLINE);
    const [s] = strokes();
    expect(s!.points.length / 2).toBeLessThan(UNDERLINE.length);
  });
});
