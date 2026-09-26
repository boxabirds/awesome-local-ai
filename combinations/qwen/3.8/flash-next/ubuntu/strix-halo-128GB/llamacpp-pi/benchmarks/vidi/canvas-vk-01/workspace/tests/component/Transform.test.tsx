import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { Handle } from '../../src/shared/geometry';
import { firePointer } from './helpers';

function renderNotes(notes: Array<{ id: string; x: number; y: number; width?: number; height?: number }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    notes.forEach((n, i) => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', n.x);
      map.set('y', n.y);
      map.set('color', 'yellow');
      map.set('text', new Y.Text(''));
      map.set('z', i + 1);
      map.set('createdAt', 0);
      if (n.width !== undefined) map.set('width', n.width);
      if (n.height !== undefined) map.set('height', n.height);
      objects.set(n.id, map);
    });
  });
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
    selectedIds() {
      return Array.from(document.querySelectorAll('[data-selected="true"]')).length;
    },
  };
}

/** Press a handle, then move/drop on the persistent viewport. */
function dragHandle(handle: Handle, to: [number, number], opts: { shift?: boolean } = {}) {
  const el = screen.getByTestId(`resize-handle-${handle}`);
  firePointer(el, 'pointerdown', 0, 0, { shiftKey: opts.shift });
  const viewport = screen.getByTestId('board-viewport');
  firePointer(viewport, 'pointermove', to[0], to[1], { shiftKey: opts.shift });
  firePointer(viewport, 'pointerup', to[0], to[1], { shiftKey: opts.shift });
}

beforeEach(cleanup);

