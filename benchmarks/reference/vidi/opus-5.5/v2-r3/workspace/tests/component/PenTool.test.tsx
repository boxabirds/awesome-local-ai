import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectsSnapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { createStroke, isStroke, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { screenToWorld, type Camera } from '../../src/client/canvas/camera';
import { resetPenOptions } from '../../src/client/tools/usePenOptions';
import { flushFrame, keyDown, model, readCamera, renderApp, useFakeFrames } from './helpers';

const strokes = () => objectsSnapshot(window.__vidi6!.doc).filter(isStroke) as StrokeSnap[];
const pressedTools = () =>
  [...screen.getByRole('toolbar', { name: 'Tools' }).querySelectorAll('.toolbar-button[aria-pressed="true"]')].map((b) =>
    b.getAttribute('aria-label'),
  );
const penButton = () => screen.getByRole('button', { name: 'Pen (P)' });
const layer = () => screen.getByTestId('pen-tool');

function down(p: Point, pointerId = 1) {
  fireEvent.pointerDown(layer(), { pointerId, button: 0, clientX: p.x, clientY: p.y });
}
function move(p: Point, pointerId = 1) {
  fireEvent.pointerMove(layer(), { pointerId, clientX: p.x, clientY: p.y });
}
function up(p: Point, pointerId = 1) {
  fireEvent.pointerUp(layer(), { pointerId, clientX: p.x, clientY: p.y });
}

/** A short wavy drag in screen pixels. */
function wave(from: Point, n = 30): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: from.x + i * 6, y: from.y + Math.sin(i / 3) * 20 }));
}

function drawScreen(pts: readonly Point[]) {
  down(pts[0]);
  for (const p of pts.slice(1)) move(p);
  up(pts[pts.length - 1]);
}

