/**
 * Story 7 component tests (TC-16 to TC-31): selection bar, marquee, transform gesture and
 * keyboard commands, on a real Y.Doc, with the test-only `testbox` type proving the
 * machinery is generic.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import '../fixtures/testbox';
import { addTestbox } from '../fixtures/testbox';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  snapshotObjects,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { HANDLE_LABELS, SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { countUpdates, editor, noteEl, notes, POINTER_ID, renderBoard, viewportEl } from './boardHelpers';
import { dispatch, flushFrame, readCamera } from './helpers';

const HALF = STICKY_SIZE_WORLD / 2;

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

function ptr(el: Element, type: PointerKind, p: Point, shiftKey = false): void {
  fireEvent[type](el, { clientX: p.x, clientY: p.y, pointerId: POINTER_ID, button: 0, buttons: 1, shiftKey });
}

function clickAt(el: Element, p: Point = { x: 10, y: 10 }, shiftKey = false): void {
  ptr(el, 'pointerDown', p, shiftKey);
  ptr(el, 'pointerUp', p, shiftKey);
}

/** Top-left of a note at world (x, y). */
function noteAt(doc: Y.Doc, x: number, y: number, text = ''): string {
  const id = createSticky(doc, { x: x + HALF, y: y + HALF });
  if (text !== '') getStickyText(doc, id)?.insert(0, text);
  return id;
}

function obj(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return snapshotObjects(doc).find((o) => o.id === id);
}

function selectedIds(): string[] {
  return screen
    .queryAllByTestId('selection-outline')
    .map((el) => el.dataset.objectId!)
    .sort();
}

function announcement(): string {
  return screen.getByTestId('selection-announcement').textContent ?? '';
}

function bar(): HTMLElement | null {
  return screen.queryByTestId('selection-bar');
}

function noteToolbar(): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: 'Note' });
}

function key(init: KeyboardEventInit, target: EventTarget = window): KeyboardEvent {
  return dispatch(target, new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('sel.interaction: selection bar and outlines', () => {
  it('TC-17 two selected: "2 selected" with a Delete selection button, announced politely', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    expect(announcement()).toBe('1 selected');
    clickAt(noteEl(b), undefined, true);
    expect(selectedIds()).toEqual([a, b].sort());
    expect(noteEl(a)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(b)).toHaveAttribute('data-selected', 'true');
    expect(bar()).toHaveTextContent('2 selected');
    expect(screen.getByTestId('selection-announcement')).toHaveAttribute('aria-live', 'polite');
    expect(announcement()).toBe('2 selected');
    expect(noteToolbar()).toBeNull();
    fireEvent.click(within(bar()!).getByRole('button', { name: 'Delete selection' }));
    expect(notes()).toHaveLength(0);
    expect(bar()).toBeNull();
    expect(announcement()).toBe('');
  });

  it('TC-18 exactly one sticky selected: the note toolbar instead of the bar', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    expect(noteToolbar()).toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
  });

  it('TC-16 every selected object deleted remotely: selection empty, bar hidden', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    const c = noteAt(doc, 600, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    clickAt(noteEl(b), undefined, true);
    expect(bar()).toBeInTheDocument();
    act(() => {
      deleteObjects(doc, [a]);
    });
    expect(selectedIds()).toEqual([b]); // one pruned, the other kept
    act(() => {
      deleteObjects(doc, [b]);
    });
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
    expect(noteToolbar()).toBeNull();
    expect(announcement()).toBe('');
    expect(noteEl(c)).toHaveAttribute('data-selected', 'false');
  });

  it('TC-19 a click on empty board space without dragging clears the selection', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    clickAt(noteEl(b), undefined, true);
    clickAt(viewportEl(), { x: 20, y: 20 });
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });

  it('Shift-click on a selected object removes only it; a plain click selects only that object', () => {
    const doc = new Y.Doc();
    const [a, b, c] = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
    renderBoard(doc);
    clickAt(noteEl(a!));
    clickAt(noteEl(b!), undefined, true);
    clickAt(noteEl(c!), undefined, true);
    expect(selectedIds()).toEqual([a, b, c].sort());
    clickAt(noteEl(b!), undefined, true);
    expect(selectedIds()).toEqual([a, c].sort());
    clickAt(noteEl(c!));
    expect(selectedIds()).toEqual([c]);
  });
});

