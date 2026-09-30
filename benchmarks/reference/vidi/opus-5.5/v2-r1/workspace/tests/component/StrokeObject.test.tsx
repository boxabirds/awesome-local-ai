// stroke.object (TC-15, TC-16, TC-21): stroke rendering, select by line, fall-through selection
// and a remote delete of a selected stroke.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createSticky, deleteObjects, initDoc } from '../../src/shared/board-model';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';
import { type PenThickness, createStroke } from '../../src/shared/objects/stroke';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { getObjectType } from '../../src/client/objects/registry';
import { useFakeFrames } from './helpers';
import { strokesOf } from './penHelpers';
import { objectEl, resetCameraTracking, selectedIds, setCamera, toClient } from './shapeHelpers';
import { noteEl, renderApp } from './stickyHelpers';

beforeEach(() => {
  useFakeFrames();
  resetCameraTracking();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function docWithStroke(points: Point[], thickness: PenThickness = 'thin', doc = new Y.Doc()) {
  initDoc(doc);
  const id = createStroke(doc, { points, color: 'red', thickness }, 'g_test')!;
  return { doc, id };
}

const clickViewport = (at: Point, target: Element = screen.getByTestId('board-viewport')) => {
  const c = toClient(at);
  fireEvent.pointerDown(target, { clientX: c.x, clientY: c.y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(target, { clientX: c.x, clientY: c.y, pointerId: 1 });
};

describe('stroke.object rendering', () => {
  it('draws a smooth round-capped path in the stroke colour, announced as "Drawing"', () => {
    const { doc } = docWithStroke([{ x: 0, y: 0 }, { x: 50, y: 30 }, { x: 100, y: 0 }], 'thick');
    const [s] = strokesOf(doc);
    render(<StrokeObject stroke={s} selected={false} />);
    const el = screen.getByRole('img', { name: 'Drawing' });
    const path = el.querySelector('path')!;
    expect(path.getAttribute('d')).toMatch(/^M .* Q /);
    expect(path.getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    expect(path.getAttribute('fill')).toBe('none');
  });

  it('a resized stroke keeps its line width', () => {
    const { doc, id } = docWithStroke([{ x: 0, y: 0 }, { x: 100, y: 50 }], 'medium');
    const obj = doc.getMap('objects').get(id) as Y.Map<unknown>;
    doc.transact(() => {
      obj.set('width', (obj.get('width') as number) * 3);
      obj.set('height', (obj.get('height') as number) * 3);
    });
    render(<StrokeObject stroke={strokesOf(doc)[0]} selected />);
    const path = screen.getByRole('img', { name: 'Drawing' }).querySelector('path')!;
    expect(path.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    // The line spans the scaled box: 3 * (100 + 4) wide minus the scaled padding.
    expect(path.getAttribute('d')).toBe('M 6 6 L 306 156');
  });
});

describe('stroke.object select by line', () => {
  for (const zoom of [0.5, 2]) {
    it(`TC-15 at ${zoom * 100}%: registry hit test and a click 5 px from the line hit; 7 px misses`, () => {
      const { doc, id } = docWithStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'thin');
      const [s] = strokesOf(doc);
      const spec = getObjectType('stroke')!;
      expect(spec.hitTest(s, { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(spec.hitTest(s, { x: 100, y: 7 / zoom }, zoom)).toBe(false);

      renderApp(doc);
      setCamera({ x: -100, y: -100, zoom });
      clickViewport({ x: 100, y: 7 / zoom });
      expect(selectedIds()).toEqual([]);
      clickViewport({ x: 100, y: -5 / zoom });
      expect(selectedIds()).toEqual([id]);
      clickViewport({ x: 100, y: -7 / zoom });
      expect(selectedIds()).toEqual([]);
    });
  }

  it('a thick stroke is hit anywhere within half its thickness, even beyond 6 px', () => {
    const { doc } = docWithStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }], 'thick');
    const [s] = strokesOf(doc);
    const spec = getObjectType('stroke')!;
    // At 400%, 6 px is 1.5 units, but half the thickness is 4.
    expect(spec.hitTest(s, { x: 100, y: 3.9 }, 4)).toBe(true);
    expect(spec.hitTest(s, { x: 100, y: 4.1 }, 4)).toBe(false);
  });

  it('TC-16 a click inside the stroke\'s box far from its line, over a sticky note, selects the note', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const note = createSticky(doc, { x: 0, y: 0 }) as string;
    // An L around the note, drawn on top of it: its box covers the note.
    const { id: stroke } = docWithStroke(
      [{ x: -150, y: -150 }, { x: 150, y: -150 }, { x: 150, y: 150 }],
      'medium',
      doc,
    );
    renderApp(doc);
    // The browser delivers the press to the note (strokes take no pointer events).
    clickViewport({ x: 0, y: 0 }, noteEl());
    expect(selectedIds()).toEqual([note]);

    // Empty space inside the box selects nothing.
    clickViewport({ x: -140, y: 140 });
    expect(selectedIds()).toEqual([]);

    // On the line: the stroke, even where the note is underneath.
    clickViewport({ x: 0, y: -150 });
    expect(selectedIds()).toEqual([stroke]);
    // Selected strokes get the generic selection box with handles.
    expect(screen.getByTestId('selection-box')).toBeTruthy();
  });

  it('TC-21 a selected stroke deleted by someone else: selection cleared, no error', () => {
    const { doc, id } = docWithStroke([{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    renderApp(doc);
    clickViewport({ x: 100, y: 0 });
    expect(selectedIds()).toEqual([id]);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    deleteObjects(remote, [id]);
    act(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote'));
    expect(objectEl(id)).toBeNull();
    expect(selectedIds()).toEqual([]);
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });
});