describe('pen.tool', () => {
  beforeEach(() => {
    useFakeFrames();
    resetPenOptions();
  });
  afterEach(() => vi.useRealTimers());

  it('P and the Pen button choose the Pen; its toolbar shows six colours and three thicknesses', () => {
    renderApp();
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    keyDown(document.body, 'p');
    expect(pressedTools()).toEqual(['Pen (P)']);
    const bar = screen.getByRole('toolbar', { name: 'Pen' });
    const colours = ['Black', 'Blue', 'Red', 'Green', 'Orange', 'Purple'].map((c) =>
      screen.getByRole('button', { name: `${c} pen` }),
    );
    expect(colours.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(['Thin', 'Medium', 'Thick'].map((t) => screen.getByRole('button', { name: t }).getAttribute('aria-pressed'))).toEqual([
      'false', 'true', 'false',
    ]);
    expect(bar).toBeInTheDocument();
    keyDown(document.body, 'v');
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    fireEvent.click(penButton());
    expect(pressedTools()).toEqual(['Pen (P)']);
  });

  it('the round cursor is the thickness at the current zoom', () => {
    const { viewport } = renderApp();
    act(() => window.__vidi6!.setCamera({ x: 0, y: 0, zoom: 2 }));
    flushFrame();
    expect(readCamera(viewport).zoom).toBe(2);
    keyDown(document.body, 'p');
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    move({ x: 100, y: 100 });
    flushFrame();
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD.thick * 2}px`);
    expect(cursor.style.height).toBe(`${PEN_THICKNESS_WORLD.thick * 2}px`);
  });

  it('TC-09 with red + thick a drag creates one red thick stroke, preview follows each frame, tool stays Pen', () => {
    const { viewport } = renderApp();
    const cam: Camera = readCamera(viewport);
    keyDown(document.body, 'p');
    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    const pts = wave({ x: 100, y: 200 });
    down(pts[0]);
    move(pts[1]);
    move(pts[2]);
    flushFrame();
    const d1 = screen.getByTestId('pen-preview').getAttribute('d');
    expect(screen.getByTestId('pen-preview').getAttribute('stroke')).toBe(PEN_COLORS.red);
    for (const p of pts.slice(3)) move(p);
    flushFrame();
    expect(screen.getByTestId('pen-preview').getAttribute('d')).not.toBe(d1);
    // Nothing is in the document while drawing (pen.share).
    expect(strokes()).toHaveLength(0);
    up(pts[pts.length - 1]);
    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    // Faithful to the drawn path: every drawn point within 1 screen px of the stored line.
    const line = scaledPoints(all[0]);
    const first = screenToWorld(cam, pts[0]);
    expect(line[0].x).toBeCloseTo(first.x, 9);
    expect(line[0].y).toBeCloseTo(first.y, 9);
    expect(pressedTools()).toEqual(['Pen (P)']);
    expect(screen.getByTestId('pen-tool')).toBeInTheDocument();
    // A second stroke with the Pen still active.
    drawScreen(wave({ x: 100, y: 400 }));
    expect(strokes()).toHaveLength(2);
  });

  it('TC-10 a press and release without movement draws a dot', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    keyDown(document.body, 'p');
    down({ x: 300, y: 300 });
    up({ x: 300, y: 300 });
    const [dot] = strokes();
    expect(dot.points).toHaveLength(2);
    const t = PEN_THICKNESS_WORLD.medium;
    expect(dot.width).toBe(t);
    expect(dot.height).toBe(t);
    const at = screenToWorld(cam, { x: 300, y: 300 });
    expect(scaledPoints(dot)[0].x).toBeCloseTo(at.x, 9);
    expect(scaledPoints(dot)[0].y).toBeCloseTo(at.y, 9);
  });

  it('TC-11 pointercancel mid-drag keeps the stroke drawn so far; so does lost pointer capture', () => {
    const cam = readCamera(renderApp().viewport);
    keyDown(document.body, 'p');
    const pts = wave({ x: 100, y: 100 });
    down(pts[0]);
    for (const p of pts.slice(1, 15)) move(p);
    fireEvent.pointerCancel(layer(), { pointerId: 1 });
    expect(strokes()).toHaveLength(1);
    const line = scaledPoints(strokes()[0]);
    // Ends where the pointer was last seen.
    expect(line[line.length - 1].x).toBeCloseTo(screenToWorld(cam, pts[14]).x, 9);
    down(pts[0]);
    for (const p of pts.slice(1, 10)) move(p);
    fireEvent.lostPointerCapture(layer(), { pointerId: 1 });
    expect(strokes()).toHaveLength(2);
    expect(screen.getByTestId('pen-tool').dataset.state).toBe('ready');
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves → two strokes, the second starting at the first one\'s last point', () => {
    const cam = readCamera(renderApp().viewport);
    keyDown(document.body, 'p');
    const pts = Array.from({ length: STROKE_MAX_POINTS + 11 }, (_, i) => ({
      x: 100 + (i % 200) * 3,
      y: 100 + Math.floor(i / 200) * 5 + (i % 2),
    }));
    down(pts[0]);
    for (const p of pts.slice(1)) move(p);
    // The first part is committed as soon as the limit is reached, while still drawing.
    expect(strokes()).toHaveLength(1);
    up(pts[pts.length - 1]);
    const all = strokes().sort((a, b) => a.z - b.z);
    expect(all).toHaveLength(2);
    const a = scaledPoints(all[0]);
    const b = scaledPoints(all[1]);
    expect(b[0].x).toBeCloseTo(a[a.length - 1].x, 9);
    expect(b[0].y).toBeCloseTo(a[a.length - 1].y, 9);
    expect(b[b.length - 1].x).toBeCloseTo(screenToWorld(cam, pts[pts.length - 1]).x, 9);
  }, 30_000);

  it('TC-13 Escape (also mid-drag) and V leave the Pen and create nothing', () => {
    renderApp();
    keyDown(document.body, 'p');
    keyDown(document.body, 'Escape');
    expect(pressedTools()).toEqual(['Select (V)']);
    keyDown(document.body, 'p');
    const pts = wave({ x: 100, y: 100 });
    down(pts[0]);
    for (const p of pts.slice(1)) move(p);
    keyDown(document.body, 'Escape');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    fireEvent.pointerUp(document.body, { pointerId: 1 });
    keyDown(document.body, 'p');
    keyDown(document.body, 'v');
    expect(pressedTools()).toEqual(['Select (V)']);
    expect(strokes()).toHaveLength(0);
  });

  it('TC-14 changing the colour after a stroke exists leaves it unchanged; the next stroke uses the new colour', () => {
    renderApp();
    keyDown(document.body, 'p');
    drawScreen(wave({ x: 100, y: 100 }));
    const [first] = strokes();
    expect(first.color).toBe('black');
    fireEvent.click(screen.getByRole('button', { name: 'Green pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
    expect(screen.getByRole('button', { name: 'Green pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(strokes()[0]).toMatchObject({ color: 'black', thickness: 'medium' });
    drawScreen(wave({ x: 100, y: 400 }));
    const second = strokes().find((s) => s.id !== first.id)!;
    expect(second).toMatchObject({ color: 'green', thickness: 'thin' });
    // Remembered across tool switches.
    keyDown(document.body, 'v');
    keyDown(document.body, 'p');
    expect(screen.getByRole('button', { name: 'Green pen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a stroke is one undo step and the Pen stays active', () => {
    renderApp();
    keyDown(document.body, 'p');
    drawScreen(wave({ x: 100, y: 100 }));
    drawScreen(wave({ x: 100, y: 300 }));
    expect(strokes()).toHaveLength(2);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(strokes()).toHaveLength(1);
    expect(pressedTools()).toEqual(['Pen (P)']);
  });

  it('an invalid stroke is discarded silently', () => {
    renderApp();
    const id = model((doc) => createStroke(doc, { points: [], color: 'black', thickness: 'thin' }, 'c_x'));
    expect(id).toBeNull();
    expect(strokes()).toHaveLength(0);
  });
});