describe('Transform gesture (TC-23 to TC-26)', () => {
  it('TC-23: dragging an unselected object selects only it and moves only it', async () => {
    const { doc, settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
    ]);
    await settle();
    // Select a only.
    firePointer(screen.getByTestId('sticky-note-a'), 'pointerdown', 150, 150);
    firePointer(screen.getByTestId('sticky-note-a'), 'pointerup', 150, 150);
    await settle();
    expect(selectedIds()).toBe(1);

    // Press b (unselected) and drag it.
    firePointer(screen.getByTestId('sticky-note-b'), 'pointerdown', 450, 150);
    firePointer(screen.getByTestId('sticky-note-b'), 'pointermove', 490, 150);
    firePointer(screen.getByTestId('sticky-note-b'), 'pointerup', 490, 150);
    await settle();

    expect(selectedIds()).toBe(1);
    expect(screen.getByTestId('sticky-note-a').dataset.selected).toBeUndefined();
    expect(screen.getByTestId('sticky-note-b').dataset.selected).toBe('true');
    const snap = snapshot(doc);
    expect(snap.find((o) => o.id === 'a')?.x).toBe(100); // a untouched
    expect(snap.find((o) => o.id === 'b')?.x).toBeCloseTo(440, 0);
  });

  it('TC-23 (boundary): below DRAG_THRESHOLD_PX is a click (no write), at it starts the move', async () => {
    const { doc, settle } = renderNotes([{ id: 'a', x: 100, y: 100 }]);
    await settle();
    const note = () => screen.getByTestId('sticky-note-a');

    // Move by threshold - 1 screen px → stays a click, x is unchanged.
    firePointer(note(), 'pointerdown', 150, 150);
    firePointer(note(), 'pointermove', 150 + DRAG_THRESHOLD_PX - 1, 150);
    firePointer(note(), 'pointerup', 150 + DRAG_THRESHOLD_PX - 1, 150);
    await settle();
    expect(snapshot(doc).find((o) => o.id === 'a')?.x).toBe(100);

    // Move by exactly threshold → the gesture starts and writes.
    firePointer(note(), 'pointerdown', 150, 150);
    firePointer(note(), 'pointermove', 150 + DRAG_THRESHOLD_PX, 150);
    firePointer(note(), 'pointerup', 150 + DRAG_THRESHOLD_PX, 150);
    await settle();
    expect(snapshot(doc).find((o) => o.id === 'a')?.x).toBeCloseTo(100 + DRAG_THRESHOLD_PX, 2);
  });

  it('TC-24: an edge handle changes one axis; Shift keeps the ratio; handles are labelled', async () => {
    const { doc, settle } = renderNotes([{ id: 'a', x: 100, y: 100, width: 200, height: 200 }]);
    await settle();
    firePointer(screen.getByTestId('sticky-note-a'), 'pointerdown', 150, 150);
    firePointer(screen.getByTestId('sticky-note-a'), 'pointerup', 150, 150);
    await settle();

    // Label check for all eight handles.
    const labels: Record<Handle, string> = {
      n: 'top', ne: 'top-right', e: 'right', se: 'bottom-right',
      s: 'bottom', sw: 'bottom-left', w: 'left', nw: 'top-left',
    };
    (Object.keys(labels) as Handle[]).forEach((h) => {
      expect(screen.getByTestId(`resize-handle-${h}`).getAttribute('aria-label')).toBe(
        `Resize ${labels[h]}`,
      );
    });

    // Edge handle "e" changes width only.
    dragHandle('e', [50, 0]);
    await settle();
    let a = snapshot(doc).find((o) => o.id === 'a')!;
    expect(a.width).toBeCloseTo(250, 0);
    expect(a.height).toBeCloseTo(200, 0);

    // Edge handle "e" with Shift keeps the current ratio (height grows too).
    const ratioBefore = a.width! / a.height!;
    dragHandle('e', [50, 0], { shift: true });
    await settle();
    a = snapshot(doc).find((o) => o.id === 'a')!;
    expect(a.height!).toBeGreaterThan(200);
    expect(a.width! / a.height!).toBeCloseTo(ratioBefore, 3);
  });

  it('TC-25: with canEdit false the gesture makes no writes and never starts', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const startX = snapshot(doc).find((o) => o.id === id)!.x;
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();

    const { result } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: { x: 0, y: 0, zoom: 1 },
        snapshot: snapshot(doc),
        selection: new Set([id]),
        canEdit: false,
        onGestureStart,
        onGestureEnd,
      }),
    );

    const down = fakePointer({ clientX: 0, clientY: 0 });
    act(() => result.current.onObjectPointerDown(down as never, id));
    windowPointer('pointermove', 60, 0);
    windowPointer('pointerup', 60, 0);

    expect(snapshot(doc).find((o) => o.id === id)!.x).toBe(startX);
    expect(onGestureStart).not.toHaveBeenCalled();
    expect(onGestureEnd).not.toHaveBeenCalled();
  });

  it('TC-26: onGestureStart/End fire exactly once per drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const startX = snapshot(doc).find((o) => o.id === id)!.x;
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { result } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: { x: 0, y: 0, zoom: 1 },
        snapshot: snapshot(doc),
        selection: new Set([id]),
        canEdit: true,
        onGestureStart,
        onGestureEnd,
      }),
    );

    act(() => result.current.onObjectPointerDown(fakePointer({ clientX: 0, clientY: 0 }) as never, id));
    windowPointer('pointermove', 10, 0); // begins
    windowPointer('pointermove', 20, 0);
    windowPointer('pointerup', 20, 0);

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(snapshot(doc).find((o) => o.id === id)!.x).toBeCloseTo(startX + 20, 2);
  });

  it('TC-26: pointercancel mid-drag keeps the last applied positions', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });
    const startX = snapshot(doc).find((o) => o.id === id)!.x;
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { result } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: { x: 0, y: 0, zoom: 1 },
        snapshot: snapshot(doc),
        selection: new Set([id]),
        canEdit: true,
        onGestureStart,
        onGestureEnd,
      }),
    );

    act(() => result.current.onObjectPointerDown(fakePointer({ clientX: 0, clientY: 0 }) as never, id));
    windowPointer('pointermove', 10, 0); // begins, applies +10
    windowPointer('pointercancel', 10, 0); // interrupted

    expect(snapshot(doc).find((o) => o.id === id)!.x).toBeCloseTo(startX + 10, 2); // not rolled back
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});

interface FakePointerInit {
  clientX: number;
  clientY: number;
  button?: number;
  shiftKey?: boolean;
  pointerId?: number;
}

function fakePointer(init: FakePointerInit) {
  return {
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX,
    clientY: init.clientY,
    stopPropagation: () => undefined,
    preventDefault: () => undefined,
  };
}

function windowPointer(type: 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number): void {
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}
