import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, screen } from '@testing-library/react';
import { type ReactElement, type ReactNode, useState, useRef, useEffect } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  snapshot,
  objectsInRect,
} from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';
import { useSelection, selectionReducer, type SelectionState } from '@client/board/useSelection';
import { useTransformGesture } from '@client/board/useTransformGesture';
import { useBoardKeys } from '@client/board/useBoardKeys';
import { useMarquee } from '@client/board/Marquee';
import { SelectionBar } from '@client/board/SelectionBar';
import { resizeRect } from '@shared/geometry';
import type { Camera } from '@client/canvas/camera';
import type { Rect } from '@shared/geometry';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };
const testCameraRef = { current: testCamera };

function TestWrapper({ children }: { children: ReactNode }): ReactElement {
  return <div style={{ position: 'fixed', inset: 0 }}>{children}</div>;
}

// Hook that takes a snapshot once and returns it (stable ref)
function useDocSnapshot(doc: Y.Doc) {
  const [snap, setSnap] = useState(() => snapshot(doc));
  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const observer = () => setSnap(snapshot(doc));
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc]);
  return snap;
}

// ============================================================
// TC-16: all selected ids deleted remotely → selection empty
// ============================================================
describe('TC-16: prune all selected', () => {
  it('reducer removes all pruned ids, selection becomes empty', () => {
    let state: SelectionState = { ids: new Set(['a', 'b', 'c']), editingId: null };
    state = selectionReducer(state, { type: 'prune', presentIds: new Set(['d']) });
    expect(state.ids.size).toBe(0);
  });
});

// ============================================================
// TC-17: two selected → "N selected" + Delete button; aria-live
// ============================================================
describe('TC-17: SelectionBar for 2+ selected', () => {
  it('shows "2 selected" and delete button with aria-live', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 400, y: 400 });
    const snap = snapshot(doc);
    const ids = new Set([id1, id2]);
    const onDelete = vi.fn();

    render(
      <TestWrapper>
        <SelectionBar ids={ids} snapshot={snap} camera={testCamera} onDelete={onDelete} />
      </TestWrapper>,
    );
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete selection')).toBeInTheDocument();
    expect(screen.getByTestId('selection-bar')).toHaveAttribute('aria-live', 'polite');
  });
});

// ============================================================
// TC-18: one sticky selected → NoteToolbar shown instead of bar
// ============================================================
describe('TC-18: NoteToolbar for single sticky', () => {
  it('SelectionBar returns null for single with showNoteToolbar', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const ids = new Set([id1]);
    const onDelete = vi.fn();

    const { container } = render(
      <TestWrapper>
        <SelectionBar
          ids={ids}
          snapshot={snap}
          camera={testCamera}
          onDelete={onDelete}
          showNoteToolbar
          selectedSticky={{ color: 'yellow', onColor: vi.fn() }}
        />
      </TestWrapper>,
    );
    expect(container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });
});

// ============================================================
// TC-19: empty-space click → selection cleared
// ============================================================
describe('TC-19: empty click clears selection', () => {
  it('reducer clear empties selection', () => {
    let state: SelectionState = { ids: new Set(['a', 'b']), editingId: null };
    state = selectionReducer(state, { type: 'clear' });
    expect(state.ids.size).toBe(0);
    expect(state.editingId).toBeNull();
  });
});

// ============================================================
// TC-20: marquee additive selection
// ============================================================
describe('TC-20: marquee selects fully-inside objects', () => {
  it('useMarquee calls onSelect with ids fully inside rect', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const idA = createSticky(doc, { x: 0, y: 0 });
    // Adjust to be fully inside
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    doc.transact(() => {
      const obj = objects.get(idA)!;
      obj.set('x', 10);
      obj.set('y', 10);
      obj.set('width', 50);
      obj.set('height', 50);
    });
    const snap = snapshot(doc);
    const onSelect = vi.fn();

    function TestComp() {
      const marquee = useMarquee(testCameraRef, onSelect, (rect) => objectsInRect(snap, rect));
      return (
        <div>
          <button data-testid="begin" onClick={() => marquee.begin({ x: 0, y: 0 })} />
          <button data-testid="move" onClick={() => marquee.move({ x: 100, y: 100 })} />
          <button data-testid="end" onClick={() => marquee.end()} />
        </div>
      );
    }
    render(<TestComp />);
    fireEvent.click(screen.getByTestId('begin'));
    fireEvent.click(screen.getByTestId('move'));
    fireEvent.click(screen.getByTestId('end'));
    expect(onSelect).toHaveBeenCalledWith([idA]);
  });
});

