import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { createSticky, deleteObjects, snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { addTestbox, registerTestbox } from '../fixtures/testbox';
import { click, frame, noteEl, noteEls, setupBoard, viewport, worldTransform } from './helpers';

registerTestbox();
afterEach(cleanup);

// jsdom window is 1024x768 and the starting camera centres the origin on screen.
const SX = 512;
const SY = 384;

const obj = (doc: Y.Doc, id: string) => snapshot(doc).find((o) => o.id === id)!;
const noteById = (id: string) => noteEls().find((e) => e.getAttribute('data-note-id') === id)!;
const boxEl = (id: string) => document.querySelector(`[data-object-id="${id}"]`)!;

function shiftClick(el: Element) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1, button: 0, shiftKey: true });
  fireEvent.pointerUp(el, { clientX: 100, clientY: 100, pointerId: 1, shiftKey: true });
}

function marquee(from: [number, number], to: [number, number], opts: { shiftKey?: boolean } = { shiftKey: true }) {
  const v = viewport();
  fireEvent.pointerDown(v, { clientX: SX + from[0], clientY: SY + from[1], pointerId: 1, button: 0, ...opts });
  fireEvent.pointerMove(v, { clientX: SX + to[0], clientY: SY + to[1], pointerId: 1, ...opts });
  return {
    up: () => fireEvent.pointerUp(v, { clientX: SX + to[0], clientY: SY + to[1], pointerId: 1, ...opts }),
  };
}

async function drag(el: Element, dx: number, dy: number, id = 1) {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: id, button: 0 });
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: id });
  await frame();
  fireEvent.pointerUp(el, { clientX: 100 + dx, clientY: 100 + dy, pointerId: id });
}

function key(k: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    document.body.dispatchEvent(e);
  });
  return e;
}

function selectTwo() {
  const board = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
  click(noteById(board.ids[0]));
  shiftClick(noteById(board.ids[1]));
  return board;
}

describe('sel.interaction', () => {
  it('TC-16 all selected ids deleted remotely: selection empty, bar hidden', () => {
    const { doc, ids } = selectTwo();
    expect(screen.getByText('2 selected')).toBeTruthy();
    act(() => {
      deleteObjects(doc, ids);
    });
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete selection' })).toBeNull();
  });

  it('sel.remote_delete: one deleted by someone else leaves the rest selected', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 600, y: 0 }]);
    act(() => {
      fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    });
    expect(screen.getByText('3 selected')).toBeTruthy();
    act(() => {
      deleteObjects(doc, [ids[1]]);
    });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(noteEls().every((n) => n.getAttribute('data-selected') === 'true')).toBe(true);
  });

  it('TC-17 two selected: "2 selected", a Delete selection button and a live region', () => {
    selectTwo();
    const status = screen.getByText('2 selected');
    expect(status.textContent).toBe('2 selected');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete note' })).toBeNull();
  });

  it('Delete selection removes every selected object and clears the selection', () => {
    const { doc } = selectTwo();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('TC-18 one sticky selected: the note toolbar instead of the bar', () => {
    setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    click(noteEl(0));
    expect(screen.getByRole('toolbar', { name: 'Note tools' })).toBeTruthy();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('shift-click removes a selected object; shift-click adds an unselected one', () => {
    const { ids } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }]);
    click(noteById(ids[0]));
    shiftClick(noteById(ids[1]));
    shiftClick(noteById(ids[2]));
    expect(screen.getByText('3 selected')).toBeTruthy();
    shiftClick(noteById(ids[0]));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('false');
    // plain click on a member of a multi-selection selects only it
    click(noteById(ids[1]));
    expect(noteById(ids[2]).getAttribute('data-selected')).toBe('false');
    expect(noteById(ids[1]).getAttribute('data-selected')).toBe('true');
  });

  it('TC-19 clicking empty space without dragging clears the selection; Escape too', () => {
    selectTwo();
    fireEvent.pointerDown(viewport(), { clientX: 900, clientY: 700, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport(), { clientX: 900, clientY: 700, pointerId: 1 });
    expect(screen.queryByText(/selected/)).toBeNull();
    expect(noteEls().every((n) => n.getAttribute('data-selected') === 'false')).toBe(true);

    click(noteEl(0));
    key('Escape');
    expect(noteEl(0).getAttribute('data-selected')).toBe('false');
  });

  it('the selection bounding box has 8 labelled handles', () => {
    selectTwo();
    for (const l of ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left']) {
      expect(screen.getByRole('button', { name: `Resize ${l}` })).toBeTruthy();
    }
  });
});

