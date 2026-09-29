// Story 7 component tests: selection bar (sel.interaction), marquee (sel.marquee_ui), transform
// gesture and handles (sel.transform) and keyboard commands (sel.keyboard). Real Y.Doc, real
// registry plus the test-only `testbox` type.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  objectsSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { cameraFromDom, dispatchKey, initialCamera, nextFrame, useFakeFrames } from './helpers';
import { editor, noteElements, noteToolbar, renderApp } from './stickyHelpers';
import { addTestbox } from './testbox';

beforeEach(() => useFakeFrames());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const REMOTE = Symbol('remote');

// jsdom has no layout: the viewport is at (0, 0), so client px = viewport px.
function toClient(world: { x: number; y: number }) {
  const cam = initialCamera();
  return { x: world.x - cam.x, y: world.y - cam.y };
}

/** A doc with sticky notes whose top-left corners are the given world points. */
function docWithNotes(...corners: [number, number][]) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = corners.map(
    ([x, y]) =>
      createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 }) as string,
  );
  return { doc, ids };
}

const objectEl = (id: string) => document.querySelector<HTMLElement>(`[data-object-id="${id}"]`)!;
const selectedIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-object-id][data-selected="true"]')]
    .map((el) => el.dataset.objectId!)
    .sort();
const selectionBar = () => screen.queryByRole('toolbar', { name: 'Selection' });
const status = () => screen.getByTestId('selection-status');
const at = (doc: Y.Doc, id: string) => objectsSnapshot(doc).find((o) => o.id === id)!;

let pointerId = 10;
/** Press at a client point on `el`, move in steps, release. */
function drag(
  el: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
  init: { shiftKey?: boolean; release?: boolean } = {},
) {
  const id = ++pointerId;
  const shiftKey = init.shiftKey ?? false;
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, button: 0, pointerId: id, shiftKey });
  fireEvent.pointerMove(el, {
    clientX: (from.x + to.x) / 2,
    clientY: (from.y + to.y) / 2,
    pointerId: id,
    shiftKey,
  });
  nextFrame();
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId: id, shiftKey });
  nextFrame();
  if (init.release !== false) {
    fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y, button: 0, pointerId: id, shiftKey });
    nextFrame();
  }
  return id;
}

function clickEl(el: Element, init: { shiftKey?: boolean } = {}) {
  const id = ++pointerId;
  fireEvent.pointerDown(el, { clientX: 5, clientY: 5, button: 0, pointerId: id, ...init });
  fireEvent.pointerUp(el, { clientX: 5, clientY: 5, button: 0, pointerId: id, ...init });
  fireEvent.click(el, init);
}

function selectAll(...ids: string[]) {
  clickEl(objectEl(ids[0]));
  for (const id of ids.slice(1)) clickEl(objectEl(id), { shiftKey: true });
}

