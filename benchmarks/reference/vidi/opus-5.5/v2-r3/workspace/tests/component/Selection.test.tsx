import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createSticky,
  getObjectsMap,
  getStickyText,
  initDoc,
  objectsSnapshot,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionBar } from '../../src/client/board/SelectionBar';
import { createTestBox, registerTestBox } from '../fixtures/testbox';
import { boardDoc, flushFrame, model, noteEl, noteElements, noteToolbar, press, readCamera, renderApp, useFakeFrames } from './helpers';

registerTestBox();

const HALF = STICKY_SIZE_WORLD / 2;

/** Creates a sticky whose top-left is (x, y) in world units. */
function noteAt(x: number, y: number): string {
  return model((doc) => createSticky(doc, { x: x + HALF, y: y + HALF }));
}

function objectEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (!el) throw new Error(`object ${id} not rendered`);
  return el;
}

function selectedIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-object-id][data-selected="true"]')]
    .map((el) => el.dataset.objectId!)
    .sort();
}

function objects(): readonly ObjectSnapshot[] {
  return objectsSnapshot(boardDoc());
}

function rectOf(id: string) {
  const o = objects().find((s) => s.id === id);
  return o ? { x: o.x, y: o.y, width: o.width, height: o.height } : undefined;
}

function shiftPress(el: Element, at = { clientX: 100, clientY: 100 }) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, shiftKey: true, ...at });
  fireEvent.pointerUp(el, { pointerId: 1, shiftKey: true, ...at });
}

function selectionBar(): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: 'Selection' });
}

