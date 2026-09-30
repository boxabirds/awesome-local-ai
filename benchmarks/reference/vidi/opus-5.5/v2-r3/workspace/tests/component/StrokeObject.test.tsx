import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSticky, getObjectsMap, objectsSnapshot } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MIN_SIZE_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { smoothPath } from '../../src/shared/geometry/simplify';
import { createStroke, type PenThickness, type StrokeSnap } from '../../src/shared/objects/stroke';
import { worldToScreen, type Camera } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { boardDoc, flushFrame, model, noteEl, readCamera, renderApp, useFakeFrames } from './helpers';

const strokeEl = (id: string) => document.querySelector<HTMLElement>(`[data-stroke-id="${id}"]`)!;
const hitPath = (id: string) => strokeEl(id).querySelector('[data-testid="stroke-hit"]')!;
const snap = (id: string) => objectsSnapshot(boardDoc()).find((o) => o.id === id) as StrokeSnap;

function addStroke(points: Point[], thickness: PenThickness = 'thin'): string {
  return model((doc) => createStroke(doc, { points, color: 'blue', thickness }, 'c_x'))!;
}

function setCamera(cam: Camera) {
  act(() => window.__vidi6!.setCamera(cam));
  flushFrame();
}

function click(el: Element, p: Point) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, clientX: p.x, clientY: p.y });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: p.x, clientY: p.y });
}

describe('stroke.object', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('registry entry: resizable, aspect-locked, STROKE_MIN_SIZE_WORLD, no text', () => {
    expect(getObjectType('stroke')).toMatchObject({
      Component: StrokeObject,
      resizable: true,
      aspectLocked: true,
      minSize: STROKE_MIN_SIZE_WORLD,
      editableText: false,
    });
  });

  it('renders a smoothed round path in its colour and thickness, announced as "Drawing"', () => {
    renderApp();
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 0 }];
    const id = addStroke(pts, 'thick');
    const el = strokeEl(id);
    expect(screen.getByRole('group', { name: 'Drawing' })).toBe(el);
    const line = el.querySelector('[data-testid="stroke-line"]')!;
    const s = snap(id);
    expect(line.getAttribute('d')).toBe(
      smoothPath(pts.map((p) => ({ x: p.x - s.x, y: p.y - s.y })), PEN_THICKNESS_WORLD.thick),
    );
    expect(line.getAttribute('d')).toMatch(/^M .* Q /);
    expect(line.getAttribute('stroke')).toBe(PEN_COLORS.blue);
    expect(line.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(line.getAttribute('stroke-linecap')).toBe('round');
    expect(line.getAttribute('stroke-linejoin')).toBe('round');
    // Resizing scales the line, not its thickness.
    const before = line.getAttribute('d');
    model((doc) => getObjectsMap(doc).get(id)!.set('width', s.width * 2));
    model((doc) => getObjectsMap(doc).get(id)!.set('height', s.height * 2));
    expect(strokeEl(id).querySelector('[data-testid="stroke-line"]')!.getAttribute('stroke-width')).toBe(
      String(PEN_THICKNESS_WORLD.thick),
    );
    expect(strokeEl(id).querySelector('[data-testid="stroke-line"]')!.getAttribute('d')).not.toBe(before);
  });

  for (const zoom of [0.5, 2]) {
    it(`TC-15 at ${zoom * 100}% the hit test and a click select at 5 px from the line and miss at 7 px`, () => {
      renderApp();
      setCamera({ x: -100, y: -100, zoom });
      const cam = readCamera(screen.getByTestId('board-viewport'));
      expect(cam.zoom).toBe(zoom);
      const id = addStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
      const spec = getObjectType('stroke')!;
      const s = snap(id);
      expect(spec.hitTest(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: -5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: 7 / zoom }, zoom)).toBe(false);
      expect(spec.hitTest(s, { x: 100, y: -7 / zoom }, zoom)).toBe(false);
      const mid = worldToScreen(cam, { x: 100, y: 0 });
      click(hitPath(id), { x: mid.x, y: mid.y + 7 });
      expect(strokeEl(id).dataset.selected).toBe('false');
      click(hitPath(id), { x: mid.x, y: mid.y + 5 });
      expect(strokeEl(id).dataset.selected).toBe('true');
      // The hit stroke is 2 × 6 screen px wide at this zoom.
      expect(Number(hitPath(id).getAttribute('stroke-width'))).toBeCloseTo(12 / zoom, 9);
    });
  }

  it('a thick stroke is hit anywhere within half its thickness', () => {
    const spec = getObjectType('stroke')!;
    renderApp();
    const id = addStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'thick');
    // At 400% the 6 px tolerance is 1.5 units, less than half the thickness (4).
    expect(spec.hitTest(snap(id), { x: 100, y: 3.9 }, 4)).toBe(true);
    expect(spec.hitTest(snap(id), { x: 100, y: 4.1 }, 4)).toBe(false);
  });

  it('TC-16 a click inside a stroke\'s box but far from its line, over a sticky note, selects the note only', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const noteId = model((doc) => createSticky(doc, { x: 100, y: 100 })); // box (0,0)–(200,200)
    // A V on top of the note: its box covers the note's top half; (100, 20) is far from the line.
    const id = addStroke([{ x: -20, y: -20 }, { x: 100, y: 180 }, { x: 220, y: -20 }], 'medium');
    const s = snap(id);
    expect(s.z).toBeGreaterThan(objectsSnapshot(boardDoc()).find((o) => o.id === noteId)!.z);
    const inside = { x: 100, y: 20 };
    expect(inside.x > s.x && inside.x < s.x + s.width && inside.y > s.y && inside.y < s.y + s.height).toBe(true);
    const spec = getObjectType('stroke')!;
    expect(spec.hitTest(s, inside, cam.zoom)).toBe(false);
    // The stroke's box ignores the pointer; only its line takes presses.
    expect(strokeEl(id).className).toContain('stroke-object');
    const p = worldToScreen(cam, inside);
    click(hitPath(id), p); // even if the press lands on the line's hit area it is re-checked
    expect(strokeEl(id).dataset.selected).toBe('false');
    click(noteEl(noteId), p);
    expect(noteEl(noteId).dataset.selected).toBe('true');
    expect(strokeEl(id).dataset.selected).toBe('false');
  });

  it('TC-21 a selected stroke deleted by someone else: selection cleared, no error', () => {
    const { viewport } = renderApp();
    const cam = readCamera(viewport);
    const id = addStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    click(hitPath(id), worldToScreen(cam, { x: 100, y: 0 }));
    expect(strokeEl(id).dataset.selected).toBe('true');
    expect(() =>
      act(() => {
        boardDoc().transact(() => getObjectsMap(boardDoc()).delete(id), 'remote');
      }),
    ).not.toThrow();
    expect(document.querySelector(`[data-stroke-id="${id}"]`)).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });
});
