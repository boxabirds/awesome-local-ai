import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { getObjectType } from '../../src/client/objects/registry';
import {
  type ObjectSnapshot,
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  objectsMap,
  objectsSnapshot,
  snapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { TESTBOX_MIN_SIZE, createTestBox } from '../fixtures/testbox';
import { FRAME_MS, flushFrame, noteToolbar, pointer, renderApp, renderedCamera } from './helpers';

// jsdom has no layout: the viewport is the window and the camera starts centred on world (0, 0) at 100%.
const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const screenOf = (world: { x: number; y: number }) => ({ x: CENTRE.x + world.x, y: CENTRE.y + world.y });

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

/** A sticky note whose top-left is at `at` (world). */
function note(doc: Y.Doc, at: { x: number; y: number }, text = ''): string {
  const id = createSticky(doc, { x: at.x + STICKY_SIZE_WORLD / 2, y: at.y + STICKY_SIZE_WORLD / 2 });
  if (id === false) throw new Error('create rejected');
  if (text) getStickyText(doc, id)?.insert(0, text);
  return id;
}

function countUpdates(doc: Y.Doc) {
  const counter = { count: 0 };
  doc.on('update', () => counter.count++);
  return counter;
}

function rectOf(doc: Y.Doc, id: string) {
  const o = objectsSnapshot(doc).find((s) => s.id === id);
  return o ? { x: o.x, y: o.y, width: o.width, height: o.height } : null;
}

const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const selectedIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-id][data-selected="true"]')].map((el) => el.dataset.id!).sort();
const selectionBar = () => screen.queryByRole('toolbar', { name: 'Selection' });
const announcer = () => screen.getByTestId('selection-announcer');
const handle = (name: string) => screen.getByRole('button', { name: `Resize ${name}` });

function shiftPointer(el: HTMLElement, type: 'down' | 'move' | 'up' | 'cancel', p: { x: number; y: number }) {
  const init = { clientX: p.x, clientY: p.y, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, shiftKey: true };
  const fn = { down: fireEvent.pointerDown, move: fireEvent.pointerMove, up: fireEvent.pointerUp, cancel: fireEvent.pointerCancel }[type];
  return fn(el, init);
}

function click(el: HTMLElement, p: { x: number; y: number }) {
  pointer(el, 'down', p.x, p.y);
  pointer(el, 'up', p.x, p.y);
  flushFrame();
}

function selectAll() {
  return fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
}

describe('sel.interaction (SelectionBar, useSelection)', () => {
  it('TC-16 all selected objects deleted remotely → selection empty, bar hidden', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    renderApp(doc);
    selectAll();
    expect(selectionBar()).not.toBeNull();
    act(() => {
      deleteObjects(doc, [a, b]);
    });
    expect(selectionBar()).toBeNull();
    expect(noteToolbar()).toBeNull();
    expect(announcer().textContent).toBe('');
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });

  it('TC-17 two selected → "2 selected" + Delete selection; the count is announced politely', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    renderApp(doc);
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    shiftPointer(objectEl(b), 'down', screenOf({ x: 400, y: 100 }));
    shiftPointer(objectEl(b), 'up', screenOf({ x: 400, y: 100 }));
    const bar = selectionBar();
    expect(bar?.textContent).toContain('2 selected');
    expect(noteToolbar()).toBeNull();
    expect(announcer().getAttribute('aria-live')).toBe('polite');
    expect(announcer().textContent).toBe('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectionBar()).toBeNull();
  });

  it('TC-18 one sticky selected → the note toolbar instead of the bar', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    note(doc, { x: 300, y: 0 });
    renderApp(doc);
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    expect(noteToolbar()).not.toBeNull();
    expect(selectionBar()).toBeNull();
    expect(announcer().textContent).toBe('1 selected');
  });

  it('TC-19 empty-space click without drag clears the selection', () => {
    const doc = newDoc();
    note(doc, { x: 0, y: 0 });
    note(doc, { x: 300, y: 0 });
    const { viewport } = renderApp(doc);
    selectAll();
    expect(selectedIds()).toHaveLength(2);
    click(viewport(), { x: 20, y: 20 });
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('actions naming objects not on the board are ignored', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const objects = objectsSnapshot(doc);
    const { result } = renderHook(() => useSelection(objects));
    act(() => result.current.click(a));
    act(() => result.current.click('ghost'));
    act(() => result.current.toggle('ghost'));
    act(() => result.current.setMany(['ghost'], true));
    expect([...result.current.ids]).toEqual([a]);
  });
});