describe('sel.interaction', () => {
  it('click selects only that object; Shift-click adds and removes', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    renderApp(doc);
    clickEl(objectEl(ids[0]));
    expect(selectedIds()).toEqual([ids[0]]);
    clickEl(objectEl(ids[1]), { shiftKey: true });
    clickEl(objectEl(ids[2]), { shiftKey: true });
    expect(selectedIds()).toEqual([...ids].sort());
    clickEl(objectEl(ids[1]), { shiftKey: true });
    expect(selectedIds()).toEqual([ids[0], ids[2]].sort());
    clickEl(objectEl(ids[2]));
    expect(selectedIds()).toEqual([ids[2]]);
  });

  it('TC-16 every selected object deleted remotely → selection empty, bar hidden', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    renderApp(doc);
    selectAll(ids[0], ids[1]);
    expect(selectionBar()).not.toBeNull();
    act(() => doc.transact(() => deleteObjects(doc, [ids[0]]), REMOTE));
    // One left: the note toolbar replaces the bar.
    expect(selectedIds()).toEqual([ids[1]]);
    expect(status().textContent).toBe('1 selected');
    act(() => doc.transact(() => deleteObjects(doc, [ids[1]]), REMOTE));
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(noteToolbar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(status().textContent).toBe('');
    // The remaining note can still be selected normally.
    clickEl(objectEl(ids[2]));
    expect(selectedIds()).toEqual([ids[2]]);
  });

  it('TC-17 two selected → "2 selected" bar with Delete selection; aria-live announces it', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    renderApp(doc);
    expect(status().getAttribute('aria-live')).toBe('polite');
    selectAll(ids[0], ids[1]);
    const bar = selectionBar()!;
    expect(bar.textContent).toContain('2 selected');
    expect(status().textContent).toBe('2 selected');
    expect(noteToolbar()).toBeNull();
    fireEvent.click(within(bar).getByRole('button', { name: 'Delete selection' }));
    expect(objectsSnapshot(doc).map((o) => o.id)).toEqual([ids[2]]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('TC-18 exactly one sticky selected → the note toolbar instead of the bar', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    renderApp(doc);
    clickEl(objectEl(ids[0]));
    expect(noteToolbar()).not.toBeNull();
    expect(selectionBar()).toBeNull();
    expect(status().textContent).toBe('1 selected');
  });

  it('TC-19 a click on empty space without dragging clears the selection', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const { viewport } = renderApp(doc);
    selectAll(...ids);
    fireEvent.pointerDown(viewport, { clientX: 900, clientY: 700, button: 0, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 901, clientY: 700, button: 0, pointerId: 1 });
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });
});

describe('sel.marquee_ui', () => {
  it('TC-20 Shift+drag adds the fully-inside objects to the existing selection', () => {
    // x selected first; a inside, b half inside, c outside the rectangle.
    const { doc, ids } = docWithNotes([-400, -300], [0, 0], [250, 0], [0, 250]);
    const [x, a, b, c] = ids;
    const { viewport } = renderApp(doc);
    clickEl(objectEl(x));
    const from = toClient({ x: -20, y: -20 });
    const to = toClient({ x: 350, y: 220 });
    drag(viewport, from, to, { shiftKey: true, release: false });
    const rect = screen.getByTestId('marquee');
    expect(rect.style.left).toBe('-20px');
    expect(rect.style.width).toBe('370px');
    // The board did not pan.
    expect(cameraFromDom()).toEqual(initialCamera());
    fireEvent.pointerUp(viewport, { clientX: to.x, clientY: to.y, pointerId: pointerId, shiftKey: true });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x, a].sort());
    expect(selectedIds()).not.toContain(b);
    expect(selectedIds()).not.toContain(c);
  });

  it('a marquee that encloses nothing leaves the selection unchanged', () => {
    const { doc, ids } = docWithNotes([0, 0]);
    const { viewport } = renderApp(doc);
    clickEl(objectEl(ids[0]));
    drag(viewport, toClient({ x: 400, y: 400 }), toClient({ x: 450, y: 450 }), { shiftKey: true });
    expect(selectedIds()).toEqual([ids[0]]);
  });

  it('TC-21 a plain drag on empty space pans and draws no marquee', () => {
    const { doc, ids } = docWithNotes([0, 0]);
    const { viewport } = renderApp(doc);
    clickEl(objectEl(ids[0]));
    drag(viewport, toClient({ x: -50, y: -50 }), toClient({ x: 300, y: 300 }), { release: false });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(viewport.dataset.state).toBe('panning');
    fireEvent.pointerUp(viewport, { pointerId });
    const cam = cameraFromDom();
    expect(cam.x).toBe(initialCamera().x - 350);
    expect(selectedIds()).toEqual([ids[0]]);
  });

  it('TC-22 pointercancel mid-marquee discards it; the selection is unchanged', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const { viewport } = renderApp(doc);
    clickEl(objectEl(ids[1]));
    drag(viewport, toClient({ x: -20, y: -20 }), toClient({ x: 600, y: 300 }), {
      shiftKey: true,
      release: false,
    });
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerCancel(viewport, { pointerId });
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(viewport, { pointerId });
    expect(selectedIds()).toEqual([ids[1]]);
  });

  it('Escape mid-marquee discards it without clearing the selection', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const { viewport } = renderApp(doc);
    clickEl(objectEl(ids[1]));
    drag(viewport, toClient({ x: -20, y: -20 }), toClient({ x: 250, y: 250 }), {
      shiftKey: true,
      release: false,
    });
    dispatchKey({ key: 'Escape' });
    expect(screen.queryByTestId('marquee')).toBeNull();
    fireEvent.pointerUp(viewport, { pointerId });
    expect(selectedIds()).toEqual([ids[1]]);
  });
});

