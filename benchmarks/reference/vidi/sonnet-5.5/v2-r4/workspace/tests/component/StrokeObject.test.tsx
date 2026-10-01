import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/client/App';
import { createSticky, deleteObjects, snapshot } from '../../src/shared/board-model';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';

afterEach(cleanup);

function board() {
  const doc = new Y.Doc();
  const strokeId = createStroke(doc, { points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 200 }], color: 'red', thickness: 'thin' }, 'g_a')!;
  const stroke = () => snapshot(doc).find((o) => o.id === strokeId) as StrokeSnap;
  return { doc, strokeId, stroke };
}

describe('stroke.object', () => {
  it('renders an SVG path named Drawing with round caps in the stored colour and thickness', () => {
    const { doc } = board();
    render(<App doc={doc} />);
    const group = screen.getByRole('group', { name: 'Drawing' });
    const path = screen.getByTestId('stroke-path');
    expect(group).toBeTruthy();
    expect(path.getAttribute('d')?.startsWith('M')).toBe(true);
    expect(path.getAttribute('stroke')).toBe('#E53935');
    expect(path.getAttribute('stroke-width')).toBe('2');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
  });

  it('TC-15 registry hitTest: 5 px hits and 7 px misses at 50% and 200% zoom', () => {
    const { stroke } = board();
    const hit = getObjectType('stroke')!.hitTest;
    for (const zoom of [0.5, 2]) {
      expect(hit(stroke(), { x: 100, y: 5 / zoom }, zoom)).toBe(true);
      expect(hit(stroke(), { x: 100, y: 7 / zoom }, zoom)).toBe(false);
    }
  });

  it('TC-16 a point inside the bounds but far from the line misses the stroke and hits a sticky there', () => {
    const { doc, stroke } = board();
    const stickyId = createSticky(doc, { x: 300, y: 20 })!;
    const sticky = snapshot(doc).find((o) => o.id === stickyId)!;
    const p = { x: 380, y: 20 };
    const s = stroke();
    expect(p.x).toBeGreaterThan(s.x);
    expect(p.x).toBeLessThan(s.x + s.width);
    expect(p.y).toBeLessThan(s.y + s.height);
    expect(getObjectType('stroke')!.hitTest(s, p, 1)).toBe(false);
    expect(getObjectType('sticky')!.hitTest(sticky, p, 1)).toBe(true);
  });

  it('TC-21 a remote delete while selected clears the selection without error', () => {
    const { doc, strokeId } = board();
    render(<App doc={doc} />);
    fireEvent.pointerDown(screen.getByTestId('stroke-hit'), { button: 0, clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(screen.getByRole('group', { name: 'Drawing' }).getAttribute('data-selected')).toBe('true');
    act(() => {
      doc.transact(() => {
        deleteObjects(doc, [strokeId]);
      }, 'remote');
    });
    expect(screen.queryByRole('group', { name: 'Drawing' })).toBeNull();
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