describe('sel.marquee_ui (useMarquee)', () => {
  it('TC-20 Shift+drag adds the fully-inside objects to the existing selection', () => {
    const doc = newDoc();
    const x = note(doc, { x: -400, y: 0 });
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 250, y: 0 });
    const partly = note(doc, { x: 500, y: 0 });
    const { viewport } = renderApp(doc);
    click(objectEl(x), screenOf({ x: -300, y: 100 }));
    shiftPointer(viewport(), 'down', screenOf({ x: -20, y: -20 }));
    shiftPointer(viewport(), 'move', screenOf({ x: 300, y: 150 }));
    expect(screen.getByTestId('marquee')).toBeTruthy();
    expect(viewport().dataset.state).toBe('selecting');
    shiftPointer(viewport(), 'move', screenOf({ x: 600, y: 220 }));
    shiftPointer(viewport(), 'up', screenOf({ x: 600, y: 220 }));
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x, a, b].sort());
    expect(selectedIds()).not.toContain(partly);
  });

  it('TC-21 a plain drag on empty space pans and draws no marquee', () => {
    const doc = newDoc();
    note(doc, { x: 0, y: 0 });
    const { viewport, world } = renderApp(doc);
    const before = renderedCamera(world());
    pointer(viewport(), 'down', 20, 20);
    pointer(viewport(), 'move', 220, 120);
    expect(viewport().dataset.state).toBe('panning');
    expect(screen.queryByTestId('marquee')).toBeNull();
    pointer(viewport(), 'up', 220, 120);
    flushFrame();
    expect(renderedCamera(world())).not.toEqual(before);
    expect(selectedIds()).toEqual([]);
  });

  it('TC-22 pointercancel (or Escape) mid-marquee leaves the selection unchanged', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    const { viewport, world } = renderApp(doc);
    const camera = renderedCamera(world());
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    shiftPointer(viewport(), 'down', screenOf({ x: -50, y: -50 }));
    shiftPointer(viewport(), 'move', screenOf({ x: 600, y: 300 }));
    shiftPointer(viewport(), 'cancel', screenOf({ x: 600, y: 300 }));
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([a]);

    shiftPointer(viewport(), 'down', screenOf({ x: -50, y: -50 }));
    shiftPointer(viewport(), 'move', screenOf({ x: 600, y: 300 }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    shiftPointer(viewport(), 'up', screenOf({ x: 600, y: 300 }));
    expect(selectedIds()).toEqual([a]);
    expect(selectedIds()).not.toContain(b);
    expect(renderedCamera(world())).toEqual(camera);
  });
});