/** Screen point (viewport-relative; jsdom's viewport sits at 0,0) of a world point. */
function screenOf(world: Point): Point {
  return worldToScreen(readCamera(), world);
}

describe('sel.marquee_ui', () => {
  function board() {
    const doc = new Y.Doc();
    const x = noteAt(doc, -600, -600);
    const a = noteAt(doc, 0, 0); // fully inside
    const b = noteAt(doc, 250, 0); // half inside
    const c = noteAt(doc, 900, 900); // outside
    return { x, a, b, c, ...renderBoard(doc) };
  }
  const FROM = { x: -20, y: -20 };
  const TO = { x: 350, y: 220 };

  it('TC-20 Shift+drag adds fully-inside objects to the existing selection', () => {
    const { x, a } = board();
    clickAt(noteEl(x));
    const vp = viewportEl();
    ptr(vp, 'pointerDown', screenOf(FROM), true);
    ptr(vp, 'pointerMove', screenOf({ x: 100, y: 100 }), true);
    expect(screen.getByTestId('marquee')).toBeInTheDocument();
    ptr(vp, 'pointerMove', screenOf(TO), true);
    ptr(vp, 'pointerUp', screenOf(TO), true);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x, a].sort());
    expect(bar()).toHaveTextContent('2 selected');
  });

  it('a marquee touching but not enclosing any object selects nothing and keeps the selection', () => {
    const { x } = board();
    clickAt(noteEl(x));
    const vp = viewportEl();
    ptr(vp, 'pointerDown', screenOf({ x: 100, y: 100 }), true);
    ptr(vp, 'pointerUp', screenOf({ x: 400, y: 150 }), true);
    expect(selectedIds()).toEqual([x]);
  });

  it('TC-21 a plain drag on empty space pans and draws no marquee', () => {
    const { x } = board();
    clickAt(noteEl(x));
    const before = readCamera();
    const vp = viewportEl();
    ptr(vp, 'pointerDown', { x: 20, y: 20 });
    ptr(vp, 'pointerMove', { x: 220, y: 120 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    ptr(vp, 'pointerUp', { x: 220, y: 120 });
    flushFrame();
    expect(readCamera()).not.toEqual(before);
    expect(selectedIds()).toEqual([x]);
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const { x } = board();
    clickAt(noteEl(x));
    const vp = viewportEl();
    ptr(vp, 'pointerDown', screenOf(FROM), true);
    ptr(vp, 'pointerMove', screenOf(TO), true);
    ptr(vp, 'pointerCancel', screenOf(TO), true);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([x]);
    ptr(vp, 'pointerUp', screenOf(TO), true);
    expect(selectedIds()).toEqual([x]);
  });

  it('Escape mid-marquee discards it', () => {
    const { x } = board();
    clickAt(noteEl(x));
    const vp = viewportEl();
    ptr(vp, 'pointerDown', screenOf(FROM), true);
    ptr(vp, 'pointerMove', screenOf(TO), true);
    key({ key: 'Escape' });
    expect(screen.queryByTestId('marquee')).toBeNull();
    ptr(vp, 'pointerUp', screenOf(TO), true);
    expect(selectedIds()).toEqual([]); // Escape also cleared the selection (sel.clear)
  });
});

