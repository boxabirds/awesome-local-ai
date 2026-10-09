import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useMemo, type JSX, type MutableRefObject } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection, type SelectionApi } from '../../src/client/board/useSelection';
import { useBoardKeys } from '../../src/client/board/useBoardKeys';
import { createUndo, type UndoController } from '../../src/client/board/undo';
import { UndoContext } from '../../src/client/board/useUndo';
import { snapshot, type StickySnapshot } from '../../src/shared/board-model';
import { makeSticky } from '../fixtures/stickies';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';

interface UndoRegistry {
  doc: Y.Doc;
  selection: SelectionApi;
  undo: UndoController;
}

let registry: MutableRefObject<UndoRegistry | null>;

// Mirrors BoardShell: a real undo controller provided to the tree and passed
// to the keyboard hook, so every boundary is exercised through the product
// components rather than a fake.
function UndoHarness(props: { canEdit: boolean }): JSX.Element {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection(notes);
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: props.canEdit, undo });
  registry.current = { doc, selection, undo };
  return (
    <UndoContext.Provider value={undo}>
      <BoardViewport doc={doc} notes={notes} selection={selection} editable={props.canEdit} />
    </UndoContext.Provider>
  );
}

function mountHarness(canEdit = true): void {
  registry = { current: null };
  render(<UndoHarness canEdit={canEdit} />);
}

function ctrl(): UndoRegistry {
  return registry.current!;
}

function noteEl(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-testid="sticky-${id}"]`)!;
}

function sticky(id: string): StickySnapshot {
  const found = snapshot(ctrl().doc).find((n) => n.id === id);
  if (found === undefined) throw new Error(`note ${id} missing`);
  return found as StickySnapshot;
}

function flushFrames(): void {
  act(() => {
    vi.advanceTimersByTime(32);
  });
}

// Drag a selected note through `frames` moves of `step` px each.
function dragSelected(id: string, frames: number, step: number, end: 'up' | 'cancel' = 'up'): void {
  const el = noteEl(id);
  act(() => {
    fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
  });
  for (let i = 0; i < frames; i += 1) {
    act(() => {
      fireEvent.pointerMove(window, { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX + (i + 1) * step, clientY: 100 });
    });
    flushFrames();
  }
  if (end === 'up') fireEvent.pointerUp(window, { pointerId: 1 });
  else fireEvent.pointerCancel(window, { pointerId: 1 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('undo boundaries (undo.boundaries)', () => {
  test('TC-14: a 30-frame drag is one step restoring the start position', () => {
    mountHarness();
    const { doc, selection } = ctrl();
    let a = '';
    let b = '';
    act(() => {
      // Separate boundaries keep each creation its own step.
      ctrl().undo.boundary();
      a = makeSticky(doc, 0, 0);
      ctrl().undo.boundary();
      b = makeSticky(doc, 500, 0);
      ctrl().undo.boundary();
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = sticky(a);
    const beforeB = sticky(b);
    dragSelected(a, 30, 5);
    expect(sticky(a).x).toBe(before.x + DRAG_THRESHOLD_PX + 30 * 5);
    // One undo for the whole gesture: exact start state back, b untouched.
    act(() => {
      ctrl().undo.undo();
    });
    const restored = sticky(a);
    expect(restored.x).toBe(before.x);
    expect(restored.y).toBe(before.y);
    expect(restored.z).toBe(before.z);
    const untouchedB = sticky(b);
    expect(untouchedB.x).toBe(beforeB.x);
    expect(untouchedB.y).toBe(beforeB.y);
    // The drag was a single step: the next undos reach the creations, b's
    // first, then a's.
    expect(ctrl().undo.canUndo()).toBe(true);
    act(() => {
      ctrl().undo.undo();
    });
    expect(snapshot(doc).find((n) => n.id === b)).toBeUndefined();
    expect(snapshot(doc).find((n) => n.id === a)!.x).toBe(before.x);
  });

  test('TC-15: a colour change right after a drag is a separate step', () => {
    mountHarness();
    const { doc, selection } = ctrl();
    let a = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = sticky(a);
    dragSelected(a, 3, 10);
    const moved = sticky(a);
    expect(moved.x).toBe(before.x + DRAG_THRESHOLD_PX + 30);
    // Colour click within the capture window: the gesture-end boundary keeps
    // it out of the drag step.
    fireEvent.click(screen.getByLabelText('Pink colour'));
    expect(sticky(a).color).toBe('pink');
    act(() => {
      ctrl().undo.undo();
    });
    expect(sticky(a).color).toBe(before.color);
    expect(sticky(a).x).toBe(moved.x);
    act(() => {
      ctrl().undo.undo();
    });
    expect(sticky(a).x).toBe(before.x);
  });

  test('TC-16: Ctrl+Z inside the editor undoes typing but not the earlier move', () => {
    mountHarness();
    const { doc, selection } = ctrl();
    let a = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = sticky(a);
    dragSelected(a, 3, 20);
    act(() => {
      selection.startEdit(a);
    });
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'a' } });
    fireEvent.input(editor, { target: { value: 'ab' } });
    fireEvent.input(editor, { target: { value: 'abc' } });
    expect(sticky(a).text).toBe('abc');
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
    // The typing burst is undone as one step; the drag survives.
    expect(sticky(a).text).toBe('');
    expect(sticky(a).x).toBe(before.x + DRAG_THRESHOLD_PX + 60);
  });

  test('TC-17: a gesture cancelled mid-drag is still one step restoring the start', () => {
    mountHarness();
    const { doc, selection } = ctrl();
    let a = '';
    act(() => {
      a = makeSticky(doc, 0, 0);
    });
    act(() => {
      selection.setMany([a], false);
    });
    const before = sticky(a);
    dragSelected(a, 4, 8, 'cancel');
    expect(sticky(a).x).toBe(before.x + DRAG_THRESHOLD_PX + 32);
    act(() => {
      ctrl().undo.undo();
    });
    expect(sticky(a).x).toBe(before.x);
    expect(sticky(a).y).toBe(before.y);
  });
});
