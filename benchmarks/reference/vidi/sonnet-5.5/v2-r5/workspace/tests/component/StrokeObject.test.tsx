import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { newDoc } from './helpers';

const hoisted = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));

vi.mock('../../src/client/board/useBoardDoc', async () => {
  const model = await import('../../src/shared/board-model');
  const react = await import('react');
  return {
    useBoardDoc: () => {
      const doc = hoisted.doc;
      const [objects, setObjects] = react.useState(() => model.snapshotObjects(doc));
      react.useEffect(() => {
        const map = doc.getMap('objects');
        const h = () => setObjects(model.snapshotObjects(doc));
        map.observeDeep(h);
        return () => map.unobserveDeep(h);
      }, [doc]);
      return { doc, objects, connection: 'connected' };
    },
  };
});

import { deleteObjects, snapshotObjects } from '../../src/shared/board-model';
import { PEN_COLORS, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { createSticky } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { getObjectType } from '../../src/client/objects/registry';
import { App } from './TestApp';

afterEach(cleanup);
beforeEach(() => { hoisted.doc = newDoc(); });

const strokes = () => snapshotObjects(hoisted.doc).filter((o): o is StrokeSnap => o.type === 'stroke');
const diagonal = () => createStroke(
  hoisted.doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 200 }], color: 'red', thickness: 'thin' }, 'g',
) as string;
const click = (el: Element) => {
  fireEvent.pointerDown(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 0, clientY: 0, pointerId: 1, button: 0 });
};

describe('stroke object', () => {
  it('renders a round-capped path in the stored colour, announced as "Drawing"', () => {
    diagonal();
    render(<App />);
    const svg = screen.getByRole('img', { name: 'Drawing' });
    const visible = svg.querySelector('path:not([data-testid])')!;
    expect(visible.getAttribute('d')).toMatch(/^M/);
    expect(visible.getAttribute('stroke')).toBe(PEN_COLORS.red);
    expect(visible.getAttribute('stroke-linecap')).toBe('round');
    expect(visible.getAttribute('stroke-linejoin')).toBe('round');
    expect(visible.getAttribute('stroke-width')).toBe('2');
    expect(svg.getAttribute('data-id')).toBe(strokes()[0].id);
  });

  it('is registered as a resizable, aspect-locked type with a minimum size', () => {
    const spec = getObjectType('stroke')!;
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, editableText: false });
    expect(spec.minSize).toBeGreaterThan(0);
  });

  it('TC-15 hit test: 5 px hits and 7 px misses, at 50% and 200% zoom', () => {
    const spec = getObjectType('stroke')!;
    createStroke(hoisted.doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thin' }, 'g');
    const s = strokes()[0];
    const lineY = s.y + s.points[1];
    for (const zoom of [0.5, 2]) {
      const px = (n: number) => n / zoom;
      expect(spec.hitTest(s, { x: s.x + 100, y: lineY + px(STROKE_HIT_TOLERANCE_PX - 1) }, { zoom })).toBe(true);
      expect(spec.hitTest(s, { x: s.x + 100, y: lineY + px(STROKE_HIT_TOLERANCE_PX + 1) }, { zoom })).toBe(false);
    }
  });

  it('a thick line is hit within half its thickness even when that exceeds 6 screen pixels', () => {
    const spec = getObjectType('stroke')!;
    createStroke(hoisted.doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }], color: 'black', thickness: 'thick' }, 'g');
    const s = strokes()[0];
    const lineY = s.y + s.points[1];
    // zoom 4: 6 px is 1.5 units, half the thickness is 4 units.
    expect(spec.hitTest(s, { x: s.x + 100, y: lineY + 3.9 }, { zoom: 4 })).toBe(true);
    expect(spec.hitTest(s, { x: s.x + 100, y: lineY + 4.1 }, { zoom: 4 })).toBe(false);
  });

  it('TC-16 clicking inside the box but away from the line selects the sticky underneath, not the stroke', () => {
    createSticky(hoisted.doc, { x: 150, y: 50 }); // sticky covers (50..250, -50..150)
    diagonal();
    render(<App />);
    const spec = getObjectType('stroke')!;
    expect(spec.hitTest(strokes()[0], { x: strokes()[0].x + 180, y: strokes()[0].y + 20 }, { zoom: 1 })).toBe(false);
    // Only the transparent line-hugging path takes pointer events; the stroke's own box lets clicks through.
    const svg = screen.getByRole('img', { name: 'Drawing' });
    expect(svg.style.pointerEvents).toBe('none');
    expect(screen.getByTestId('stroke-hit').style.pointerEvents).toBe('stroke');
    click(screen.getByRole('group', { name: 'Sticky note' }));
    expect(screen.getByRole('group', { name: 'Sticky note' }).getAttribute('data-selected')).toBe('true');
    expect(svg.getAttribute('data-selected')).toBe('false');
  });

  it('clicking the line selects the stroke', () => {
    diagonal();
    render(<App />);
    click(screen.getByTestId('stroke-hit'));
    expect(screen.getByRole('img', { name: 'Drawing' }).getAttribute('data-selected')).toBe('true');
  });

  it('TC-21 a stroke deleted by someone else while selected clears the selection without error', () => {
    const id = diagonal();
    render(<App />);
    click(screen.getByTestId('stroke-hit'));
    expect(screen.getByRole('img', { name: 'Drawing' }).getAttribute('data-selected')).toBe('true');
    expect(() => act(() => { deleteObjects(hoisted.doc, [id]); })).not.toThrow();
    expect(screen.queryByRole('img', { name: 'Drawing' })).toBeNull();
    expect(screen.queryByLabelText(/resize/i)).toBeNull();
  });
});