describe('sel.transform', () => {
  it('TC-23 dragging unselected b while {a} is selected selects just b and moves only b', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const [a, b] = ids;
    renderApp(doc);
    clickEl(objectEl(a));
    const updates = vi.fn();
    doc.on('update', updates);
    const el = objectEl(b);
    // DRAG_THRESHOLD_PX − 1: still a click, nothing written.
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, button: 0, pointerId: 2 });
    expect(selectedIds()).toEqual([b]);
    fireEvent.pointerMove(el, { clientX: 100 + DRAG_THRESHOLD_PX - 1, clientY: 100, pointerId: 2 });
    nextFrame();
    expect(updates).not.toHaveBeenCalled();
    // Exactly DRAG_THRESHOLD_PX: the gesture starts.
    fireEvent.pointerMove(el, { clientX: 100 + DRAG_THRESHOLD_PX, clientY: 100, pointerId: 2 });
    nextFrame();
    fireEvent.pointerMove(el, { clientX: 150, clientY: 120, pointerId: 2 });
    fireEvent.pointerUp(el, { clientX: 150, clientY: 120, pointerId: 2 });
    expect(at(doc, b)).toMatchObject({ x: 350, y: 20 });
    expect(at(doc, a)).toMatchObject({ x: 0, y: 0 });
    expect(selectedIds()).toEqual([b]);
  });

  it('dragging a selected object moves the whole selection by the same distance, above the rest', () => {
    const { doc, ids } = docWithNotes([0, 0], [100, 50], [150, 100], [400, 0]);
    const [a, b, c, other] = ids;
    renderApp(doc);
    selectAll(a, b, c);
    drag(objectEl(b), { x: 100, y: 100 }, { x: 400, y: 100 });
    expect(at(doc, a)).toMatchObject({ x: 300, y: 0 });
    expect(at(doc, b)).toMatchObject({ x: 400, y: 50 });
    expect(at(doc, c)).toMatchObject({ x: 450, y: 100 });
    expect(at(doc, other)).toMatchObject({ x: 400, y: 0 });
    const order = objectsSnapshot(doc).map((o) => o.id);
    expect(order).toEqual([other, a, b, c]);
    expect(selectedIds()).toEqual([a, b, c].sort());
  });

  it('TC-24 testbox: an edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const p = addTestbox(doc, { x: 0, y: 0, width: 100, height: 50 }, 1);
    const q = addTestbox(doc, { x: 200, y: 0, width: 100, height: 100 }, 2);
    renderApp(doc);
    selectAll(p, q);
    const labels = screen
      .getAllByRole('button', { name: /^Resize / })
      .map((h) => h.getAttribute('aria-label'));
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
    // Box 300 wide → drag right edge +300 px (zoom 1) → 600 wide, heights unchanged.
    drag(right, { x: 800, y: 400 }, { x: 1100, y: 400 });
    expect(at(doc, p)).toMatchObject({ x: 0, y: 0, width: 200, height: 50 });
    expect(at(doc, q)).toMatchObject({ x: 400, y: 0, width: 200, height: 100 });
    // Shift: the box (600 × 100) keeps its ratio, height grows around the centre.
    drag(screen.getByRole('button', { name: 'Resize right' }), { x: 0, y: 0 }, { x: 600, y: 0 }, {
      shiftKey: true,
    });
    expect(at(doc, p)).toMatchObject({ x: 0, y: -50, width: 400, height: 100 });
    expect(at(doc, q)).toMatchObject({ x: 800, y: -50, width: 400, height: 200 });
  });

  it('a corner handle on stickies keeps them square and scales gaps; shrinking stops at the minimum', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const [a, b] = ids;
    renderApp(doc);
    selectAll(a, b);
    const se = screen.getByRole('button', { name: 'Resize bottom-right' });
    drag(se, { x: 0, y: 0 }, { x: 500, y: 0 });
    expect(at(doc, a)).toMatchObject({ x: 0, y: 0, width: 400, height: 400 });
    expect(at(doc, b)).toMatchObject({ x: 600, y: 0, width: 400, height: 400 });
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), { x: 0, y: 0 }, { x: -5000, y: -5000 });
    expect(at(doc, a)).toMatchObject({ width: 50, height: 50 });
    expect(at(doc, b)).toMatchObject({ x: 75, width: 50, height: 50 });
  });
});