function key(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

/** Screen point (viewport px; jsdom has no layout, so client = local) of a world point. */
function toScreen(viewport: HTMLElement, p: { x: number; y: number }) {
  const cam = readCamera(viewport);
  return { clientX: (p.x - cam.x) * cam.zoom, clientY: (p.y - cam.y) * cam.zoom };
}

function drag(el: Element, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, init = {}) {
  fireEvent.pointerDown(el, { pointerId: 1, button: 0, ...from, ...init });
  fireEvent.pointerMove(el, { pointerId: 1, ...to, ...init });
  flushFrame();
  fireEvent.pointerUp(el, { pointerId: 1, ...to, ...init });
  flushFrame();
}

describe('selection state and bar (sel.interaction)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('click selects only that object; Shift-click adds and removes', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    const c = noteAt(600, 0);
    press(objectEl(a));
    expect(selectedIds()).toEqual([a]);
    shiftPress(objectEl(b));
    shiftPress(objectEl(c));
    expect(selectedIds()).toEqual([a, b, c].sort());
    shiftPress(objectEl(a));
    expect(selectedIds()).toEqual([b, c].sort());
    press(objectEl(c));
    expect(selectedIds()).toEqual([c]);
  });

  it('TC-16 every selected object deleted remotely → selection empty, bar hidden', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    expect(selectionBar()).toBeInTheDocument();
    act(() => {
      boardDoc().transact(() => {
        getObjectsMap(boardDoc()).delete(a);
        getObjectsMap(boardDoc()).delete(b);
      }, 'remote');
    });
    expect(selectionBar()).toBeNull();
    expect(noteToolbar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(screen.getByTestId('selection-announcer')).toHaveTextContent('');
  });

  it('a remote delete of one of three selected leaves the other two selected', () => {
    renderApp();
    const [a, b, c] = [noteAt(0, 0), noteAt(300, 0), noteAt(600, 0)];
    press(objectEl(a));
    shiftPress(objectEl(b));
    shiftPress(objectEl(c));
    act(() => {
      boardDoc().transact(() => getObjectsMap(boardDoc()).delete(b), 'remote');
    });
    expect(selectedIds()).toEqual([a, c].sort());
    expect(selectionBar()).toHaveTextContent('2 selected');
  });

  it('TC-17 two selected → "2 selected" + Delete selection; announced politely', () => {
    renderApp();
    const keep = noteAt(900, 900);
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    const bar = selectionBar()!;
    expect(bar).toHaveTextContent('2 selected');
    expect(noteToolbar()).toBeNull();
    const announcer = screen.getByTestId('selection-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(objects().map((o) => o.id)).toEqual([keep]);
    expect(selectionBar()).toBeNull();
    expect(selectedIds()).toEqual([]);
  });

  it('TC-18 one sticky selected → the note toolbar instead of the bar', () => {
    renderApp();
    const a = noteAt(0, 0);
    press(objectEl(a));
    expect(noteToolbar()).toBeInTheDocument();
    expect(selectionBar()).toBeNull();
    expect(screen.getByTestId('selection-announcer')).toHaveTextContent('1 selected');
  });

  it('SelectionBar renders nothing for a single non-sticky object or an empty selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const box = createTestBox(doc, { x: 0, y: 0, width: 50, height: 50 });
    const snap = objectsSnapshot(doc);
    const { container, rerender } = render(<SelectionBar ids={new Set([box])} snapshot={snap} onDelete={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SelectionBar ids={new Set()} snapshot={snap} onDelete={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('TC-19 empty-space click without drag clears a multi-selection', () => {
    const { viewport } = renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    press(viewport, { clientX: 20, clientY: 20 });
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('a plain click on one of several selected objects selects only it', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    press(objectEl(b));
    expect(selectedIds()).toEqual([b]);
  });
});

describe('marquee (sel.marquee_ui)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('TC-20 Shift+drag adds fully-inside objects to the existing selection; partly inside is not selected', () => {
    const { viewport } = renderApp();
    const x = noteAt(-600, -300);
    const a = noteAt(0, 0);
    const half = noteAt(250, 0); // 250..450, box ends at 350
    const out = noteAt(0, 600);
    press(objectEl(x));
    const from = toScreen(viewport, { x: -10, y: -10 });
    const to = toScreen(viewport, { x: 350, y: 250 });
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, shiftKey: true, ...from });
    fireEvent.pointerMove(viewport, { pointerId: 1, shiftKey: true, ...to });
    expect(viewport.dataset.state).toBe('marquee');
    const rect = screen.getByTestId('marquee');
    expect(rect.style.left).toBe('-10px');
    expect(rect.style.width).toBe('360px');
    fireEvent.pointerUp(viewport, { pointerId: 1, shiftKey: true, ...to });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x, a].sort());
    expect(selectedIds()).not.toContain(half);
    expect(selectedIds()).not.toContain(out);
    expect(viewport.dataset.state).toBe('idle');
  });

  it('a marquee enclosing nothing leaves the selection unchanged', () => {
    const { viewport } = renderApp();
    const a = noteAt(0, 0);
    press(objectEl(a));
    const from = toScreen(viewport, { x: 1000, y: 1000 });
    const to = toScreen(viewport, { x: 1100, y: 1100 });
    drag(viewport, from, to, { shiftKey: true });
    expect(selectedIds()).toEqual([a]);
  });

  it('TC-21 plain drag on empty space pans; no marquee', () => {
    const { viewport } = renderApp();
    noteAt(0, 0);
    const cam0 = readCamera(viewport);
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
    expect(viewport.dataset.state).toBe('panning');
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 200, clientY: 200 });
    flushFrame();
    expect(readCamera(viewport)).not.toEqual(cam0);
    expect(selectedIds()).toEqual([]);
  });

  it('TC-22 pointercancel (or Escape) mid-marquee → selection unchanged', () => {
    const { viewport } = renderApp();
    const x = noteAt(-600, -300);
    const a = noteAt(0, 0);
    press(objectEl(x));
    const from = toScreen(viewport, { x: -10, y: -10 });
    const to = toScreen(viewport, { x: 250, y: 250 });
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, shiftKey: true, ...from });
    fireEvent.pointerMove(viewport, { pointerId: 1, shiftKey: true, ...to });
    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x]);

    fireEvent.pointerDown(viewport, { pointerId: 2, button: 0, shiftKey: true, ...from });
    fireEvent.pointerMove(viewport, { pointerId: 2, shiftKey: true, ...to });
    key('Escape');
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(viewport, { pointerId: 2, shiftKey: true, ...to });
    expect(selectedIds()).toEqual([x]); // Escape cancelled the marquee, not the selection
    expect(a).toBeTruthy();
  });
});