describe('sel.transform in the board', () => {
  const START = { x: 300, y: 200 };

  it('TC-23 dragging unselected b while {a} is selected selects only b and moves only b', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    const updates = countUpdates(doc);
    // DRAG_THRESHOLD_PX − 1 is still a press: nothing written.
    ptr(noteEl(b), 'pointerDown', START);
    ptr(noteEl(b), 'pointerMove', { x: START.x + DRAG_THRESHOLD_PX - 1, y: START.y });
    flushFrame();
    expect(updates.count).toBe(0);
    expect(selectedIds()).toEqual([b]);
    // Exactly DRAG_THRESHOLD_PX starts the move.
    ptr(noteEl(b), 'pointerMove', { x: START.x + DRAG_THRESHOLD_PX, y: START.y });
    flushFrame();
    ptr(noteEl(b), 'pointerMove', { x: START.x + 50, y: START.y + 20 });
    flushFrame();
    ptr(noteEl(b), 'pointerUp', { x: START.x + 50, y: START.y + 20 });
    expect(obj(doc, b)).toMatchObject({ x: 300 + 50, y: 20 });
    expect(obj(doc, a)).toMatchObject({ x: 0, y: 0 });
    expect(selectedIds()).toEqual([b]);
  });

  it('dragging a selected object moves the whole selection and raises it above the others', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 100, 50);
    const other = noteAt(doc, 500, 0); // on top initially
    renderBoard(doc);
    clickAt(noteEl(a));
    clickAt(noteEl(b), undefined, true);
    ptr(noteEl(a), 'pointerDown', START);
    ptr(noteEl(a), 'pointerMove', { x: START.x + 300, y: START.y });
    flushFrame();
    expect(noteEl(a)).toHaveAttribute('data-state', 'dragging');
    expect(noteEl(b)).toHaveAttribute('data-state', 'dragging');
    expect(bar()).toBeNull(); // hidden while moving
    ptr(noteEl(a), 'pointerUp', { x: START.x + 300, y: START.y });
    expect(obj(doc, a)).toMatchObject({ x: 300, y: 0 });
    expect(obj(doc, b)).toMatchObject({ x: 400, y: 50 });
    const z = (id: string) => obj(doc, id)!.z;
    expect(z(a)).toBeGreaterThan(z(other));
    expect(z(b)).toBeGreaterThan(z(a)); // relative order kept
    expect(selectedIds()).toEqual([a, b].sort());
    expect(bar()).toHaveTextContent('2 selected');
  });

  it('a corner handle resizes every selected note proportionally; notes stay square', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    renderBoard(doc);
    clickAt(noteEl(a));
    clickAt(noteEl(b), undefined, true);
    const zoom = readCamera().zoom;
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    ptr(handle, 'pointerDown', START);
    // Box is 500 wide: +500 world units doubles it.
    ptr(handle, 'pointerMove', { x: START.x + 500 * zoom, y: START.y + 10 });
    flushFrame();
    ptr(handle, 'pointerUp', { x: START.x + 500 * zoom, y: START.y + 10 });
    expect(obj(doc, a)).toMatchObject({ x: 0, y: 0, width: 400, height: 400 });
    expect(obj(doc, b)).toMatchObject({ x: 600, y: 0, width: 400, height: 400 });
  });
});

/** Minimal board around the gesture hook (no App): lets the test pass canEdit and hooks. */
function Harness(props: { doc: Y.Doc; canEdit: boolean; onStart?(): void; onEnd?(): void }): React.JSX.Element {
  const camera: Camera = { x: 0, y: 0, zoom: 1 };
  const { objects } = useBoardDoc({ doc: props.doc });
  const selection = useSelection(objects);
  const t = useTransformGesture({
    doc: props.doc,
    camera,
    selection,
    snapshot: objects,
    canEdit: props.canEdit,
    onGestureStart: props.onStart,
    onGestureEnd: props.onEnd,
  });
  return (
    <div>
      {objects.map((o) => (
        <div
          key={o.id}
          data-testid={`obj-${o.id}`}
          data-selected={selection.ids.has(o.id) ? 'true' : 'false'}
          onPointerDown={(e) => t.onObjectPointerDown(e, o.id)}
        />
      ))}
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={camera}
        onHandlePointerDown={t.onHandlePointerDown}
        showHandles={props.canEdit}
      />
    </div>
  );
}

function renderHarness(doc: Y.Doc, canEdit = true, hooks: { onStart?(): void; onEnd?(): void } = {}) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  render(<Harness doc={doc} canEdit={canEdit} {...hooks} />);
}

const P0 = { x: 100, y: 100 };

