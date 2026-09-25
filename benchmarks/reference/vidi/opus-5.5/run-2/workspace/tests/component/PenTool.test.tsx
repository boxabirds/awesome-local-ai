/** Story 11 pen.tool component tests (TC-09 to TC-14): PenTool gestures, PenToolbar options, Pen staying active. */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshotObjects } from '../../src/shared/board-model';
import { isStrokeSnap, scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { screenToWorld, type Point } from '../../src/client/canvas/camera';
import { resetPenOptions } from '../../src/client/tools/usePenOptions';
import { countUpdates } from './boardHelpers';
import { flushFrame, readCamera } from './helpers';
import { key, pointer, renderApp, toolButton } from './shapeHelpers';

let doc: Y.Doc;

beforeEach(() => {
  doc = new Y.Doc();
  resetPenOptions();
});

afterEach(() => {
  vi.useRealTimers();
});

function strokes(): StrokeSnap[] {
  return snapshotObjects(doc).filter(isStrokeSnap);
}

function layer(): HTMLElement {
  return screen.getByTestId('pen-tool');
}

function pressedTools(): string[] {
  return within(screen.getByRole('toolbar', { name: 'Tools' }))
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.getAttribute('aria-label')!);
}

/** A wavy line of `n` screen points starting at `from`. */
function wave(from: Point, n: number): Point[] {
  return Array.from({ length: n }, (_, i) => ({ x: from.x + i * 3, y: from.y + Math.sin(i / 4) * 20 }));
}

function draw(points: readonly Point[], end: 'pointerUp' | 'pointerCancel' = 'pointerUp'): void {
  pointer(layer(), 'pointerDown', points[0]!);
  for (const p of points.slice(1)) pointer(layer(), 'pointerMove', p);
  pointer(layer(), end, points[points.length - 1]!);
}

function expectNear(a: Point, b: Point, digits = 6): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
}