describe('transform gesture and handles (sel.transform)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('TC-23 drag unselected b while {a} selected → selection {b}; only b moves; threshold boundary', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    let updates = 0;
    boardDoc().on('update', () => updates++);
    // DRAG_THRESHOLD_PX − 1 is still a click: selects b, writes nothing.
    fireEvent.pointerDown(objectEl(b), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(objectEl(b), { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100 });
    flushFrame();
    fireEvent.pointerUp(objectEl(b), { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100 });
    expect(updates).toBe(0);
    expect(selectedIds()).toEqual([b]);

    press(objectEl(a));
    fireEvent.pointerDown(objectEl(b), { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    expect(selectedIds()).toEqual([b]);
    fireEvent.pointerMove(objectEl(b), { pointerId: 1, clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100 });
    expect(objectEl(b).dataset.state).toBe('dragging');
    flushFrame();
    fireEvent.pointerMove(objectEl(b), { pointerId: 1, clientX: 150, clientY: 130 });
    flushFrame();
    fireEvent.pointerUp(objectEl(b), { pointerId: 1, clientX: 150, clientY: 130 });
    expect(rectOf(b)).toMatchObject({ x: 350, y: 30 });
    expect(rectOf(a)).toMatchObject({ x: 0, y: 0 });
    expect(selectedIds()).toEqual([b]);
  });

  it('dragging a selected object moves the whole selection, above unselected objects, order kept', () => {
    renderApp();
    const s1 = noteAt(0, 0);
    const s2 = noteAt(50, 50);
    const other = noteAt(400, 0);
    press(objectEl(s1));
    shiftPress(objectEl(s2));
    drag(objectEl(s1), { clientX: 100, clientY: 100 }, { clientX: 400, clientY: 100 });
    expect(rectOf(s1)).toMatchObject({ x: 300, y: 0 });
    expect(rectOf(s2)).toMatchObject({ x: 350, y: 50 });
    const z = (id: string) => Number(objectEl(id).style.zIndex);
    expect(z(s1)).toBeGreaterThan(z(other));
    expect(z(s2)).toBeGreaterThan(z(s1));
    expect(selectedIds()).toEqual([s1, s2].sort());
    expect(selectionBar()).toHaveTextContent('2 selected');
  });

  it('TC-24 testbox: edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    renderApp();
    const box = model((doc) => createTestBox(doc, { x: 0, y: 0, width: 200, height: 100 }));
    press(objectEl(box));
    const labels = screen.getAllByRole('button', { name: /^Resize / }).map((h) => h.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(
      [
        'Resize top-left',
        'Resize top',
        'Resize top-right',
        'Resize right',
        'Resize bottom-right',
        'Resize bottom',
        'Resize bottom-left',
        'Resize left',
      ].sort(),
    );
    const right = screen.getByRole('button', { name: 'Resize right' });
    expect(right.style.width).toBe(`${HANDLE_SIZE_PX}px`);
    drag(right, { clientX: 500, clientY: 300 }, { clientX: 600, clientY: 340 });
    expect(rectOf(box)).toEqual({ x: 0, y: 0, width: 300, height: 100 });

    drag(screen.getByRole('button', { name: 'Resize right' }), { clientX: 0, clientY: 0 }, { clientX: 300, clientY: 0 }, { shiftKey: true });
    // 300×100 → 600 wide with Shift: height doubles too, about the vertical centre.
    expect(rectOf(box)).toEqual({ x: 0, y: -50, width: 600, height: 200 });
  });

  it('corner handle on a sticky keeps it square; shrinking stops at STICKY_MIN_SIZE_WORLD', () => {
    renderApp();
    const a = noteAt(0, 0);
    press(objectEl(a));
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), { clientX: 0, clientY: 0 }, { clientX: 100, clientY: 20 });
    expect(rectOf(a)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(noteEl(a).style.width).toBe('300px');
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), { clientX: 0, clientY: 0 }, { clientX: -1000, clientY: -1000 });
    expect(rectOf(a)).toEqual({ x: 0, y: 0, width: STICKY_MIN_SIZE_WORLD, height: STICKY_MIN_SIZE_WORLD });
  });

  it('group resize with the right edge doubles sizes and gaps from the left edge', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    drag(screen.getByRole('button', { name: 'Resize right' }), { clientX: 0, clientY: 0 }, { clientX: 500, clientY: 0 });
    const ra = rectOf(a)!;
    const rb = rectOf(b)!;
    expect(ra.width).toBe(400);
    expect(ra.height).toBe(400);
    expect(rb.width).toBe(400);
    expect(rb.x - (ra.x + ra.width)).toBe(200);
    expect(ra.x).toBe(0);
  });

  it('handles and the bar are hidden while a note is being edited', () => {
    renderApp();
    const a = noteAt(0, 0);
    fireEvent.doubleClick(objectEl(a));
    expect(screen.queryByRole('button', { name: /^Resize / })).toBeNull();
    expect(noteToolbar()).toBeNull();
  });
});