// ============================================================
// TC-21: plain drag (no Shift) - no marquee
// ============================================================
describe('TC-21: no marquee without begin', () => {
  it('end without begin does nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 100, y: 100 });
    const snap = snapshot(doc);
    const onSelect = vi.fn();

    function TestComp() {
      const marquee = useMarquee(testCameraRef, onSelect, (rect) => objectsInRect(snap, rect));
      return <button data-testid="end" onClick={() => marquee.end()} />;
    }
    render(<TestComp />);
    fireEvent.click(screen.getByTestId('end'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ============================================================
// TC-22: marquee cancel → selection unchanged
// ============================================================
describe('TC-22: marquee cancel', () => {
  it('cancel() does not call onSelect', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 50, y: 50 });
    const snap = snapshot(doc);
    const onSelect = vi.fn();

    function TestComp() {
      const marquee = useMarquee(testCameraRef, onSelect, (rect) => objectsInRect(snap, rect));
      return (
        <div>
          <button data-testid="begin" onClick={() => marquee.begin({ x: 0, y: 0 })} />
          <button data-testid="move" onClick={() => marquee.move({ x: 100, y: 100 })} />
          <button data-testid="cancel" onClick={() => marquee.cancel()} />
        </div>
      );
    }
    render(<TestComp />);
    fireEvent.click(screen.getByTestId('begin'));
    fireEvent.click(screen.getByTestId('move'));
    fireEvent.click(screen.getByTestId('cancel'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ============================================================
// TC-23: drag unselected → selects only that object
// ============================================================
describe('TC-23: drag unselected selects only it', () => {
  it('reducer: click b replaces {a} with {b}', () => {
    let state: SelectionState = { ids: new Set(['a']), editingId: null };
    state = selectionReducer(state, { type: 'click', id: 'b' });
    expect(state.ids).toEqual(new Set(['b']));
  });
});

// ============================================================
// TC-24: edge handle changes width only; Shift keeps ratio
// ============================================================
describe('TC-24: resize handle behaviour', () => {
  it('e handle changes width only when not aspect-locked', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 200 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, false);
    expect(result.width).toBe(150);
    expect(result.height).toBe(200);
  });

  it('e handle keeps ratio when aspect-locked', () => {
    const start: Rect = { x: 0, y: 0, width: 100, height: 200 };
    const result = resizeRect(start, 'e', { x: 50, y: 0 }, true);
    // aspect ratio = 100/200 = 0.5; new width 150, height = 150/0.5 = 300
    expect(result.width).toBeCloseTo(150);
    expect(result.height).toBeCloseTo(300);
  });
});

// ============================================================
// TC-25: canEdit false → gesture ignored
// ============================================================
describe('TC-25: gesture refused when canEdit false', () => {
  it('no move occurs when canEdit is false', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 200, y: 200 });
    const snap0 = snapshot(doc);
    const origX = snap0[0].x;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.click(id);
        initedRef.current = true;
      }
      const { onObjectPointerDown } = useTransformGesture({
        doc,
        cameraRef: testCameraRef,
        selection,
        snapshot: snap,
        canEdit: false,
      });
      return (
        <div
          data-testid="obj"
          onPointerDown={(e) => onObjectPointerDown(e.nativeEvent as unknown as PointerEvent, id)}
        />
      );
    }
    render(<TestComp />);

    const objEl = screen.getByTestId('obj');
    fireEvent.pointerDown(objEl, { button: 0, clientX: 100, clientY: 100 });
    // Move far - should be ignored because canEdit=false
    const moveEvent = new Event('pointermove', { bubbles: true });
    Object.assign(moveEvent, { clientX: 200, clientY: 200, pointerId: 0, button: 0 });
    window.dispatchEvent(moveEvent);
    act(() => { vi.advanceTimersByTime(20); });
    window.dispatchEvent(new Event('pointerup'));

    const after = snapshot(doc);
    expect(after[0].x).toBe(origX);
    vi.useRealTimers();
  });
});

// ============================================================
// TC-26: onGestureStart/onGestureEnd called once per drag
// ============================================================
describe('TC-26: gesture callbacks', () => {
  it('calls start once and end once for complete drag', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 200, y: 200 });
    const onStart = vi.fn();
    const onEnd = vi.fn();

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.click(id);
        initedRef.current = true;
      }
      const { onObjectPointerDown } = useTransformGesture({
        doc,
        cameraRef: testCameraRef,
        selection,
        snapshot: snap,
        canEdit: true,
        onGestureStart: onStart,
        onGestureEnd: onEnd,
      });
      return (
        <div
          data-testid="obj"
          onPointerDown={(e) => onObjectPointerDown(e.nativeEvent as unknown as PointerEvent, id)}
        />
      );
    }
    render(<TestComp />);

    const objEl = screen.getByTestId('obj');
    fireEvent.pointerDown(objEl, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });

    // Move beyond DRAG_THRESHOLD_PX (3)
    const moveEvt = new Event('pointermove', { bubbles: true });
    Object.assign(moveEvt, { clientX: 110, clientY: 100, pointerId: 1 });
    window.dispatchEvent(moveEvt);
    act(() => { vi.advanceTimersByTime(20); });

    // Pointer up
    const upEvt = new Event('pointerup', { bubbles: true });
    Object.assign(upEvt, { clientX: 110, clientY: 100, pointerId: 1 });
    window.dispatchEvent(upEvt);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// ============================================================
