import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, objectBounds } from '@shared/board-model';
import { unionRects } from '@shared/geometry';
import { SelectionOverlay } from '@client/board/SelectionOverlay';
import type { Camera } from '@client/canvas/camera';
import { worldToScreen } from '@client/canvas/camera';

const IDLE_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function makeDoc(notes: Array<{ x: number; y: number }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = notes.map((n) => createSticky(doc, n));
  return { doc, ids };
}

describe('sel.overlay (SelectionOverlay)', () => {
  it('renders a bounding box around the union of the selected objects', () => {
    const { doc, ids } = makeDoc([{ x: 150, y: 150 }, { x: 450, y: 150 }]);
    const snap = snapshot(doc);
    const bounds = unionRects([objectBounds(snap[0]), objectBounds(snap[1])])!;
    // union: x 50..550, y 50..250
    expect(bounds).toEqual({ x: 50, y: 50, width: 500, height: 200 });

    const { container } = render(
      <SelectionOverlay
        ids={new Set(ids)}
        snapshot={snap}
        camera={IDLE_CAMERA}
        onHandlePointerDown={vi.fn()}
      />,
    );
    const box = container.querySelector('[data-testid="selection-bounds"]') as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.left).toBe('50px');
    expect(box.style.top).toBe('50px');
    expect(box.style.width).toBe('500px');
    expect(box.style.height).toBe('200px');
  });

  const px = (v: string) => Number(v.slice(0, -2));

  it('renders all 8 handles at the box edges/corners, 8px each', () => {
    const { doc, ids } = makeDoc([{ x: 150, y: 150 }]);
    const snap = snapshot(doc);
    const { container } = render(
      <SelectionOverlay
        ids={new Set(ids)}
        snapshot={snap}
        camera={IDLE_CAMERA}
        onHandlePointerDown={vi.fn()}
      />,
    );
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const handle = container.querySelector(`[data-testid="resize-handle-${h}"]`) as HTMLElement;
      expect(handle, `handle ${h}`).not.toBeNull();
      expect(handle.style.width).toBe('8px');
      expect(handle.style.height).toBe('8px');
    }
  });

  it('handle positions follow the box in screen space at zoom 2', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 2 };
    const { doc, ids } = makeDoc([{ x: 150, y: 150 }]);
    const snap = snapshot(doc);
    const { container } = render(
      <SelectionOverlay
        ids={new Set(ids)}
        snapshot={snap}
        camera={camera}
        onHandlePointerDown={vi.fn()}
      />,
    );
    // note: 50..250 world → 100..500 screen
    const se = container.querySelector('[data-testid="resize-handle-se"]') as HTMLElement;
    expect(px(se.style.left)).toBeCloseTo(500 - 4, 5); // centred on corner
    expect(px(se.style.top)).toBeCloseTo(500 - 4, 5);
    const nw = container.querySelector('[data-testid="resize-handle-nw"]') as HTMLElement;
    expect(px(nw.style.left)).toBeCloseTo(100 - 4, 5);
    expect(px(nw.style.top)).toBeCloseTo(100 - 4, 5);
    const e = container.querySelector('[data-testid="resize-handle-e"]') as HTMLElement;
    expect(px(e.style.left)).toBeCloseTo(500 - 4, 5);
    expect(px(e.style.top)).toBeCloseTo(300 - 4, 5); // mid-height
    void worldToScreen;
  });

  it('nothing renders with an empty selection', () => {
    const { doc } = makeDoc([{ x: 150, y: 150 }]);
    const snap = snapshot(doc);
    const { container } = render(
      <SelectionOverlay
        ids={new Set<string>()}
        snapshot={snap}
        camera={IDLE_CAMERA}
        onHandlePointerDown={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-testid="selection-bounds"]')).toBeNull();
  });

  it('handles call onHandlePointerDown with the handle id', () => {
    const onHandlePointerDown = vi.fn();
    const { doc, ids } = makeDoc([{ x: 150, y: 150 }]);
    const snap = snapshot(doc);
    const { container } = render(
      <SelectionOverlay
        ids={new Set(ids)}
        snapshot={snap}
        camera={IDLE_CAMERA}
        onHandlePointerDown={onHandlePointerDown}
      />,
    );
    const se = container.querySelector('[data-testid="resize-handle-se"]') as HTMLElement;
    act(() => { se.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true })); });
    expect(onHandlePointerDown).toHaveBeenCalledTimes(1);
    expect(onHandlePointerDown.mock.calls[0][1]).toBe('se');
  });
});
