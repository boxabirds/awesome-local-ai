// Story 11 component tests: the Pen tool gesture (TC-09 to TC-14).
//
//  - TC-09: a press/drag/release with the options set creates exactly one
//    stroke with that colour and thickness, the preview is gone, the tool
//    STAYS pen and nothing is selected.
//  - TC-10: a press and release with movement below DRAG_THRESHOLD_PX
//    commits a single point: a round dot of the chosen thickness.
//  - TC-11: pointercancel after some moves commits the points drawn so far.
//  - TC-12: a drag that records more than STROKE_MAX_POINTS commits the part
//    at the limit and continues as a new stroke that starts where the first
//    part ended (no gap).
//  - TC-13: Escape or the V shortcut leaves the pen and creates nothing.
//  - TC-14: changing the pen colour after a stroke keeps the earlier stroke's
//    colour.
//
// The camera is pinned to the origin at 100% so world units equal screen
// pixels.

import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Vidi6ObjectInfo } from '../../src/client/testHooks';
import { flushRaf, hooks, renderApp } from './helpers';

const penButton = () => screen.getByRole('button', { name: 'Pen (P)' });
const selectButton = () => screen.getByRole('button', { name: 'Select (V)' });
const vp = () => screen.getByTestId('board-viewport');

function pinCamera(): void {
  hooks().setCamera({ x: 0, y: 0, zoom: 1 });
}

function press(x: number, y: number): void {
  fireEvent.pointerDown(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function move(x: number, y: number): void {
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}
function release(x: number, y: number): void {
  fireEvent.pointerUp(vp(), { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

function strokes(): Vidi6ObjectInfo[] {
  return hooks().getObjects().filter((o) => o.type === 'stroke');
}

/** Reconstruct the stroke's world-space points from the hook's info. */
function worldPoints(o: Vidi6ObjectInfo): { x: number; y: number }[] {
  const pts = o.points ?? [];
  const bw = o.baseWidth ?? 1;
  const bh = o.baseHeight ?? 1;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push({
      x: (o.x ?? 0) + (pts[i] ?? 0) * ((o.width ?? 0) / bw),
      y: (o.y ?? 0) + (pts[i + 1] ?? 0) * ((o.height ?? 0) / bh),
    });
  }
  return out;
}

describe('pen tool (component)', () => {
  it('TC-09: drag creates one stroke with the chosen colour and thickness; stays on pen', async () => {
    await renderApp();
    pinCamera();

    fireEvent.keyDown(window, { key: 'p' });
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');

    // Choose red + thick, then draw.
    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));

    press(100, 100);
    move(150, 120);
    // The local preview is on screen while the drag is in flight.
    expect(screen.getByTestId('pen-preview')).toBeInTheDocument();

    release(200, 150);
    await flushRaf();
    expect(screen.queryByTestId('pen-preview')).not.toBeInTheDocument();

    const list = strokes();
    expect(list).toHaveLength(1);
    expect(list[0]!.color).toBe('red');
    expect(list[0]!.thickness).toBe('thick');
    expect(list[0]!.points).toBeDefined();

    // The tool stays pen (pen.stay_active); nothing is selected.
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    expect(selectButton()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('TC-10: a click without movement commits a single-point round dot of the thickness', async () => {
    await renderApp();
    pinCamera();
    fireEvent.keyDown(window, { key: 'p' });

    press(50, 50);
    release(50, 50);
    await flushRaf();

    const list = strokes();
    expect(list).toHaveLength(1);
    const s = list[0]!;
    expect(s.points).toHaveLength(2); // exactly one point
    const t = s.thickness ?? 'medium';
    expect(t).toBe('medium'); // default thickness
    // The dot's bbox is the thickness squared, centred on the press point.
    expect(s.width).toBeCloseTo(4, 5);
    expect(s.height).toBeCloseTo(4, 5);
    expect(s.x).toBeCloseTo(48, 5);
    expect(s.y).toBeCloseTo(48, 5);
  });

  it('TC-11: pointercancel commits the points drawn so far', async () => {
    await renderApp();
    pinCamera();
    fireEvent.keyDown(window, { key: 'p' });

    press(10, 10);
    move(40, 25);
    move(80, 40);
    fireEvent.pointerCancel(window, { pointerId: 1, clientX: 80, clientY: 40 });
    await flushRaf();

    const list = strokes();
    expect(list).toHaveLength(1);
    // A real stroke (more than the bare press point), not a dot.
    expect(list[0]!.points!.length).toBeGreaterThan(2);
  });

  it('TC-12: beyond STROKE_MAX_POINTS the part is committed and drawing continues from the same point', async () => {
    await renderApp();
    pinCamera();
    fireEvent.keyDown(window, { key: 'p' });

    press(0, 0);
    // STROKE_MAX_POINTS + 10 moves → the limit is crossed once mid-drag.
    const n = STROKE_MAX_POINTS + 10;
    for (let i = 1; i <= n; i += 1) {
      move((i * 3) % 40, (i * 7) % 30);
    }
    release(20, 15);
    await flushRaf();

    const list = strokes();
    expect(list).toHaveLength(2);
    const [s1, s2] = [list[0]!, list[1]!];
    // Each stroke stores far fewer than the raw recorded points (simplified)
    // and the second starts exactly where the first ended (no gap).
    expect(s1.points!.length / 2).toBeLessThan(STROKE_MAX_POINTS);
    const p1 = worldPoints(s1);
    const p2 = worldPoints(s2);
    const last1 = p1[p1.length - 1]!;
    const first2 = p2[0]!;
    expect(first2.x).toBeCloseTo(last1.x, 10);
    expect(first2.y).toBeCloseTo(last1.y, 10);
  });

  it('TC-13: Escape or V leaves the pen and creates nothing', async () => {
    await renderApp();
    pinCamera();

    fireEvent.keyDown(window, { key: 'p' });
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.keyDown(window, { key: 'p' });
    expect(penButton()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'v' });
    expect(selectButton()).toHaveAttribute('aria-pressed', 'true');

    expect(strokes()).toHaveLength(0);
  });

  it('TC-14: changing the colour after a stroke keeps the earlier stroke\u2019s colour', async () => {
    await renderApp();
    pinCamera();
    fireEvent.keyDown(window, { key: 'p' });

    // First stroke in the default (black) colour.
    press(0, 0);
    move(40, 20);
    release(60, 10);
    await flushRaf();

    // Switch to blue, draw a second stroke.
    fireEvent.click(screen.getByRole('button', { name: 'blue pen' }));
    press(200, 0);
    move(240, 20);
    release(260, 10);
    await flushRaf();

    const list = strokes();
    expect(list).toHaveLength(2);
    expect(list[0]!.color).toBe('black');
    expect(list[1]!.color).toBe('blue');
  });
});