/** Board without App: the gesture hook with explicit canEdit and gesture callbacks. */
function Harness(props: {
  doc: Y.Doc;
  canEdit: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}) {
  const { objects } = useBoardDoc(undefined, props.doc);
  const selection = useSelection(objects);
  const camera = { x: 0, y: 0, zoom: 1 };
  const gesture = useTransformGesture({
    doc: props.doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: props.canEdit,
    onGestureStart: props.onGestureStart,
    onGestureEnd: props.onGestureEnd,
  });
  return (
    <div>
      {objects.map((o) => (
        <div
          key={o.id}
          data-object-id={o.id}
          data-selected={selection.ids.has(o.id)}
          onPointerDown={(e) => gesture.onObjectPointerDown(e, o.id)}
        />
      ))}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
    </div>
  );
}

describe('sel.transform (gesture hook)', () => {
  it('TC-25 canEdit false: objects can be selected but moves and resizes write nothing', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    render(<Harness doc={doc} canEdit={false} />);
    const updates = vi.fn();
    doc.on('update', updates);
    selectAll(...ids);
    expect(selectedIds()).toEqual([...ids].sort());
    drag(objectEl(ids[0]), { x: 0, y: 0 }, { x: 300, y: 200 });
    drag(screen.getByRole('button', { name: 'Resize bottom-right' }), { x: 0, y: 0 }, { x: 300, y: 300 });
    expect(updates).not.toHaveBeenCalled();
    expect(at(doc, ids[0])).toMatchObject({ x: 0, y: 0, width: 200 });
  });

  it('TC-26 onGestureStart/End run once per drag; pointercancel keeps the last applied positions', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    render(
      <Harness doc={doc} canEdit onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} />,
    );
    selectAll(...ids);
    // A click is not a gesture.
    expect(onGestureStart).not.toHaveBeenCalled();
    drag(objectEl(ids[0]), { x: 0, y: 0 }, { x: 100, y: 50 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(at(doc, ids[1])).toMatchObject({ x: 400, y: 50 });

    // Second drag, cancelled after one applied frame: a move not yet drawn is dropped.
    const id = drag(objectEl(ids[0]), { x: 0, y: 0 }, { x: 40, y: 0 }, { release: false });
    expect(at(doc, ids[0])).toMatchObject({ x: 140, y: 50 });
    fireEvent.pointerMove(objectEl(ids[0]), { clientX: 500, clientY: 500, pointerId: id });
    fireEvent.pointerCancel(objectEl(ids[0]), { pointerId: id });
    nextFrame();
    expect(at(doc, ids[0])).toMatchObject({ x: 140, y: 50 });
    expect(at(doc, ids[1])).toMatchObject({ x: 440, y: 50 });
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
    // Later moves do nothing.
    fireEvent.pointerMove(objectEl(ids[0]), { clientX: 900, clientY: 900, pointerId: id });
    nextFrame();
    expect(at(doc, ids[0])).toMatchObject({ x: 140, y: 50 });
  });

  it('an object deleted mid-gesture is skipped; the rest keep moving', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    render(<Harness doc={doc} canEdit />);
    selectAll(...ids);
    const id = drag(objectEl(ids[0]), { x: 0, y: 0 }, { x: 10, y: 0 }, { release: false });
    act(() => doc.transact(() => deleteObjects(doc, [ids[1]]), REMOTE));
    fireEvent.pointerMove(objectEl(ids[0]), { clientX: 50, clientY: 0, pointerId: id });
    nextFrame();
    fireEvent.pointerUp(objectEl(ids[0]), { clientX: 50, clientY: 0, pointerId: id });
    expect(at(doc, ids[0])).toMatchObject({ x: 50 });
    expect(at(doc, ids[2])).toMatchObject({ x: 650 });
    expect(objectsSnapshot(doc)).toHaveLength(2);
    expect(selectedIds()).toEqual([ids[0], ids[2]].sort());
  });
});

