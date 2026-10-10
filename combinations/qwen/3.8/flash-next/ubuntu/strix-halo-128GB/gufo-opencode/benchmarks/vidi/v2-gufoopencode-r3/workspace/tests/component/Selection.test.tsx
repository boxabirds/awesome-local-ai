import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  createSticky,
  deleteObjects,
  initDoc,
  snapshot,
  snapshotAll
} from '../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { SelectionController } from '../../src/client/board/useSelection';
import { worldToScreen } from '../../src/client/canvas/camera';
import { initialCamera } from './helpers';
import { createTestbox, registerTestbox } from '../fixtures/testbox';

const holder = vi.hoisted(() => ({ status: 'connected' as string }));
vi.mock('../../src/client/sync/ConnectionStatus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/ConnectionStatus')>();
  return { ...actual, useConnectionStatus: () => holder.status as never };
});

const { BoardView } = await import('../../src/client/pages/BoardPage');

const cam0 = initialCamera();
const s = (wx: number, wy: number) => worldToScreen(cam0, { x: wx, y: wy });

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<BoardView doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc, cx = 0, cy = 0): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: cx, y: cy });
  });
  return id;
}

function noteAt(i = 0): HTMLElement {
  return screen.getAllByTestId('sticky-note')[i];
}

function tap(el: HTMLElement): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1 });
}

function shiftTap(el: HTMLElement): void {
  fireEvent.pointerDown(el, {
    clientX: 100,
    clientY: 100,
    pointerId: 1,
    button: 0,
    shiftKey: true
  });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1, shiftKey: true });
}

function key(k: string, init: Record<string, unknown> = {}): boolean {
  const prevented = fireEvent.keyDown(document.body, { key: k, ...init });
  act(() => {
    vi.advanceTimersByTime(50);
  });
  return prevented;
}

function viewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function marquee(fromWorld: { x: number; y: number }, toWorld: { x: number; y: number }): void {
  const from = s(fromWorld.x, fromWorld.y);
  const to = s(toWorld.x, toWorld.y);
  const el = viewport();
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0, shiftKey: true });
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId: 1, shiftKey: true });
  fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y, pointerId: 1 });
  act(() => {
    vi.advanceTimersByTime(0);
  });
}

function barText(): string | null {
  const count = screen.queryByTestId('selection-bar')?.querySelector('.selection-count');
  return count === null || count === undefined ? null : count.textContent;
}

function docOf(doc: Y.Doc): { id: string; x: number; y: number }[] {
  return snapshot(doc).map((n) => ({ id: n.id, x: n.x, y: n.y }));
}