describe('sel.transform (useTransformGesture, SelectionOverlay)', () => {
  it('TC-23 dragging unselected b while {a} is selected selects {b} and moves only b', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    renderApp(doc);
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    const aBefore = rectOf(doc, a);
    const bBefore = rectOf(doc, b)!;
    const start = screenOf({ x: 400, y: 100 });
    const updates = countUpdates(doc);

    // DRAG_THRESHOLD_PX − 1: a click, no write.
    pointer(objectEl(b), 'down', start.x, start.y);
    expect(selectedIds()).toEqual([b]);
    pointer(objectEl(b), 'move', start.x + DRAG_THRESHOLD_PX - 1, start.y);
    flushFrame();
    pointer(objectEl(b), 'up', start.x + DRAG_THRESHOLD_PX - 1, start.y);
    flushFrame();
    expect(updates.count).toBe(0);

    // Re-select a, then drag b by exactly the threshold and on.
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    pointer(objectEl(b), 'down', start.x, start.y);
    pointer(objectEl(b), 'move', start.x + DRAG_THRESHOLD_PX, start.y);
    flushFrame();
    expect(rectOf(doc, b)).toMatchObject({ x: bBefore.x + DRAG_THRESHOLD_PX });
    pointer(objectEl(b), 'move', start.x + 100, start.y + 50);
    pointer(objectEl(b), 'up', start.x + 100, start.y + 50);
    flushFrame();
    expect(selectedIds()).toEqual([b]);
    expect(rectOf(doc, b)).toMatchObject({ x: bBefore.x + 100, y: bBefore.y + 50 });
    expect(rectOf(doc, a)).toEqual(aBefore);
  });

  it('dragging a selected object moves the whole selection and raises it', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 100, y: 50 });
    const other = note(doc, { x: 600, y: 0 });
    renderApp(doc);
    click(objectEl(a), screenOf({ x: 50, y: 20 }));
    shiftPointer(objectEl(b), 'down', screenOf({ x: 250, y: 200 }));
    shiftPointer(objectEl(b), 'up', screenOf({ x: 250, y: 200 }));
    const start = screenOf({ x: 50, y: 20 });
    pointer(objectEl(a), 'down', start.x, start.y);
    pointer(objectEl(a), 'move', start.x + 300, start.y + 10);
    pointer(objectEl(a), 'up', start.x + 300, start.y + 10);
    flushFrame();
    expect(rectOf(doc, a)).toMatchObject({ x: 300, y: 10 });
    expect(rectOf(doc, b)).toMatchObject({ x: 400, y: 60 });
    const z = new Map(snapshot(doc).map((n) => [n.id, n.z]));
    expect(z.get(a)!).toBeGreaterThan(z.get(other)!);
    expect(z.get(b)!).toBeGreaterThan(z.get(a)!);
    expect(selectedIds()).toEqual([a, b].sort());
  });

  it('TC-24 testbox: an edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    const doc = newDoc();
    const box = createTestBox(doc, { x: 0, y: 0, width: 200, height: 100 });
    renderApp(doc);
    click(objectEl(box), screenOf({ x: 100, y: 50 }));
    for (const name of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(handle(name)).toBeTruthy();
    }
    const right = screenOf({ x: 200, y: 50 });
    pointer(handle('right'), 'down', right.x, right.y);
    pointer(handle('right'), 'move', right.x + 50, right.y + 30);
    pointer(handle('right'), 'up', right.x + 50, right.y + 30);
    flushFrame();
    expect(rectOf(doc, box)).toEqual({ x: 0, y: 0, width: 250, height: 100 });

    // Shift + corner: ratio 2.5:1 kept, anchored at the top-left.
    const corner = screenOf({ x: 250, y: 100 });
    shiftPointer(handle('bottom-right'), 'down', corner);
    shiftPointer(handle('bottom-right'), 'move', { x: corner.x + 250, y: corner.y + 10 });
    shiftPointer(handle('bottom-right'), 'up', { x: corner.x + 250, y: corner.y + 10 });
    flushFrame();
    expect(rectOf(doc, box)).toEqual({ x: 0, y: 0, width: 500, height: 200 });

    // Shrinking stops at the type's minimum size.
    const c2 = screenOf({ x: 500, y: 200 });
    pointer(handle('bottom-right'), 'down', c2.x, c2.y);
    pointer(handle('bottom-right'), 'move', c2.x - 2000, c2.y - 2000);
    pointer(handle('bottom-right'), 'up', c2.x - 2000, c2.y - 2000);
    flushFrame();
    expect(rectOf(doc, box)).toEqual({ x: 0, y: 0, width: TESTBOX_MIN_SIZE, height: TESTBOX_MIN_SIZE });
  });

  it('sticky notes resize from the opposite corner and stay square', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    renderApp(doc);
    click(objectEl(a), screenOf({ x: 100, y: 100 }));
    const corner = screenOf({ x: 200, y: 200 });
    pointer(handle('bottom-right'), 'down', corner.x, corner.y);
    pointer(handle('bottom-right'), 'move', corner.x + 100, corner.y + 40);
    pointer(handle('bottom-right'), 'up', corner.x + 100, corner.y + 40);
    flushFrame();
    expect(rectOf(doc, a)).toEqual({ x: 0, y: 0, width: 300, height: 300 });
    expect(objectEl(a).style.width).toBe('300px');
  });

  /** Renders registered objects with the gesture wired directly (canEdit and hooks under test control). */
  function GestureHarness(props: {
    doc: Y.Doc;
    objects: readonly ObjectSnapshot[];
    canEdit: boolean;
    initial: string[];
    onGestureStart?(): void;
    onGestureEnd?(): void;
  }) {
    const selection = useSelection(props.objects);
    const gesture = useTransformGesture({
      doc: props.doc,
      camera: { x: 0, y: 0, zoom: 1 },
      selection,
      snapshot: props.objects,
      canEdit: props.canEdit,
      onGestureStart: props.onGestureStart,
      onGestureEnd: props.onGestureEnd,
    });
    const { setMany } = selection;
    const [first] = props.initial;
    if (first && selection.ids.size === 0) queueMicrotask(() => setMany(props.initial, false));
    return (
      <>
        {props.objects.map((o) => {
          const spec = getObjectType(o.type)!;
          return (
            <spec.Component
              key={o.id}
              object={o}
              doc={props.doc}
              zoom={1}
              selected={selection.ids.has(o.id)}
              editing={false}
              editable={props.canEdit}
              transforming={false}
              onPointerDown={gesture.onObjectPointerDown}
              onSelect={selection.click}
              onStartEdit={() => {}}
              onEndEdit={() => {}}
            />
          );
        })}
        <SelectionOverlay ids={selection.ids} snapshot={props.objects} camera={{ x: 0, y: 0, zoom: 1 }} onHandlePointerDown={gesture.onHandlePointerDown} />
      </>
    );
  }

  async function renderHarness(canEdit: boolean, hooks: { onGestureStart?(): void; onGestureEnd?(): void } = {}) {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    const objects = objectsSnapshot(doc);
    const utils = render(<GestureHarness doc={doc} objects={objects} canEdit={canEdit} initial={[a, b]} {...hooks} />);
    await act(async () => {});
    const rerender = () =>
      utils.rerender(<GestureHarness doc={doc} objects={objectsSnapshot(doc)} canEdit={canEdit} initial={[a, b]} {...hooks} />);
    return { doc, a, b, rerender };
  }

  const frame = () =>
    act(() => {
      vi.advanceTimersByTime(FRAME_MS);
    });

  it('TC-25 canEdit false: moves and resizes are refused, nothing is written', async () => {
    const { doc, a } = await renderHarness(false);
    const updates = countUpdates(doc);
    pointer(objectEl(a), 'down', 100, 100);
    pointer(objectEl(a), 'move', 300, 200);
    frame();
    pointer(objectEl(a), 'up', 300, 200);
    frame();
    // Handles are still shown for viewing, but pressing them does nothing.
    const h = handle('bottom-right');
    pointer(h, 'down', 500, 200);
    pointer(h, 'move', 700, 400);
    frame();
    pointer(h, 'up', 700, 400);
    frame();
    expect(updates.count).toBe(0);
  });

  it('TC-26 onGestureStart/onGestureEnd once per drag; pointercancel keeps the last applied positions', async () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const { doc, a, b } = await renderHarness(true, { onGestureStart, onGestureEnd });
    pointer(objectEl(a), 'down', 100, 100);
    for (const dx of [10, 20, 30]) {
      pointer(objectEl(a), 'move', 100 + dx, 100);
      frame();
    }
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).not.toHaveBeenCalled();
    pointer(objectEl(a), 'move', 100 + 80, 100);
    pointer(objectEl(a), 'cancel', 100 + 80, 100);
    frame();
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(rectOf(doc, a)).toMatchObject({ x: 30, y: 0 });
    expect(rectOf(doc, b)).toMatchObject({ x: 330, y: 0 });
    // Later moves do nothing.
    pointer(objectEl(a), 'move', 500, 500);
    frame();
    expect(rectOf(doc, a)).toMatchObject({ x: 30, y: 0 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
  });
});

