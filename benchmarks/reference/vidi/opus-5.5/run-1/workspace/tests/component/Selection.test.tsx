import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { resetCamera } from '../../src/client/canvas/camera';
import {
  createSticky,
  deleteObjects,
  initDoc,
  objectSnapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { createTestBox } from '../fixtures/testbox';
import { TEST_VIEWPORT } from './setup';
import { board, camera, doc, editor, flushFrame, noteToolbar, renderBoard, user } from './stickyHelpers';

const HALF = 2;
const POINTER_ID = 1;
const PRIMARY_BUTTON = 0;
const CAM = resetCamera(TEST_VIEWPORT);
const NOTE = STICKY_SIZE_WORLD;
const MOVE_PX = 120;
const MARGIN = 20;
const HANDLE_LABELS = [
  'Resize top-left',
  'Resize top',
  'Resize top-right',
  'Resize right',
  'Resize bottom-right',
  'Resize bottom',
  'Resize bottom-left',
  'Resize left',
];

interface Pt {
  x: number;
  y: number;
}

/** World → screen at the initial camera (zoom 1). */
function toScreen(p: Pt): Pt {
  return { x: (p.x - CAM.x) * CAM.zoom, y: (p.y - CAM.y) * CAM.zoom };
}

function down(el: Element, p: Pt, shiftKey = false): void {
  fireEvent.pointerDown(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y, shiftKey });
}
function over(el: Element, p: Pt, shiftKey = false): void {
  fireEvent.pointerMove(el, { pointerId: POINTER_ID, clientX: p.x, clientY: p.y, shiftKey });
}
function up(el: Element, p: Pt, shiftKey = false): void {
  fireEvent.pointerUp(el, { pointerId: POINTER_ID, button: PRIMARY_BUTTON, clientX: p.x, clientY: p.y, shiftKey });
}
function clickAt(el: Element, p: Pt, shiftKey = false): void {
  down(el, p, shiftKey);
  up(el, p, shiftKey);
}

/** A sticky whose top-left is world (x, y). */
function addSticky(x: number, y: number): string {
  let id = '';
  act(() => {
    id = createSticky(doc(), { x: x + NOTE / HALF, y: y + NOTE / HALF });
  });
  return id;
}

function addBox(x: number, y: number, width: number, height: number): string {
  let id = '';
  act(() => {
    id = createTestBox(doc(), { x, y, width, height });
  });
  return id;
}

function objEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!el) throw new Error(`object ${id} not rendered`);
  return el;
}

function centreOf(id: string): Pt {
  const o = obj(id);
  return toScreen({ x: o.x + (o.width ?? NOTE) / HALF, y: o.y + (o.height ?? NOTE) / HALF });
}

function objects(): readonly ObjectSnapshot[] {
  return window.__vidi6!.getObjects();
}

function obj(id: string): ObjectSnapshot {
  const found = objects().find((o) => o.id === id);
  if (!found) throw new Error(`object ${id} not in the document`);
  return found;
}

function selection(): string[] {
  return window.__vidi6!.getSelection().sort();
}

function selectionBar(): HTMLElement | null {
  return screen.queryByRole('toolbar', { name: 'Selection' });
}

function announcer(): HTMLElement {
  return screen.getByTestId('selection-announcer');
}

function handle(label: string): HTMLElement {
  return screen.getByRole('button', { name: label });
}

/** Selects every id: click the first, Shift-click the rest. */
function selectAll(ids: string[]): void {
  ids.forEach((id, i) => clickAt(objEl(id), centreOf(id), i > 0));
  expect(selection()).toEqual([...ids].sort());
}

/** Applies `change` on another person's copy of the board and syncs it into this page. */
function remoteChange(change: (remote: Y.Doc) => void): void {
  const local = doc();
  const remote = new Y.Doc();
  Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
  const before = Y.encodeStateVector(remote);
  change(remote);
  act(() => {
    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote, before), 'remote');
  });
}

function key(keyName: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body): boolean {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(target, { key: keyName, ...init });
  });
  return notPrevented;
}