beforeEach(() => {
  vi.useFakeTimers();
  holder.status = 'connected';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sel.interaction (SelectionBar)', () => {
  it('TC-16 remote deletion of every selected note prunes to Empty and hides the bar', () => {
    const doc = mount();
    const a = addNote(doc, 0, 0);
    const b = addNote(doc, 600, 0);
    tap(noteAt(0));
    shiftTap(noteAt(1));
    expect(barText()).toBe('2 selected');
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
  });

  it('TC-17 two selected: "2 selected" with aria-live and a working Delete button', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    tap(noteAt(0));
    shiftTap(noteAt(1));
    const bar = screen.getByTestId('selection-bar');
    expect(bar).toHaveTextContent('2 selected');
    expect(bar.querySelector('.selection-count')?.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('TC-18 exactly one sticky shows the note toolbar, not the bar', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    tap(noteAt(0));
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('TC-19 press-release on empty space without dragging clears the selection', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    tap(noteAt(0));
    shiftTap(noteAt(1));
    expect(barText()).toBe('2 selected');
    fireEvent.pointerDown(viewport(), { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 5, clientY: 5, pointerId: 1 });
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});

describe('sel.marquee_ui (Shift+drag)', () => {
  it('TC-20 Shift+drag adds fully-inside objects to the existing selection', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    tap(noteAt(0));
    marquee({ x: 400, y: -300 }, { x: 900, y: 300 });
    expect(barText()).toBe('2 selected');
  });

  it('TC-21 plain drag pans the board and never starts a marquee (negative)', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    tap(noteAt(0));
    const before = screen.getByTestId('world-layer').style.transform;
    const el = viewport();
    fireEvent.pointerDown(el, { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerMove(el, { clientX: 105, clientY: 5, pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    fireEvent.pointerUp(el, { clientX: 105, clientY: 5, pointerId: 1 });
    expect(screen.getByTestId('world-layer').style.transform).not.toBe(before);
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    // Selection is unchanged: single sticky keeps its toolbar.
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    tap(noteAt(0));
    const from = s(400, -300);
    const to = s(900, 300);
    const el = viewport();
    fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0, shiftKey: true });
    fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId: 1, shiftKey: true });
    fireEvent.pointerCancel(el, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y, pointerId: 1 });
    expect(screen.queryByTestId('marquee-rect')).not.toBeInTheDocument();
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });
});

describe('sel.transform (gesture)', () => {
  it('TC-23 dragging an unselected note selects only it and moves only it', () => {
    const doc = mount();
    const a = addNote(doc, 0, 0);
    const b = addNote(doc, 600, 0);
    tap(noteAt(0));
    const el = noteAt(1);
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 110, clientY: 100, pointerId: 1 });
    vi.advanceTimersByTime(50);
    fireEvent.pointerUp(window, { clientX: 110, clientY: 100, pointerId: 1 });
    const states = new Map(docOf(doc).map((n) => [n.id, n]));
    expect(states.get(a)).toEqual({ id: a, x: -100, y: -100 });
    expect(states.get(b)).toEqual({ id: b, x: 510, y: -100 });
    // Selection became {b} only: single toolbar for the moved note.
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(noteAt(1)).toHaveAttribute('data-selected', 'true');
    expect(noteAt(0)).toHaveAttribute('data-selected', 'false');
  });

  it('TC-24 non-locked type: edge handle changes width only; Shift keeps the ratio', () => {
    registerTestbox();
    const doc = mount();
    act(() => {
      createTestbox(doc, { x: -100, y: -50, width: 200, height: 100 });
    });
    const box = screen.getByTestId('testbox');
    tap(box);
    expect(screen.getByTestId('selection-overlay')).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByLabelText('Resize right'), {
      clientX: s(100, 0).x,
      clientY: s(0, 0).y,
      pointerId: 1,
      button: 0
    });
    fireEvent.pointerMove(window, { clientX: s(100, 0).x + 50, clientY: s(0, 0).y, pointerId: 1 });
    vi.advanceTimersByTime(50);
    fireEvent.pointerUp(window, { clientX: s(100, 0).x + 50, clientY: s(0, 0).y, pointerId: 1 });
    let boxObj = snapshotAll(doc).find((o) => o.type === 'testbox')!;
    expect(boxObj.width).toBe(250);
    expect(boxObj.height).toBe(100);

    fireEvent.pointerDown(screen.getByLabelText('Resize bottom-right'), {
      clientX: s(150, 50).x,
      clientY: s(150, 50).y,
      pointerId: 1,
      button: 0,
      shiftKey: true
    });
    fireEvent.pointerMove(window, {
      clientX: s(150, 50).x + 100,
      clientY: s(150, 50).y + 20,
      pointerId: 1,
      shiftKey: true
    });
    vi.advanceTimersByTime(50);
    fireEvent.pointerUp(window, {
      clientX: s(150, 50).x + 100,
      clientY: s(150, 50).y + 20,
      pointerId: 1
    });
    boxObj = snapshotAll(doc).find((o) => o.type === 'testbox')!;
    expect(boxObj.width! / boxObj.height!).toBeCloseTo(2.5, 6);
  });

  it('TC-25 load-failed board refuses gestures and writes nothing (negative)', () => {
    holder.status = 'load_failed';
    const doc = mount();
    const a = addNote(doc, 0, 0);
    const el = noteAt(0);
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 140, pointerId: 1 });
    vi.advanceTimersByTime(50);
    fireEvent.pointerUp(window, { clientX: 140, clientY: 140, pointerId: 1 });
    expect(docOf(doc)).toEqual([{ id: a, x: -100, y: -100 }]);
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('TC-26 onGestureStart and onGestureEnd fire exactly once per drag', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 });
    });
    const objects = snapshotAll(doc);
    const selection = {
      ids: new Set([id]),
      editingId: null,
      click: vi.fn(),
      toggle: vi.fn(),
      setMany: vi.fn(),
      clear: vi.fn(),
      selectNew: vi.fn(),
      startEdit: vi.fn(),
      endEdit: vi.fn()
    } satisfies SelectionController;
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { result } = renderHook(() =>
      useTransformGesture({
        doc,
        camera: cam0,
        objects,
        selection,
        canEdit: true,
        onGestureStart: onStart,
        onGestureEnd: onEnd
      })
    );
    const down = {
      clientX: 100,
      clientY: 100,
      button: 0,
      pointerId: 1,
      shiftKey: false
    } as unknown as ReactPointerEvent<HTMLElement>;
    act(() => {
      result.current.onObjectPointerDown(down, id);
    });
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.pointerMove(document.body, { clientX: 104, clientY: 100, pointerId: 1 });
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(document.body, { clientX: 110, clientY: 100, pointerId: 1 });
    vi.advanceTimersByTime(50);
    expect(onStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(document.body, { clientX: 110, clientY: 100, pointerId: 1 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});

describe('sel.keyboard', () => {
  it('TC-27 Ctrl/Cmd+A selects all objects and is defaultPrevented', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    expect(key('a', { ctrlKey: true })).toBe(false);
    expect(barText()).toBe('2 selected');
  });

  it('TC-28 Ctrl/Cmd+A on an empty board is a no-op without errors', () => {
    mount();
    key('a', { ctrlKey: true });
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('TC-29 arrow keys nudge the selection by the configured steps and never scroll', () => {
    const doc = mount();
    const a = addNote(doc, 0, 0);
    tap(noteAt(0));
    expect(key('ArrowRight')).toBe(false);
    expect(docOf(doc)).toEqual([{ id: a, x: -100 + NUDGE_STEP_WORLD, y: -100 }]);
    expect(key('ArrowUp', { shiftKey: true })).toBe(false);
    expect(docOf(doc)).toEqual([
      { id: a, x: -100 + NUDGE_STEP_WORLD, y: -100 - NUDGE_LARGE_STEP_WORLD }
    ]);
  });

  it('TC-30 while editing text, Backspace edits text instead of deleting (negative)', () => {
    const doc = mount();
    const a = addNote(doc, 0, 0);
    tap(noteAt(0));
    key('Enter');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    key('Backspace');
    expect(snapshot(doc).map((n) => n.id)).toEqual([a]);
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const doc = mount();
    addNote(doc, 0, 0);
    addNote(doc, 600, 0);
    tap(noteAt(0));
    shiftTap(noteAt(1));
    key('Delete');
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });
});