describe('sel.marquee_ui', () => {
  it('TC-20 Shift+drag adds fully-inside objects to the existing selection', () => {
    const { ids } = setupBoard([{ x: -500, y: -400 }, { x: 0, y: 0 }, { x: 150, y: 0 }, { x: 900, y: 900 }]);
    // world rects: n0 (-600,-500), n1 (-100,-100)-(100,100), n2 (50,-100)-(250,100) half inside, n3 far
    click(noteById(ids[0]));
    const m = marquee([-150, -150], [150, 150]);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    m.up();
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('true'); // additive
    expect(noteById(ids[1]).getAttribute('data-selected')).toBe('true');
    expect(noteById(ids[2]).getAttribute('data-selected')).toBe('false'); // partly inside
    expect(noteById(ids[3]).getAttribute('data-selected')).toBe('false');
  });

  it('TC-21 a plain drag on empty space pans and draws no marquee', async () => {
    setupBoard([{ x: 0, y: 0 }]);
    const before = worldTransform();
    marquee([-300, -300], [300, 300], {}).up();
    await frame();
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(worldTransform()).not.toBe(before);
  });

  it('TC-22 pointercancel mid-marquee leaves the selection unchanged', () => {
    const { ids } = setupBoard([{ x: 0, y: 0 }, { x: 600, y: 0 }]);
    click(noteById(ids[1]));
    marquee([-300, -300], [300, 300]);
    expect(screen.getByTestId('marquee')).toBeTruthy();
    fireEvent.pointerCancel(viewport(), { pointerId: 1 });
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('false');
    expect(noteById(ids[1]).getAttribute('data-selected')).toBe('true');
  });

  it('Escape mid-marquee discards it', () => {
    const { ids } = setupBoard([{ x: 0, y: 0 }]);
    const m = marquee([-300, -300], [300, 300]);
    key('Escape');
    m.up();
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('false');
  });

  it('an empty marquee selects nothing and keeps the selection', () => {
    const { ids } = setupBoard([{ x: 0, y: 0 }]);
    click(noteEl(0));
    marquee([500, 500], [600, 600]).up();
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('true');
  });
});