describe('pen.tool', () => {
  it('TC-09 P, red + thick, drag: preview while drawing (not shared), one red thick stroke on release, Pen still active', () => {
    renderApp(doc);
    key('p');
    expect(pressedTools()).toEqual(['Pen (P)']);
    const bar = screen.getByRole('toolbar', { name: 'Pen' });
    expect(within(bar).getByRole('button', { name: 'Black pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar).getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar).getAllByRole('button', { name: / pen$/ }).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Black pen',
      'Blue pen',
      'Red pen',
      'Green pen',
      'Orange pen',
      'Purple pen',
    ]);
    fireEvent.click(within(bar).getByRole('button', { name: 'Red pen' }));
    fireEvent.click(within(bar).getByRole('button', { name: 'Thick' }));
    expect(within(bar).getByRole('button', { name: 'Red pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(bar).getByRole('button', { name: 'Black pen' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(bar).getByRole('button', { name: 'Thick' })).toHaveAttribute('aria-pressed', 'true');

    const camera = readCamera();
    const cursor = screen.getByTestId('pen-cursor');
    expect(cursor.style.width).toBe(`${PEN_THICKNESS_WORLD.thick * camera.zoom}px`);
    const updates = countUpdates(doc);
    const path = wave({ x: 200, y: 300 }, 60);
    pointer(layer(), 'pointerDown', path[0]!);
    for (const p of path.slice(1, 30)) pointer(layer(), 'pointerMove', p);
    flushFrame();
    const preview = screen.getByTestId('pen-preview');
    const d1 = preview.getAttribute('d')!;
    expect(d1.startsWith(`M ${path[0]!.x} ${path[0]!.y}`)).toBe(true);
    for (const p of path.slice(30)) pointer(layer(), 'pointerMove', p);
    flushFrame();
    expect(preview.getAttribute('d')!.length).toBeGreaterThan(d1.length);
    // Nothing is written (so nothing is shared) while drawing.
    expect(updates.count).toBe(0);
    pointer(layer(), 'pointerUp', path[path.length - 1]!);

    expect(updates.count).toBe(1);
    const all = strokes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ color: 'red', thickness: 'thick' });
    const pts = scaledPoints(all[0]!);
    expect(pts.length).toBeLessThan(path.length);
    expectNear(pts[0]!, screenToWorld(camera, path[0]!));
    expectNear(pts[pts.length - 1]!, screenToWorld(camera, path[path.length - 1]!));
    expect(screen.queryByTestId('pen-preview')).toBeNull();
    expect(pressedTools()).toEqual(['Pen (P)']);
    expect(screen.getByTestId('pen-tool')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Drawing' })).toBeInTheDocument();
  });

  it('TC-10 a click without moving adds a dot as wide as the thickness', () => {
    renderApp(doc);
    const camera = readCamera();
    fireEvent.click(toolButton('Pen (P)'));
    pointer(layer(), 'pointerDown', { x: 400, y: 300 });
    pointer(layer(), 'pointerMove', { x: 401, y: 301 });
    pointer(layer(), 'pointerUp', { x: 401, y: 301 });
    const all = strokes();
    expect(all).toHaveLength(1);
    const dot = all[0]!;
    const t = PEN_THICKNESS_WORLD.medium;
    expect(dot.points).toHaveLength(2);
    expect(dot.width).toBe(t);
    expect(dot.height).toBe(t);
    expectNear(scaledPoints(dot)[0]!, screenToWorld(camera, { x: 400, y: 300 }));
    expect(pressedTools()).toEqual(['Pen (P)']);
  });

  it('TC-11 pointercancel keeps the stroke drawn so far', () => {
    renderApp(doc);
    const camera = readCamera();
    key('p');
    const path = wave({ x: 100, y: 200 }, 40);
    draw(path, 'pointerCancel');
    const all = strokes();
    expect(all).toHaveLength(1);
    const pts = scaledPoints(all[0]!);
    expectNear(pts[0]!, screenToWorld(camera, path[0]!));
    expectNear(pts[pts.length - 1]!, screenToWorld(camera, path[path.length - 1]!));
    expect(pressedTools()).toEqual(['Pen (P)']);
  });

  it('TC-12 STROKE_MAX_POINTS + 10 moves: two strokes, the second starts at the first one\'s last point; each is one undo step', () => {
    renderApp(doc);
    key('p');
    const updates = countUpdates(doc);
    // Zig-zag so simplification keeps plenty of points.
    const path = Array.from({ length: STROKE_MAX_POINTS + 11 }, (_, i) => ({ x: 50 + (i % 500) * 1.5, y: 100 + (i % 2) * 4 + Math.floor(i / 500) * 20 }));
    pointer(layer(), 'pointerDown', path[0]!);
    for (const p of path.slice(1)) pointer(layer(), 'pointerMove', p);
    // The first part is committed while still drawing.
    expect(strokes()).toHaveLength(1);
    pointer(layer(), 'pointerUp', path[path.length - 1]!);
    expect(updates.count).toBe(2);
    const [first, second] = [...strokes()].sort((a, b) => a.z - b.z);
    const a = scaledPoints(first!);
    const b = scaledPoints(second!);
    expectNear(b[0]!, a[a.length - 1]!);
    const camera = readCamera();
    expectNear(b[b.length - 1]!, screenToWorld(camera, path[path.length - 1]!));

    key('z', { ctrlKey: true });
    expect(strokes().map((s) => s.id)).toEqual([first!.id]);
    key('z', { ctrlKey: true });
    expect(strokes()).toHaveLength(0);
  });

  it('TC-13 Escape and V leave the Pen without creating anything (also mid-stroke)', () => {
    renderApp(doc);
    key('p');
    key('Escape');
    expect(pressedTools()).toEqual(['Select (V)']);
    expect(screen.queryByRole('toolbar', { name: 'Pen' })).toBeNull();
    key('p');
    key('v');
    expect(pressedTools()).toEqual(['Select (V)']);

    key('p');
    pointer(layer(), 'pointerDown', { x: 100, y: 100 });
    pointer(layer(), 'pointerMove', { x: 200, y: 150 });
    key('Escape');
    expect(screen.queryByTestId('pen-tool')).toBeNull();
    expect(pressedTools()).toEqual(['Select (V)']);
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-14 a new colour applies to later strokes only and is remembered for the session', () => {
    renderApp(doc);
    key('p');
    draw(wave({ x: 100, y: 100 }, 20));
    const firstId = strokes()[0]!.id;
    fireEvent.click(screen.getByRole('button', { name: 'Blue pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thin' }));
    expect(strokes()[0]).toMatchObject({ id: firstId, color: 'black', thickness: 'medium' });
    draw(wave({ x: 100, y: 400 }, 20));
    const second = strokes().find((s) => s.id !== firstId)!;
    expect(second).toMatchObject({ color: 'blue', thickness: 'thin' });
    expect(strokes().find((s) => s.id === firstId)).toMatchObject({ color: 'black', thickness: 'medium' });

    // Choosing another tool and coming back keeps the choice.
    key('v');
    key('p');
    expect(screen.getByRole('button', { name: 'Blue pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Thin' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('pen.navigation: a drag starting on a sticky neither moves it nor pans the board', () => {
    renderApp(doc);
    const before = readCamera();
    const start = { x: 512, y: 384 };
    act(() => {
      createSticky(doc, screenToWorld(before, start));
    });
    const note = snapshotObjects(doc)[0]!;
    key('p');
    draw([start, { x: 560, y: 420 }, { x: 640, y: 480 }]);
    expect(readCamera()).toEqual(before);
    const after = snapshotObjects(doc).find((o) => o.id === note.id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: note.x, y: note.y });
    expect(strokes()).toHaveLength(1);
  });
});