describe('sel.interaction: selection state and bar', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-16 every selected object deleted remotely → selection empty, bar hidden', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    selectAll([a, b]);
    expect(selectionBar()).not.toBeNull();
    remoteChange((remote) => deleteObjects(remote, [a, b]));
    expect(selection()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(noteToolbar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(announcer().textContent).toBe('');
  });

  it('TC-15 (component) one of three deleted remotely → the other two stay selected, bar reads "2 selected"', () => {
    const ids = [addSticky(0, 0), addSticky(300, 0), addSticky(600, 0)];
    selectAll(ids);
    remoteChange((remote) => deleteObjects(remote, [ids[1]!]));
    expect(selection()).toEqual([ids[0]!, ids[2]!].sort());
    expect(selectionBar()?.textContent).toContain('2 selected');
  });

  it('TC-17 two selected → "2 selected" + Delete selection button; aria-live announces the count', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    clickAt(objEl(a), centreOf(a));
    expect(announcer().getAttribute('aria-live')).toBe('polite');
    expect(announcer().textContent).toBe('1 selected');
    clickAt(objEl(b), centreOf(b), true);
    const bar = selectionBar();
    expect(bar).not.toBeNull();
    expect(bar!.textContent).toContain('2 selected');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    expect(announcer().textContent).toBe('2 selected');
    expect(noteToolbar()).toBeNull();
    // Both show their outline.
    expect(objEl(a).dataset.selected).toBe('true');
    expect(objEl(b).dataset.selected).toBe('true');
  });

  it('TC-18 exactly one sticky selected → the note toolbar instead of the bar', () => {
    const a = addSticky(0, 0);
    clickAt(objEl(a), centreOf(a));
    expect(noteToolbar()).not.toBeNull();
    expect(selectionBar()).toBeNull();
  });

  it('one non-sticky object selected → "1 selected" bar (no note toolbar)', () => {
    const box = addBox(0, 0, 100, 60);
    clickAt(objEl(box), centreOf(box));
    expect(selectionBar()?.textContent).toContain('1 selected');
    expect(noteToolbar()).toBeNull();
  });

  it('TC-19 clicking empty board without dragging clears the selection', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    selectAll([a, b]);
    const empty = toScreen({ x: 0, y: 600 });
    clickAt(board(), empty);
    expect(selection()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('Shift-click toggles: adds, then removes, leaving the others selected', () => {
    const [a, b, c] = [addSticky(0, 0), addSticky(300, 0), addSticky(600, 0)];
    selectAll([a, b]);
    clickAt(objEl(c), centreOf(c), true);
    expect(selection()).toEqual([a, b, c].sort());
    clickAt(objEl(a), centreOf(a), true);
    expect(selection()).toEqual([b, c].sort());
    // A plain click on a selected object selects only it.
    clickAt(objEl(b), centreOf(b));
    expect(selection()).toEqual([b]);
  });

  it('the bar Delete button removes every selected object and clears the selection', () => {
    const [a, b, c] = [addSticky(0, 0), addSticky(300, 0), addSticky(600, 0)];
    selectAll([a, b]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(objects().map((o) => o.id)).toEqual([c]);
    expect(selection()).toEqual([]);
  });
});

describe('sel.interaction: useSelection ignores ids that are not on the board', () => {
  it('click, toggle and setMany with absent ids change nothing', () => {
    const present: ObjectSnapshot[] = [{ id: 'a', type: 'sticky', x: 0, y: 0, z: 1, createdAt: 0 }];
    const { result } = renderHook(() => useSelection(present));
    act(() => result.current.click('ghost'));
    act(() => result.current.toggle('ghost'));
    act(() => result.current.setMany(['ghost'], true));
    expect(result.current.ids.size).toBe(0);
    act(() => result.current.setMany(['a', 'ghost'], false));
    expect([...result.current.ids]).toEqual(['a']);
  });
});

describe('sel.marquee_ui', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-20 Shift+drag adds the fully-inside objects to the existing selection', () => {
    const x = addSticky(-600, 0);
    const a = addSticky(0, 0);
    const b = addSticky(250, 0);
    const outside = addSticky(600, 0); // only partly inside the rectangle below
    clickAt(objEl(x), centreOf(x));
    const from = toScreen({ x: -MARGIN, y: -MARGIN });
    const to = toScreen({ x: 250 + NOTE + MARGIN, y: NOTE + MARGIN });
    down(board(), from, true);
    over(board(), { x: (from.x + to.x) / HALF, y: (from.y + to.y) / HALF }, true);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    expect(board().dataset.mode).toBe('marquee');
    over(board(), to, true);
    up(board(), to, true);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selection()).toEqual([x, a, b].sort());
    expect(selection()).not.toContain(outside);
  });

  it('a marquee around nothing leaves the selection unchanged', () => {
    const a = addSticky(0, 0);
    clickAt(objEl(a), centreOf(a));
    const from = toScreen({ x: 1000, y: 1000 });
    down(board(), from, true);
    over(board(), { x: from.x + MOVE_PX, y: from.y + MOVE_PX }, true);
    up(board(), { x: from.x + MOVE_PX, y: from.y + MOVE_PX }, true);
    expect(selection()).toEqual([a]);
  });

  it('TC-21 a plain drag on empty space pans the board; no marquee (negative)', () => {
    const a = addSticky(0, 0);
    clickAt(objEl(a), centreOf(a));
    const before = camera();
    const from = toScreen({ x: -400, y: -300 });
    down(board(), from);
    over(board(), { x: from.x + MOVE_PX, y: from.y });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(board().dataset.mode).toBe('panning');
    up(board(), { x: from.x + MOVE_PX, y: from.y });
    flushFrame();
    expect(camera().x).toBe(before.x - MOVE_PX);
    expect(selection()).toEqual([a]);
  });

  it('TC-22 pointercancel mid-marquee → rectangle gone, selection unchanged', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    clickAt(objEl(b), centreOf(b));
    const from = toScreen({ x: -MARGIN, y: -MARGIN });
    down(board(), from, true);
    over(board(), toScreen({ x: NOTE + MARGIN, y: NOTE + MARGIN }), true);
    fireEvent.pointerCancel(board(), { pointerId: POINTER_ID });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selection()).toEqual([b]);
    expect(selection()).not.toContain(a);
  });

  it('Escape mid-marquee discards it without clearing the selection', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    clickAt(objEl(b), centreOf(b));
    const from = toScreen({ x: -MARGIN, y: -MARGIN });
    down(board(), from, true);
    over(board(), toScreen({ x: NOTE + MARGIN, y: NOTE + MARGIN }), true);
    key('Escape');
    expect(screen.queryByTestId('marquee')).toBeNull();
    up(board(), toScreen({ x: NOTE + MARGIN, y: NOTE + MARGIN }), true);
    expect(selection()).toEqual([b]);
    expect(selection()).not.toContain(a);
  });
});

