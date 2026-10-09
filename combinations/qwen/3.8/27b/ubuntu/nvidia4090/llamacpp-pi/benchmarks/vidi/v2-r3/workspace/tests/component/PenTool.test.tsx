/**
 * Story 11 component tests (TC-09 to TC-14): the Pen tool's gesture state
 * machine and the pen options, on the real <Board> (real Y.Doc) with
 * synthetic pointer events.
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels. The rAF
 * timers are faked so the preview loop is driven deterministically.
 */
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { snapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS } from '../../src/shared/config';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { longSpiral } from '../fixtures/pen-paths';
import { renderBoard } from './board-harness';

// Quiet provider (same pattern as the other board component tests).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    const g = globalThis as Record<string, unknown>;
    g.__vidi6_conn_handler = onState;
    onState((g.__vidi6_conn_state as string | undefined) ?? 'connected');
    return {
      destroy() {
        if (g.__vidi6_conn_handler === onState) delete g.__vidi6_conn_handler;
      },
    };
  },
}));

let h: ReturnType<typeof renderBoard>;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  h = renderBoard();
  h.setCamera(0, 0, 1);
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  delete (globalThis as Record<string, unknown>).__vidi6_conn_handler;
  cleanup();
});

const penBtn = () => screen.getByRole('button', { name: 'Pen (P)' }) as HTMLButtonElement;
const selectBtn = () => screen.getByRole('button', { name: 'Select (V)' }) as HTMLButtonElement;
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const layer = () => h.container.querySelector('[data-pen-tool-layer]') as HTMLElement;
const previewPath = () => h.container.querySelector('[data-pen-preview]') as SVGPathElement | null;

const strokeItems = (): Array<[string, Y.Map<unknown>]> =>
  ([...h.doc.getMap('objects').entries()] as Array<[string, Y.Map<unknown>]>).filter(
    ([, m]) => m.get('type') === 'stroke',
  );
const byZ = (a: [string, Y.Map<unknown>], b: [string, Y.Map<unknown>]) =>
  ((a[1].get('z') as number) - (b[1].get('z') as number));
const strokeSnap = (id: string): StrokeSnap => {
  const o = snapshot(h.doc).find((s) => s.id === id);
  if (!o) throw new Error(`missing stroke ${id}`);
  return o as StrokeSnap;
};

/** Press, drag through `pts`, release (all on the pen layer, pointer 1). */
function drawPath(pts: Array<{ x: number; y: number }>): void {
  fireEvent.pointerDown(layer(), { clientX: pts[0].x, clientY: pts[0].y, pointerId: 1 });
  for (let i = 1; i < pts.length; i++) {
    fireEvent.pointerMove(layer(), { clientX: pts[i].x, clientY: pts[i].y, pointerId: 1 });
  }
  const last = pts[pts.length - 1];
  fireEvent.pointerUp(layer(), { clientX: last.x, clientY: last.y, pointerId: 1 });
}