/** Renders the gesture hook on its own with a real Y.Doc and real elements. */
function gestureHarness(opts: { canEdit: boolean; onGestureStart?(): void; onGestureEnd?(): void }) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = [0, 300, 600].map((x) => createSticky(doc, { x: x + HALF, y: HALF }));
  const els = ids.map((id) => {
    const el = document.createElement('div');
    el.dataset.id = id;
    document.body.appendChild(el);
    return el;
  });
  const hook = renderHook(() => {
    const snap = objectsSnapshot(doc);
    const selection = useSelection(snap);
    const gesture = useTransformGesture({
      doc,
      camera: { x: 0, y: 0, zoom: 1 },
      selection,
      snapshot: snap,
      canEdit: opts.canEdit,
      onGestureStart: opts.onGestureStart,
      onGestureEnd: opts.onGestureEnd,
    });
    return { selection, gesture };
  });
  const down = (i: number, at: { clientX: number; clientY: number }, shiftKey = false) =>
    act(() => {
      hook.result.current.gesture.onObjectPointerDown(
        { button: 0, pointerId: 1, shiftKey, currentTarget: els[i], ...at } as unknown as ReactPointerEvent<Element>,
        ids[i],
      );
    });
  const pos = (i: number) => snapshot(doc).find((n) => n.id === ids[i]);
  return { doc, ids, els, hook, down, pos };
}

describe('useTransformGesture (sel.transform)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it('TC-25 canEdit false: selecting works but a drag writes nothing', () => {
    const h = gestureHarness({ canEdit: false });
    let updates = 0;
    h.doc.on('update', () => updates++);
    h.down(0, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: 200, clientY: 100 });
    flushFrame();
    fireEvent.pointerUp(h.els[0], { pointerId: 1, clientX: 200, clientY: 100 });
    flushFrame();
    expect(updates).toBe(0);
    expect(h.pos(0)).toMatchObject({ x: 0, y: 0 });
    expect([...h.hook.result.current.selection.ids]).toEqual([h.ids[0]]);
  });

  it('TC-26 onGestureStart and onGestureEnd are called once per drag; pointercancel keeps the last applied positions', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const h = gestureHarness({ canEdit: true, onGestureStart, onGestureEnd });
    h.down(0, { clientX: 0, clientY: 0 });
    h.down(1, { clientX: 0, clientY: 0 }, true); // ignored: gesture on 0 still pressed
    fireEvent.pointerUp(h.els[0], { pointerId: 1, clientX: 0, clientY: 0 });
    h.down(1, { clientX: 0, clientY: 0 }, true); // shift adds 1
    fireEvent.pointerUp(h.els[1], { pointerId: 1, clientX: 0, clientY: 0 });
    expect(onGestureStart).not.toHaveBeenCalled(); // clicks are not gestures
    expect([...h.hook.result.current.selection.ids].sort()).toEqual([h.ids[0], h.ids[1]].sort());

    h.down(0, { clientX: 0, clientY: 0 });
    for (const x of [10, 20, 30]) {
      fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: x, clientY: 5 });
      flushFrame();
    }
    fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: 90, clientY: 90 }); // never applied
    fireEvent.pointerCancel(h.els[0], { pointerId: 1 });
    flushFrame();
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(h.pos(0)).toMatchObject({ x: 30, y: 5 });
    expect(h.pos(1)).toMatchObject({ x: 330, y: 5 });
    expect(h.pos(2)).toMatchObject({ x: 600, y: 0 });
    // Later moves on the element do nothing.
    fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: 400, clientY: 400 });
    flushFrame();
    expect(h.pos(0)).toMatchObject({ x: 30, y: 5 });

    h.down(1, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(h.els[1], { pointerId: 1, clientX: 10, clientY: 0 });
    fireEvent.pointerUp(h.els[1], { pointerId: 1, clientX: 20, clientY: 0 });
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
    // The pending frame (last move) is applied at pointerup; both selected objects moved.
    expect(h.pos(1)).toMatchObject({ x: 340, y: 5 });
    expect(h.pos(0)).toMatchObject({ x: 40, y: 5 });
  });

  it('an object pruned mid-gesture is skipped; the rest keep moving', () => {
    const h = gestureHarness({ canEdit: true });
    h.down(0, { clientX: 0, clientY: 0 });
    fireEvent.pointerUp(h.els[0], { pointerId: 1, clientX: 0, clientY: 0 });
    h.down(1, { clientX: 0, clientY: 0 }, true);
    fireEvent.pointerUp(h.els[1], { pointerId: 1, clientX: 0, clientY: 0 });
    h.down(0, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: 10, clientY: 0 });
    flushFrame();
    act(() => {
      h.doc.transact(() => getObjectsMap(h.doc).delete(h.ids[1]), 'remote');
    });
    fireEvent.pointerMove(h.els[0], { pointerId: 1, clientX: 50, clientY: 0 });
    flushFrame();
    fireEvent.pointerUp(h.els[0], { pointerId: 1, clientX: 50, clientY: 0 });
    expect(h.pos(0)).toMatchObject({ x: 50 });
    expect(getObjectsMap(h.doc).has(h.ids[1])).toBe(false); // not re-created
  });
});