describe('sel.transform', () => {
  it('TC-23 dragging an unselected object selects only it and moves only it', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    click(noteById(ids[0]));
    const a0 = obj(doc, ids[0]);
    const b0 = obj(doc, ids[1]);
    await drag(noteById(ids[1]), 40, 10);
    expect(noteById(ids[0]).getAttribute('data-selected')).toBe('false');
    expect(noteById(ids[1]).getAttribute('data-selected')).toBe('true');
    expect(obj(doc, ids[0]).x).toBe(a0.x);
    expect(obj(doc, ids[1])).toMatchObject({ x: b0.x + 40, y: b0.y + 10 });
  });

  it('TC-23 boundary: threshold - 1 is a click (no write), exactly the threshold drags', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    const x0 = obj(doc, ids[0]).x;
    await drag(noteEl(), DRAG_THRESHOLD_PX - 1, 0);
    expect(obj(doc, ids[0]).x).toBe(x0);
    await drag(noteEl(), DRAG_THRESHOLD_PX, 0);
    expect(obj(doc, ids[0]).x).toBe(x0 + DRAG_THRESHOLD_PX);
  });

  it('sel.group_move: dragging a selected object moves all selected by the same distance, above the rest', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }]);
    click(noteById(ids[0]));
    shiftClick(noteById(ids[1]));
    const before = ids.map((id) => obj(doc, id));
    await drag(noteById(ids[0]), 300, 20);
    expect(obj(doc, ids[0])).toMatchObject({ x: before[0].x + 300, y: before[0].y + 20 });
    expect(obj(doc, ids[1])).toMatchObject({ x: before[1].x + 300, y: before[1].y + 20 });
    expect(obj(doc, ids[2]).x).toBe(before[2].x);
    const z = (i: number) => obj(doc, ids[i]).z;
    expect(z(0)).toBeGreaterThan(z(2));
    expect(z(1)).toBeGreaterThan(z(2));
    expect(z(0)).toBeLessThan(z(1)); // relative order kept
    expect(screen.getByText('2 selected')).toBeTruthy(); // still selected afterwards
  });

  it('TC-24 a testbox edge handle changes width only; Shift keeps the ratio', async () => {
    const doc = new Y.Doc();
    const id = addTestbox(doc, { x: 0, y: 0, width: 200, height: 100 });
    render(<App doc={doc} />);
    click(boxEl(id));
    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: 200, clientY: 50, pointerId: 2, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 90, pointerId: 2 });
    await frame();
    fireEvent.pointerUp(handle, { clientX: 300, clientY: 90, pointerId: 2 });
    expect(obj(doc, id)).toMatchObject({ x: 0, y: 0, width: 300, height: 100 });

    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(corner, { clientX: 300, clientY: 100, pointerId: 3, button: 0 });
    fireEvent.pointerMove(corner, { clientX: 600, clientY: 100, pointerId: 3, shiftKey: true });
    await frame();
    fireEvent.pointerUp(corner, { clientX: 600, clientY: 100, pointerId: 3 });
    const o = obj(doc, id);
    expect(o.width).toBe(600);
    expect(o.height).toBe(200);
  });

  it('a testbox stops at its minimum size, the whole selection with it', async () => {
    const doc = new Y.Doc();
    const a = addTestbox(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = addTestbox(doc, { x: 300, y: 0, width: 20, height: 100 });
    render(<App doc={doc} />);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: 320, clientY: 50, pointerId: 2, button: 0 });
    fireEvent.pointerMove(handle, { clientX: -2000, clientY: 50, pointerId: 2 });
    await frame();
    fireEvent.pointerUp(handle, { clientX: -2000, clientY: 50, pointerId: 2 });
    expect(obj(doc, b).width).toBeCloseTo(10); // b hits its minimum (10) first: scale 0.5
    expect(obj(doc, a).width).toBeCloseTo(50);
  });

  it('sticky notes stay square when resized, even with an edge handle', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 300, y: 0 }]);
    fireEvent.keyDown(document.body, { key: 'a', ctrlKey: true });
    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: 400, clientY: 100, pointerId: 2, button: 0 });
    fireEvent.pointerMove(handle, { clientX: 900, clientY: 100, pointerId: 2 }); // box 500 -> 1000: x2
    await frame();
    fireEvent.pointerUp(handle, { clientX: 900, clientY: 100, pointerId: 2 });
    const [a, b] = ids.map((id) => obj(doc, id));
    expect(a).toMatchObject({ width: 400, height: 400 });
    expect(b.x - (a.x + a.width)).toBe(200); // gap scaled 100 -> 200
  });

  it('sel.size_limits: sticky notes cannot shrink below 50', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 2, button: 0 });
    fireEvent.pointerMove(handle, { clientX: -400, clientY: -400, pointerId: 2 });
    await frame();
    fireEvent.pointerUp(handle, { clientX: -400, clientY: -400, pointerId: 2 });
    expect(obj(doc, ids[0])).toMatchObject({ width: 50, height: 50 });
  });

  function hook(doc: Y.Doc, canEdit: boolean, extra: { onGestureStart?(): void; onGestureEnd?(): void } = {}) {
    const snap = snapshot(doc);
    return renderHook(() => {
      const selection = useSelection(snap);
      const gesture = useTransformGesture({ doc, camera: { x: 0, y: 0, zoom: 1 }, selection, snapshot: snap, canEdit, ...extra });
      return { selection, gesture };
    });
  }
  const ev = (x: number, y: number, pointerId = 1) => ({ button: 0, clientX: x, clientY: y, pointerId, shiftKey: false, currentTarget: null });
  const winMove = (x: number, y: number) => fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });

  it('TC-25 canEdit false: the gesture is refused and nothing is written', async () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const updates = vi.fn();
    const { result } = hook(doc, false);
    doc.on('update', updates);
    act(() => result.current.gesture.onObjectPointerDown(ev(0, 0), id));
    winMove(100, 100);
    await frame();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(updates).not.toHaveBeenCalled();
    expect(result.current.selection.ids.has(id)).toBe(true); // viewing still works
    act(() => result.current.gesture.onHandlePointerDown(ev(0, 0), 'se'));
    winMove(100, 100);
    await frame();
    expect(updates).not.toHaveBeenCalled();
  });

  it('TC-26 onGestureStart/End once per drag; pointercancel keeps the last applied position', async () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const start = vi.fn();
    const end = vi.fn();
    const { result } = hook(doc, true, { onGestureStart: start, onGestureEnd: end });
    const x0 = obj(doc, id).x;
    act(() => result.current.gesture.onObjectPointerDown(ev(0, 0), id));
    winMove(10, 0);
    winMove(20, 0);
    await frame();
    expect(start).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    fireEvent.pointerCancel(window, { pointerId: 1 });
    expect(end).toHaveBeenCalledTimes(1);
    expect(obj(doc, id).x).toBe(x0 + 20);
    winMove(500, 0); // after the gesture: ignored
    await frame();
    expect(obj(doc, id).x).toBe(x0 + 20);
  });

  it('objects deleted mid-gesture are skipped', async () => {
    const doc = new Y.Doc();
    const a = createSticky(doc, { x: 0, y: 0 });
    const b = createSticky(doc, { x: 400, y: 0 });
    const { result } = hook(doc, true);
    act(() => result.current.selection.setMany([a, b], false));
    act(() => result.current.gesture.onObjectPointerDown(ev(0, 0), a));
    winMove(10, 0);
    await frame();
    deleteObjects(doc, [b]);
    winMove(30, 0);
    await frame();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(obj(doc, a).x).toBe(-100 + 30);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('sel.keyboard', () => {
  it('TC-27 Ctrl/Cmd+A selects everything and prevents the default', () => {
    setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    expect(key('a', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(screen.getByText('2 selected')).toBeTruthy();
    click(noteEl(0));
    expect(key('A', { metaKey: true }).defaultPrevented).toBe(true);
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('TC-28 Ctrl/Cmd+A on an empty board selects nothing, no error', () => {
    setupBoard();
    expect(() => key('a', { ctrlKey: true })).not.toThrow();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('TC-29 arrows nudge by NUDGE_STEP_WORLD, Shift+arrow by NUDGE_LARGE_STEP_WORLD', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    key('a', { ctrlKey: true });
    const before = ids.map((id) => obj(doc, id));
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(obj(doc, ids[0]).x).toBe(before[0].x + NUDGE_STEP_WORLD);
    expect(obj(doc, ids[1]).x).toBe(before[1].x + NUDGE_STEP_WORLD);
    expect(key('ArrowUp', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(obj(doc, ids[0]).y).toBe(before[0].y - NUDGE_LARGE_STEP_WORLD);
    key('ArrowLeft');
    key('ArrowDown');
    expect(obj(doc, ids[0])).toMatchObject({ x: before[0].x, y: before[0].y - NUDGE_LARGE_STEP_WORLD + 1 });
  });

  it('arrows with no selection do nothing and are not prevented', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    const before = obj(doc, ids[0]);
    expect(key('ArrowRight').defaultPrevented).toBe(false);
    expect(obj(doc, ids[0])).toEqual(before);
  });

  it('TC-30 Backspace while editing text edits the text and keeps the objects', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    click(noteById(ids[0]));
    fireEvent.doubleClick(noteById(ids[0]));
    const box = screen.getByRole('textbox');
    const e = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    act(() => {
      box.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(false);
    expect(snapshot(doc)).toHaveLength(2);
    // select all is also left to the text box
    const a = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      box.dispatchEvent(a);
    });
    expect(a.defaultPrevented).toBe(false);
  });

  it('TC-31 Delete and Backspace remove all selected objects and empty the selection', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 800, y: 0 }]);
    key('a', { ctrlKey: true });
    key('Delete');
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByText(/selected/)).toBeNull();

    const board = setupBoard([{ x: 0, y: 0 }]);
    cleanup();
    const again = setupBoard([{ x: 0, y: 0 }, { x: 400, y: 0 }]);
    click(noteEl(0));
    shiftClick(noteEl(1));
    key('Backspace');
    expect(snapshot(again.doc)).toHaveLength(0);
    expect(snapshot(board.doc)).toHaveLength(1);
  });

  it('Enter still starts editing a single selected note', () => {
    setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    key('Enter');
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('the bar is hidden while a note is being edited', () => {
    setupBoard([{ x: 0, y: 0 }]);
    click(noteEl());
    fireEvent.doubleClick(noteEl());
    expect(within(document.body).queryByRole('toolbar', { name: 'Note tools' })).toBeNull();
  });
});

describe('selection helpers', () => {
  it('actions naming an id that is not on the board are ignored', () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const snap: readonly ObjectSnapshot[] = snapshot(doc);
    const { result } = renderHook(() => useSelection(snap));
    act(() => result.current.click('ghost'));
    act(() => result.current.toggle('ghost'));
    act(() => result.current.setMany(['ghost', id], false));
    expect([...result.current.ids]).toEqual([id]);
  });
});