describe('sel.transform', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-23 boundary: moving DRAG_THRESHOLD_PX − 1 on an unselected object is a click (no write)', () => {
    const a = addSticky(0, 0);
    const b = addSticky(400, 0);
    clickAt(objEl(a), centreOf(a));
    const before = objects();
    const start = centreOf(b);
    down(objEl(b), start);
    over(objEl(b), { x: start.x + DRAG_THRESHOLD_PX - 1, y: start.y });
    flushFrame();
    up(objEl(b), { x: start.x + DRAG_THRESHOLD_PX - 1, y: start.y });
    flushFrame();
    expect(objects()).toEqual(before);
    expect(selection()).toEqual([b]);
  });

  it('TC-23 dragging unselected b (exactly DRAG_THRESHOLD_PX) while {a} is selected → {b}, only b moves', () => {
    const a = addSticky(0, 0);
    const b = addSticky(400, 0);
    clickAt(objEl(a), centreOf(a));
    const aBefore = obj(a);
    const bBefore = obj(b);
    const start = centreOf(b);
    down(objEl(b), start);
    expect(selection()).toEqual([b]);
    over(objEl(b), { x: start.x + DRAG_THRESHOLD_PX, y: start.y });
    flushFrame();
    expect(obj(b).x).toBe(bBefore.x + DRAG_THRESHOLD_PX);
    up(objEl(b), { x: start.x + MOVE_PX, y: start.y + MOVE_PX });
    flushFrame();
    expect(obj(b)).toMatchObject({ x: bBefore.x + MOVE_PX, y: bBefore.y + MOVE_PX });
    expect(obj(a)).toMatchObject({ x: aBefore.x, y: aBefore.y });
    expect(selection()).toEqual([b]);
  });

  it('dragging a selected object moves the whole selection by the same distance, above others', () => {
    const [a, b, other] = [addSticky(0, 0), addSticky(150, 0), addSticky(1000, 0)];
    selectAll([a, b]);
    const [ab, bb] = [obj(a), obj(b)];
    const start = centreOf(a);
    down(objEl(a), start);
    over(objEl(a), { x: start.x + MOVE_PX, y: start.y });
    expect(objEl(a).dataset.dragging ?? objEl(a).className).toContain('dragging');
    expect(selectionBar()).toBeNull(); // hidden while moving
    up(objEl(a), { x: start.x + MOVE_PX, y: start.y });
    flushFrame();
    expect(obj(a).x).toBe(ab.x + MOVE_PX);
    expect(obj(b).x).toBe(bb.x + MOVE_PX);
    expect(obj(a).z).toBeGreaterThan(obj(other).z);
    expect(obj(b).z).toBeGreaterThan(obj(a).z); // relative order kept
    expect(selection()).toEqual([a, b].sort());
    expect(selectionBar()).not.toBeNull();
  });

  it('TC-24 testbox edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    const box = addBox(0, 0, 200, 100);
    clickAt(objEl(box), centreOf(box));
    for (const label of HANDLE_LABELS) {
      const h = handle(label);
      expect(h.style.width).toBe(`${HANDLE_SIZE_PX}px`);
      expect(h.style.height).toBe(`${HANDLE_SIZE_PX}px`);
    }
    const right = handle('Resize right');
    const p = { x: 500, y: 500 };
    down(right, p);
    over(right, { x: p.x + 100, y: p.y + 70 });
    up(right, { x: p.x + 100, y: p.y + 70 });
    flushFrame();
    expect(obj(box)).toMatchObject({ x: 0, y: 0, width: 300, height: 100 });

    // Shift on a corner: ratio 3:1 kept.
    const corner = handle('Resize bottom-right');
    down(corner, p);
    over(corner, { x: p.x + 300, y: p.y + 10 }, true);
    up(corner, { x: p.x + 300, y: p.y + 10 }, true);
    flushFrame();
    expect(obj(box)).toMatchObject({ x: 0, y: 0, width: 600, height: 200 });

    // Without Shift, a corner changes both dimensions freely.
    down(corner, p);
    up(corner, p); // a click on a handle does nothing
    down(corner, p);
    over(corner, { x: p.x - 100, y: p.y + 50 });
    up(corner, { x: p.x - 100, y: p.y + 50 });
    flushFrame();
    expect(obj(box)).toMatchObject({ width: 500, height: 250 });
  });

  it('a group resize scales positions and sizes from the opposite edge; stickies stay square', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    selectAll([a, b]);
    const right = handle('Resize right');
    const p = { x: 900, y: 400 };
    down(right, p);
    over(right, { x: p.x + 500, y: p.y });
    up(right, { x: p.x + 500, y: p.y });
    flushFrame();
    expect(obj(a)).toMatchObject({ x: 0, width: 400, height: 400 });
    expect(obj(b)).toMatchObject({ x: 600, width: 400, height: 400 });
  });

  it('TC-26 onGestureStart and onGestureEnd are each called once per drag; cancel keeps the last frame', () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    const ydoc = new Y.Doc();
    initDoc(ydoc);
    const id = createTestBox(ydoc, { x: 0, y: 0, width: 100, height: 100 });

    function Harness() {
      const [version, setVersion] = useState(0);
      useMemo(() => ydoc.on('update', () => setVersion((v) => v + 1)), []);
      const snap = useMemo(() => objectSnapshot(ydoc), [version]);
      const sel = useSelection(snap);
      const g = useTransformGesture({
        doc: ydoc,
        camera: { x: 0, y: 0, zoom: 1 },
        selection: sel,
        snapshot: snap,
        canEdit: true,
        onGestureStart,
        onGestureEnd,
      });
      return <div data-testid="harness-box" onPointerDown={(e) => g.onObjectPointerDown(e, id)} />;
    }

    render(<Harness />);
    const el = screen.getByTestId('harness-box');
    down(el, { x: 0, y: 0 });
    for (let i = 1; i <= 5; i += 1) {
      over(el, { x: i * 10, y: 0 });
      flushFrame();
    }
    up(el, { x: 50, y: 0 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(objectSnapshot(ydoc)[0]!.x).toBe(50);

    // A click (no drag) is not a gesture.
    down(el, { x: 0, y: 0 });
    up(el, { x: 0, y: 0 });
    expect(onGestureStart).toHaveBeenCalledTimes(1);

    // pointercancel mid-drag: the last applied frame stays, the pending one is dropped.
    down(el, { x: 0, y: 0 });
    over(el, { x: 20, y: 0 });
    flushFrame();
    over(el, { x: 40, y: 0 }); // pending
    fireEvent.pointerCancel(el, { pointerId: POINTER_ID });
    flushFrame();
    expect(objectSnapshot(ydoc)[0]!.x).toBe(70);
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
  });
});