describe('sel.transform: useTransformGesture and SelectionOverlay', () => {
  it('TC-24 testbox: edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    const doc = new Y.Doc();
    const box = addTestbox(doc, { x: 0, y: 0, width: 200, height: 100 });
    renderHarness(doc);
    clickAt(screen.getByTestId(`obj-${box}`));
    const labels = screen.getAllByRole('button').map((h) => h.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(Object.values(HANDLE_LABELS).sort());

    const right = screen.getByRole('button', { name: 'Resize right' });
    ptr(right, 'pointerDown', P0);
    ptr(right, 'pointerMove', { x: P0.x + 100, y: P0.y + 40 });
    flushFrame();
    ptr(right, 'pointerUp', { x: P0.x + 100, y: P0.y + 40 });
    expect(obj(doc, box)).toMatchObject({ x: 0, y: 0, width: 300, height: 100 });

    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });
    ptr(corner, 'pointerDown', P0, true);
    ptr(corner, 'pointerMove', { x: P0.x + 300, y: P0.y + 10 }, true);
    flushFrame();
    ptr(corner, 'pointerUp', { x: P0.x + 300, y: P0.y + 10 }, true);
    expect(obj(doc, box)).toMatchObject({ x: 0, y: 0, width: 600, height: 200 });

    // Without Shift a corner changes both axes independently.
    ptr(corner, 'pointerDown', P0);
    ptr(corner, 'pointerMove', { x: P0.x - 300, y: P0.y + 100 });
    flushFrame();
    ptr(corner, 'pointerUp', { x: P0.x - 300, y: P0.y + 100 });
    expect(obj(doc, box)).toMatchObject({ width: 300, height: 300 });
  });

  it('a testbox cannot be shrunk below its minimum size', () => {
    const doc = new Y.Doc();
    const box = addTestbox(doc, { x: 0, y: 0, width: 100, height: 100 });
    renderHarness(doc);
    clickAt(screen.getByTestId(`obj-${box}`));
    const right = screen.getByRole('button', { name: 'Resize right' });
    ptr(right, 'pointerDown', P0);
    ptr(right, 'pointerMove', { x: P0.x - 500, y: P0.y });
    flushFrame();
    ptr(right, 'pointerUp', { x: P0.x - 500, y: P0.y });
    expect(obj(doc, box)).toMatchObject({ width: 10, height: 100 });
  });

  it('TC-25 canEdit false: moves and resizes are refused, no writes', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = addTestbox(doc, { x: 300, y: 0, width: 100, height: 100 });
    renderHarness(doc, false);
    const updates = countUpdates(doc);
    const el = screen.getByTestId(`obj-${a}`);
    clickAt(el);
    clickAt(screen.getByTestId(`obj-${b}`), undefined, true);
    expect(screen.getByTestId(`obj-${a}`)).toHaveAttribute('data-selected', 'true'); // selecting still works
    expect(screen.queryAllByRole('button')).toHaveLength(0); // no handles
    ptr(el, 'pointerDown', P0);
    ptr(el, 'pointerMove', { x: P0.x + 200, y: P0.y + 200 });
    flushFrame();
    ptr(el, 'pointerUp', { x: P0.x + 200, y: P0.y + 200 });
    flushFrame();
    expect(updates.count).toBe(0);
  });

  it('TC-26 onGestureStart/onGestureEnd fire once per drag; pointercancel keeps the last applied positions', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    renderHarness(doc, true, { onStart, onEnd });
    const el = screen.getByTestId(`obj-${a}`);
    ptr(el, 'pointerDown', P0);
    for (let i = 1; i <= 10; i += 1) {
      ptr(el, 'pointerMove', { x: P0.x + i * 10, y: P0.y });
      flushFrame();
    }
    ptr(el, 'pointerUp', { x: P0.x + 100, y: P0.y });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(obj(doc, a)).toMatchObject({ x: 100, y: 0 });

    // A click is not a gesture.
    clickAt(el, P0);
    expect(onStart).toHaveBeenCalledTimes(1);

    ptr(el, 'pointerDown', P0);
    ptr(el, 'pointerMove', { x: P0.x + 40, y: P0.y });
    flushFrame();
    ptr(el, 'pointerMove', { x: P0.x + 90, y: P0.y }); // not yet shown
    ptr(el, 'pointerCancel', { x: P0.x + 90, y: P0.y });
    flushFrame();
    expect(obj(doc, a)).toMatchObject({ x: 140, y: 0 });
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onEnd).toHaveBeenCalledTimes(2);
    ptr(el, 'pointerMove', { x: P0.x + 300, y: P0.y });
    flushFrame();
    expect(obj(doc, a)).toMatchObject({ x: 140, y: 0 });
  });

  it('an object deleted remotely mid-move is skipped; the rest keep moving', () => {
    const doc = new Y.Doc();
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 300, 0);
    renderHarness(doc);
    clickAt(screen.getByTestId(`obj-${a}`));
    clickAt(screen.getByTestId(`obj-${b}`), undefined, true);
    const el = screen.getByTestId(`obj-${a}`);
    ptr(el, 'pointerDown', P0);
    ptr(el, 'pointerMove', { x: P0.x + 10, y: P0.y });
    flushFrame();
    act(() => {
      deleteObjects(doc, [b]);
    });
    ptr(el, 'pointerMove', { x: P0.x + 60, y: P0.y });
    flushFrame();
    ptr(el, 'pointerUp', { x: P0.x + 60, y: P0.y });
    expect(obj(doc, a)).toMatchObject({ x: 60 });
    expect(obj(doc, b)).toBeUndefined();
  });
});