describe('sel.keyboard (useBoardKeys)', () => {
  it('TC-27 Ctrl/Cmd+A selects every object and prevents page text selection', () => {
    const doc = newDoc();
    const ids = [note(doc, { x: 0, y: 0 }), note(doc, { x: 300, y: 0 }), createTestBox(doc, { x: 0, y: 300, width: 50, height: 50 })];
    renderApp(doc);
    expect(selectAll()).toBe(false);
    expect(selectedIds()).toEqual(ids.sort());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(selectedIds()).toEqual([]);
    expect(fireEvent.keyDown(document.body, { key: 'a', metaKey: true })).toBe(false);
    expect(selectedIds()).toHaveLength(3);
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing, without error', () => {
    renderApp(newDoc());
    expect(() => selectAll()).not.toThrow();
    expect(selectionBar()).toBeNull();
    expect(announcer().textContent).toBe('');
  });

  it('TC-29 arrows nudge by NUDGE_STEP_WORLD, Shift+arrows by NUDGE_LARGE_STEP_WORLD, without default', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 });
    const b = note(doc, { x: 300, y: 0 });
    renderApp(doc);
    selectAll();
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(false);
    expect(rectOf(doc, a)).toMatchObject({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(rectOf(doc, b)).toMatchObject({ x: 300 + NUDGE_STEP_WORLD, y: 0 });
    expect(fireEvent.keyDown(document.body, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    expect(rectOf(doc, a)).toMatchObject({ x: NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });
    expect(rectOf(doc, b)).toMatchObject({ x: 300 + NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });
  });

  it('arrows with nothing selected are left alone', () => {
    const doc = newDoc();
    note(doc, { x: 0, y: 0 });
    renderApp(doc);
    expect(fireEvent.keyDown(document.body, { key: 'ArrowRight' })).toBe(true);
  });

  it('TC-30 Backspace while editing text edits the text; no object is deleted', () => {
    const doc = newDoc();
    const a = note(doc, { x: 0, y: 0 }, 'Hello');
    note(doc, { x: 300, y: 0 });
    renderApp(doc);
    fireEvent.doubleClick(objectEl(a));
    const textarea = screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
    expect(fireEvent.keyDown(textarea, { key: 'Backspace' })).toBe(true);
    fireEvent.input(textarea, { target: { value: 'Hell' } });
    expect(fireEvent.keyDown(textarea, { key: 'Delete' })).toBe(true);
    expect(fireEvent.keyDown(textarea, { key: 'a', ctrlKey: true })).toBe(true);
    expect(snapshot(doc)).toHaveLength(2);
    expect(getStickyText(doc, a)?.toString()).toBe('Hell');
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const doc = newDoc();
    note(doc, { x: 0, y: 0 });
    note(doc, { x: 300, y: 0 });
    const keep = createTestBox(doc, { x: 0, y: 400, width: 50, height: 50 });
    renderApp(doc);
    selectAll();
    shiftPointer(objectEl(keep), 'down', screenOf({ x: 10, y: 410 }));
    shiftPointer(objectEl(keep), 'up', screenOf({ x: 10, y: 410 }));
    expect(selectedIds()).toHaveLength(2);
    expect(fireEvent.keyDown(document.body, { key: 'Delete' })).toBe(false);
    expect([...objectsMap(doc).keys()]).toEqual([keep]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });
});