describe('sel.keyboard', () => {
  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
  ])('TC-27 %s+A selects every object and prevents the default', (_name, mod) => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    const box = addTestbox(doc, { x: 0, y: 400, width: 50, height: 50 });
    renderApp(doc);
    const event = dispatchKey({ key: 'a', ...mod });
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([...ids, box].sort());
    expect(selectionBar()!.textContent).toContain('4 selected');
  });

  it('TC-28 Ctrl+A on an empty board selects nothing, without an error', () => {
    renderApp();
    let event!: KeyboardEvent;
    expect(() => {
      event = dispatchKey({ key: 'a', ctrlKey: true });
    }).not.toThrow();
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('TC-29 arrows nudge by NUDGE_STEP_WORLD, Shift+arrows by NUDGE_LARGE_STEP_WORLD, no scroll', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    renderApp(doc);
    const camera = cameraFromDom();
    selectAll(ids[0], ids[1]);
    const right = dispatchKey({ key: 'ArrowRight' });
    expect(right.defaultPrevented).toBe(true);
    expect(at(doc, ids[0])).toMatchObject({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(at(doc, ids[1])).toMatchObject({ x: 300 + NUDGE_STEP_WORLD, y: 0 });
    const up = dispatchKey({ key: 'ArrowUp', shiftKey: true });
    expect(up.defaultPrevented).toBe(true);
    expect(at(doc, ids[0])).toMatchObject({ x: NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });
    dispatchKey({ key: 'ArrowLeft' });
    dispatchKey({ key: 'ArrowDown' });
    expect(at(doc, ids[1])).toMatchObject({ x: 300, y: -NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD });
    expect(at(doc, ids[2])).toMatchObject({ x: 600, y: 0 });
    expect(cameraFromDom()).toEqual(camera);
  });

  it('arrows with nothing selected are left alone', () => {
    const { doc } = docWithNotes([0, 0]);
    renderApp(doc);
    expect(dispatchKey({ key: 'ArrowRight' }).defaultPrevented).toBe(false);
    expect(objectsSnapshot(doc)[0]).toMatchObject({ x: 0 });
  });

  it('TC-30 Backspace while editing a note edits text and keeps every object', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    getStickyText(doc, ids[0])!.insert(0, 'Draft');
    renderApp(doc);
    selectAll(...ids);
    fireEvent.doubleClick(objectEl(ids[0]));
    const textarea = editor()!;
    expect(textarea).not.toBeNull();
    const inEditor = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    act(() => {
      textarea.dispatchEvent(inEditor);
    });
    expect(inEditor.defaultPrevented).toBe(false);
    dispatchKey({ key: 'Delete' });
    expect(objectsSnapshot(doc)).toHaveLength(2);
    expect(noteElements()).toHaveLength(2);
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0], [600, 0]);
    renderApp(doc);
    selectAll(ids[0], ids[2]);
    const updates = vi.fn();
    doc.on('update', updates);
    const event = dispatchKey({ key: 'Delete' });
    expect(event.defaultPrevented).toBe(true);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(objectsSnapshot(doc).map((o) => o.id)).toEqual([ids[1]]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('Escape clears the selection', () => {
    const { doc, ids } = docWithNotes([0, 0], [300, 0]);
    renderApp(doc);
    selectAll(...ids);
    dispatchKey({ key: 'Escape' });
    expect(selectedIds()).toEqual([]);
  });
});