describe('sel.keyboard', () => {
  function threeNotes() {
    const doc = new Y.Doc();
    const ids = [noteAt(doc, 0, 0, 'One'), noteAt(doc, 300, 0, 'Two'), noteAt(doc, 600, 0, 'Three')];
    return { ids, ...renderBoard(doc) };
  }

  it('TC-27 Ctrl/Cmd+A selects every object and prevents the page select-all', () => {
    const { ids } = threeNotes();
    const e = key({ key: 'a', ctrlKey: true });
    expect(e.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([...ids].sort());
    key({ key: 'Escape' });
    expect(selectedIds()).toEqual([]);
    const meta = key({ key: 'a', metaKey: true });
    expect(meta.defaultPrevented).toBe(true);
    expect(selectedIds()).toEqual([...ids].sort());
    expect(bar()).toHaveTextContent('3 selected');
    expect(window.getSelection()?.toString() ?? '').toBe('');
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing and does not fail', () => {
    renderBoard(new Y.Doc());
    expect(() => key({ key: 'a', ctrlKey: true })).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
    expect(announcement()).toBe('');
  });

  it('TC-29 ArrowRight nudges by NUDGE_STEP_WORLD, Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD', () => {
    const { doc, ids } = threeNotes();
    key({ key: 'a', ctrlKey: true });
    const camera = readCamera();
    const right = key({ key: 'ArrowRight' });
    expect(right.defaultPrevented).toBe(true);
    expect(ids.map((id) => obj(doc, id)!.x)).toEqual([NUDGE_STEP_WORLD, 300 + NUDGE_STEP_WORLD, 600 + NUDGE_STEP_WORLD]);
    const up = key({ key: 'ArrowUp', shiftKey: true });
    expect(up.defaultPrevented).toBe(true);
    expect(ids.map((id) => obj(doc, id)!.y)).toEqual(ids.map(() => -NUDGE_LARGE_STEP_WORLD));
    flushFrame();
    expect(readCamera()).toEqual(camera);
  });

  it('arrow keys with nothing selected do nothing', () => {
    const { doc } = threeNotes();
    const updates = countUpdates(doc);
    const e = key({ key: 'ArrowLeft' });
    expect(e.defaultPrevented).toBe(false);
    expect(updates.count).toBe(0);
  });

  it('TC-30 Backspace while editing text edits the text; no object is deleted', () => {
    const { doc, ids } = threeNotes();
    key({ key: 'a', ctrlKey: true });
    fireEvent.doubleClick(noteEl(ids[0]!));
    const textarea = editor()!;
    expect(textarea).toHaveFocus();
    const e = key({ key: 'Backspace' }, textarea);
    expect(e.defaultPrevented).toBe(false);
    key({ key: 'Delete' }, textarea);
    key({ key: 'a', ctrlKey: true }, textarea);
    expect(notes()).toHaveLength(3);
    expect(snapshotObjects(doc)).toHaveLength(3);
    expect(editor()).not.toBeNull();
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const { doc, ids } = threeNotes();
    clickAt(noteEl(ids[0]!));
    clickAt(noteEl(ids[2]!), undefined, true);
    const updates = countUpdates(doc);
    const e = key({ key: 'Delete' });
    expect(e.defaultPrevented).toBe(true);
    expect(updates.count).toBe(1);
    expect(notes().map((n) => n.dataset.id)).toEqual([ids[1]]);
    expect(selectedIds()).toEqual([]);
    expect(bar()).toBeNull();
  });
});