describe('keyboard (sel.keyboard)', () => {
  beforeEach(() => useFakeFrames());
  afterEach(() => vi.useRealTimers());

  it.each([{ ctrlKey: true }, { metaKey: true }])('TC-27 Ctrl/Cmd+A selects every object with preventDefault (%o)', (mod) => {
    renderApp();
    const ids = [noteAt(0, 0), noteAt(300, 0), noteAt(600, 0)];
    const box = model((doc) => createTestBox(doc, { x: 0, y: 400, width: 50, height: 50 }));
    const ev = key('a', mod);
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([...ids, box].sort());
    expect(selectionBar()).toHaveTextContent('4 selected');
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing, without error', () => {
    renderApp();
    const ev = key('a', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(screen.getByTestId('selection-announcer')).toHaveTextContent('');
  });

  it('TC-29 ArrowRight nudges by NUDGE_STEP_WORLD, Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    const c = noteAt(600, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    const right = key('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(rectOf(a)).toMatchObject({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(rectOf(b)).toMatchObject({ x: 300 + NUDGE_STEP_WORLD, y: 0 });
    const up = key('ArrowUp', { shiftKey: true });
    expect(up.defaultPrevented).toBe(true);
    expect(rectOf(a)).toMatchObject({ x: 1, y: -NUDGE_LARGE_STEP_WORLD });
    expect(rectOf(c)).toMatchObject({ x: 600, y: 0 });
    expect([NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD]).toEqual([1, 10]);
  });

  it('arrows with nothing selected do nothing and keep the default', () => {
    renderApp();
    noteAt(0, 0);
    expect(key('ArrowRight').defaultPrevented).toBe(false);
  });

  it('TC-30 Backspace while editing edits text; the selected objects are kept', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    model((doc) => getStickyText(doc, a)!.insert(0, 'Hello'));
    press(objectEl(a));
    shiftPress(objectEl(b));
    fireEvent.doubleClick(objectEl(a));
    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    expect(textarea).toHaveFocus();
    await user.keyboard('{End}{Backspace}');
    await user.keyboard('{Delete}');
    expect(noteElements()).toHaveLength(2);
    expect(snapshot(boardDoc()).find((n) => n.id === a)!.text).toBe('Hell');
    // Ctrl+A inside the editor is the textarea's own select-all.
    const ev = key('a', { ctrlKey: true }, textarea);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    renderApp();
    const keep = noteAt(900, 0);
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    const ev = key('Delete');
    expect(ev.defaultPrevented).toBe(true);
    expect(objects().map((o) => o.id)).toEqual([keep]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('Escape clears the selection', () => {
    renderApp();
    const a = noteAt(0, 0);
    const b = noteAt(300, 0);
    press(objectEl(a));
    shiftPress(objectEl(b));
    key('Escape');
    expect(selectedIds()).toEqual([]);
  });
});