describe('sel.keyboard', () => {
  beforeEach(() => {
    renderBoard();
  });

  it('TC-27 Ctrl/Cmd+A selects every registered object (not unknown types), with preventDefault', () => {
    const a = addSticky(0, 0);
    const b = addBox(400, 0, 50, 50);
    act(() => {
      const shape = new Y.Map<unknown>();
      doc().getMap('objects').set('hologram-1', shape);
      shape.set('type', 'hologram');
      shape.set('x', 0);
      shape.set('y', 0);
    });
    expect(key('a', { ctrlKey: true })).toBe(false);
    expect(selection()).toEqual([a, b].sort());
    expect(window.getSelection()?.toString() ?? '').toBe('');
    clickAt(board(), toScreen({ x: 0, y: 900 }));
    expect(selection()).toEqual([]);
    expect(key('a', { metaKey: true })).toBe(false);
    expect(selection()).toEqual([a, b].sort());
    expect(selectionBar()?.textContent).toContain('2 selected');
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing, without error (boundary)', () => {
    expect(() => key('a', { ctrlKey: true })).not.toThrow();
    expect(selection()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('Escape clears the selection', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    selectAll([a, b]);
    key('Escape');
    expect(selection()).toEqual([]);
  });

  it('TC-29 ArrowRight → x + NUDGE_STEP_WORLD; Shift+ArrowUp → y − NUDGE_LARGE_STEP_WORLD; preventDefault', () => {
    const a = addSticky(0, 0);
    const b = addSticky(300, 0);
    const c = addSticky(600, 0);
    selectAll([a, b]);
    const [ab, bb, cb] = [obj(a), obj(b), obj(c)];
    const cam = camera();
    expect(key('ArrowRight')).toBe(false);
    expect(obj(a).x).toBe(ab.x + NUDGE_STEP_WORLD);
    expect(obj(b).x).toBe(bb.x + NUDGE_STEP_WORLD);
    expect(key('ArrowUp', { shiftKey: true })).toBe(false);
    expect(obj(a).y).toBe(ab.y - NUDGE_LARGE_STEP_WORLD);
    expect(obj(b).y).toBe(bb.y - NUDGE_LARGE_STEP_WORLD);
    key('ArrowLeft');
    key('ArrowDown');
    expect(obj(a)).toMatchObject({ x: ab.x, y: ab.y - NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD });
    expect(obj(c)).toEqual(cb);
    flushFrame();
    expect(camera()).toEqual(cam);
  });

  it('arrow keys with nothing selected do nothing and are not intercepted', () => {
    const a = addSticky(0, 0);
    const before = obj(a);
    expect(key('ArrowRight')).toBe(true);
    expect(obj(a)).toEqual(before);
  });

  it('TC-30 Backspace while editing edits the text; selected objects are kept (negative)', async () => {
    const other = addSticky(600, 0);
    const u = user();
    const at = toScreen({ x: 100, y: 100 });
    fireEvent.doubleClick(board(), { clientX: at.x, clientY: at.y });
    expect(editor()).not.toBeNull();
    await u.keyboard('ab');
    await u.keyboard('{Backspace}');
    await u.keyboard('{Delete}');
    // Select all while typing selects the text, not the board's objects.
    await u.keyboard('{Control>}a{/Control}');
    expect(editor()).not.toBeNull();
    const notes = window.__vidi6!.getNotes();
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id !== other)!.text).toBe('a');
  });

  it('TC-31 Delete removes every selected object and empties the selection', () => {
    const [a, b, c] = [addSticky(0, 0), addBox(300, 0, 80, 80), addSticky(600, 0)];
    selectAll([a, b]);
    expect(key('Delete')).toBe(false);
    expect(objects().map((o) => o.id)).toEqual([c]);
    expect(selection()).toEqual([]);
    expect(selectionBar()).toBeNull();
    // Backspace too.
    clickAt(objEl(c), centreOf(c));
    key('Backspace');
    expect(objects()).toHaveLength(0);
  });
});