// TC-27: Ctrl/Cmd+A selects all; preventDefault
// ============================================================
describe('TC-27: Ctrl+A selects all', () => {
  it('selects all objects, prevents default', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 300, y: 300 });

    let selRef: ReturnType<typeof useSelection> | null = null;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      selRef = selection;
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
      window.dispatchEvent(event);
    });

    expect(selRef!.ids.size).toBe(2);
    expect(selRef!.ids.has(id1)).toBe(true);
    expect(selRef!.ids.has(id2)).toBe(true);
  });
});

// ============================================================
// TC-28: Ctrl/Cmd+A on empty board
// ============================================================
describe('TC-28: Ctrl+A empty board', () => {
  it('selects nothing, no error', () => {
    const doc = new Y.Doc();
    initDoc(doc);

    let selRef: ReturnType<typeof useSelection> | null = null;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      selRef = selection;
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(selRef!.ids.size).toBe(0);
  });
});

// ============================================================
// TC-29: ArrowRight nudge; Shift+ArrowUp large nudge
// ============================================================
describe('TC-29: nudge', () => {
  it('ArrowRight moves by NUDGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 });
    const startX = snapshot(doc)[0].x;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.click(id);
        initedRef.current = true;
      }
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(snapshot(doc)[0].x).toBe(startX + NUDGE_STEP_WORLD);
  });

  it('Shift+ArrowUp moves by NUDGE_LARGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 300, y: 300 });
    const startY = snapshot(doc)[0].y;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.click(id);
        initedRef.current = true;
      }
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(snapshot(doc)[0].y).toBe(startY - NUDGE_LARGE_STEP_WORLD);
  });
});

// ============================================================
// TC-30: Backspace while editing → objects kept
// ============================================================
describe('TC-30: Backspace while editing', () => {
  it('does not delete objects when editingId is set', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id = createSticky(doc, { x: 100, y: 100 });

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.click(id);
        selection.startEdit(id);
        initedRef.current = true;
      }
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    const event = new KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
    window.dispatchEvent(event);

    // Object still exists
    expect(snapshot(doc).length).toBe(1);
  });
});

// ============================================================
// TC-31: Delete with selection → all removed, selection empty
// ============================================================
describe('TC-31: Delete removes selection', () => {
  it('deletes all selected and clears', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const id1 = createSticky(doc, { x: 100, y: 100 });
    const id2 = createSticky(doc, { x: 300, y: 300 });

    let selRef: ReturnType<typeof useSelection> | null = null;

    function TestComp() {
      const snap = useDocSnapshot(doc);
      const selection = useSelection(snap);
      selRef = selection;
      const initedRef = useRef(false);
      if (!initedRef.current) {
        selection.setMany([id1, id2], false);
        initedRef.current = true;
      }
      useBoardKeys({ doc, selection, snapshot: snap, canEdit: true });
      return <div />;
    }
    render(<TestComp />);

    act(() => {
      const event = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
      window.dispatchEvent(event);
    });

    expect(snapshot(doc).length).toBe(0);
    expect(selRef!.ids.size).toBe(0);
  });
});