describe('pen.tool (TC-09 to TC-14)', () => {
  it('TC-09: a red thick drag → the preview follows, one red/thick stroke is created, the tool stays on Pen', () => {
    fireEvent.keyDown(window, { key: 'p' });
    expect(layer()).not.toBeNull();
    expect(pressed(penBtn())).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));

    const pts = [
      { x: 100, y: 100 },
      { x: 150, y: 120 },
      { x: 200, y: 140 },
    ];
    fireEvent.pointerDown(layer(), { clientX: pts[0].x, clientY: pts[0].y, pointerId: 1 });
    fireEvent.pointerMove(layer(), { clientX: pts[1].x, clientY: pts[1].y, pointerId: 1 });
    fireEvent.pointerMove(layer(), { clientX: pts[2].x, clientY: pts[2].y, pointerId: 1 });
    // The local preview follows the pointer (one frame later); the doc is still empty.
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(previewPath()).not.toBeNull();
    expect(previewPath()!.getAttribute('d')).not.toBe('');
    expect(previewPath()!.getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(strokeItems()).toHaveLength(0);

    fireEvent.pointerUp(layer(), { clientX: pts[2].x, clientY: pts[2].y, pointerId: 1 });

    const strokes = strokeItems();
    expect(strokes).toHaveLength(1);
    const map = strokes[0][1];
    expect(map.get('color')).toBe('red');
    expect(map.get('thickness')).toBe('thick');
    // The preview is gone and the tool is still on Pen.
    expect(previewPath()).toBeNull();
    expect(pressed(penBtn())).toBe(true);
  });

  it('TC-10: a press-and-release with no movement → a single-point dot with a thickness-square bbox', () => {
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.pointerDown(layer(), { clientX: 300, clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(layer(), { clientX: 300, clientY: 200, pointerId: 1 });
    const strokes = strokeItems();
    expect(strokes).toHaveLength(1);
    const map = strokes[0][1];
    const t = PEN_THICKNESS_WORLD.medium;
    expect(map.get('width')).toBe(t);
    expect(map.get('height')).toBe(t);
    expect(map.get('x')).toBe(300 - t / 2);
    expect(map.get('y')).toBe(200 - t / 2);
    expect((map.get('points') as number[])).toHaveLength(2);
  });

  it('TC-11: pointerdown, moves, pointercancel → the stroke is committed with the points drawn so far', () => {
    fireEvent.keyDown(window, { key: 'p' });
    fireEvent.pointerDown(layer(), { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(layer(), { clientX: 140, clientY: 130, pointerId: 1 });
    fireEvent.pointerMove(layer(), { clientX: 180, clientY: 160, pointerId: 1 });
    fireEvent.pointerCancel(layer(), { clientX: 180, clientY: 160, pointerId: 1 });
    const strokes = strokeItems();
    expect(strokes).toHaveLength(1);
    const pts = scaledPoints(strokeSnap(strokes[0][0]));
    // The points are collinear: RDP keeps the endpoints, so the stroke
    // spans exactly what was drawn.
    expect(pts[0]).toEqual({ x: 100, y: 100 });
    expect(pts[pts.length - 1]).toEqual({ x: 180, y: 160 });
    // The tool is still on Pen.
    expect(pressed(penBtn())).toBe(true);
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two committed strokes; the second starts where the first ends', () => {
    fireEvent.keyDown(window, { key: 'p' });
    const pts = [...longSpiral.slice(0, STROKE_MAX_POINTS + 10)];
    // One extra move (repeating the last point) makes the drag exactly
    // STROKE_MAX_POINTS + 10 moves.
    pts.push({ ...pts[pts.length - 1] });
    expect(pts.length - 1).toBe(STROKE_MAX_POINTS + 10);
    fireEvent.pointerDown(layer(), { clientX: pts[0].x, clientY: pts[0].y, pointerId: 1 });
    for (let i = 1; i < pts.length; i++) {
      fireEvent.pointerMove(layer(), { clientX: pts[i].x, clientY: pts[i].y, pointerId: 1 });
    }
    const last = pts[pts.length - 1];
    fireEvent.pointerUp(layer(), { clientX: last.x, clientY: last.y, pointerId: 1 });

    const strokes = strokeItems().sort(byZ);
    expect(strokes).toHaveLength(2);
    const first = scaledPoints(strokeSnap(strokes[0][0]));
    const second = scaledPoints(strokeSnap(strokes[1][0]));
    const end = first[first.length - 1];
    expect(second[0].x).toBeCloseTo(end.x, 8);
    expect(second[0].y).toBeCloseTo(end.y, 8);
  });

  it('TC-13: Escape, then V → the tool is Select; nothing is created', () => {
    fireEvent.keyDown(window, { key: 'p' });
    expect(layer()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(layer()).toBeNull();
    expect(pressed(selectBtn())).toBe(true);
    fireEvent.keyDown(window, { key: 'v' });
    expect(pressed(selectBtn())).toBe(true);
    expect(h.doc.getMap('objects').size).toBe(0);
  });

  it('TC-14: changing the colour after a stroke exists → the existing one is unchanged; the next stroke uses the new colour', () => {
    fireEvent.keyDown(window, { key: 'p' });
    drawPath([
      { x: 100, y: 100 },
      { x: 160, y: 120 },
      { x: 220, y: 100 },
    ]);
    expect(strokeItems()).toHaveLength(1);
    const firstId = strokeItems()[0][0];

    fireEvent.click(screen.getByRole('button', { name: 'Red pen' }));
    drawPath([
      { x: 300, y: 300 },
      { x: 360, y: 320 },
      { x: 420, y: 300 },
    ]);
    const strokes = strokeItems().sort(byZ);
    expect(strokes).toHaveLength(2);
    expect(strokes[0][0]).toBe(firstId);
    expect(strokes[0][1].get('color')).toBe('black'); // unchanged
    expect(strokes[1][1].get('color')).toBe('red'); // the new option
  });
});
