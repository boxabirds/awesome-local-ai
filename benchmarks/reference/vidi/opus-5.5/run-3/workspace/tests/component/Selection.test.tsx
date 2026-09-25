import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import * as Y from 'yjs';
import {
  createSticky,
  deleteObjects,
  getStickyText,
  initDoc,
  objectSnapshot,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  HANDLE_SIZE_PX,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { createTestbox } from '../fixtures/testbox';
import { FakeProvider } from './fakeProvider';
import { camera, countUpdates, dispatchPrevented, nextFrame, noteEl, pointer, press, renderApp, setCamera } from './helpers';

/** A note whose top-left is at world (x, y). */
function noteAt(doc: Y.Doc, x: number, y: number) {
  return createSticky(doc, { x: x + STICKY_SIZE_WORLD / 2, y: y + STICKY_SIZE_WORLD / 2 });
}

function obj(doc: Y.Doc, id: string): ObjectSnapshot | undefined {
  return objectSnapshot(doc).find((o) => o.id === id);
}

function selectedIds(): string[] {
  return window.__vidi6!.selection!();
}

function keyWith(k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  return dispatchPrevented(target, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

function selectAll() {
  return keyWith('a', { ctrlKey: true });
}

/** Pointer event with modifiers, dispatched on `el` (moves and releases bubble to window like real ones). */
function ptr(el: Element, type: 'down' | 'move' | 'up' | 'cancel', x: number, y: number, shiftKey = false) {
  const init = { clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'up' ? 0 : 1, shiftKey };
  act(() => {
    if (type === 'down') fireEvent.pointerDown(el, init);
    if (type === 'move') fireEvent.pointerMove(el, init);
    if (type === 'up') fireEvent.pointerUp(el, init);
    if (type === 'cancel') fireEvent.pointerCancel(el, init);
  });
}

function selectionBar() {
  return screen.queryByRole('toolbar', { name: 'Selection' });
}

function announcer() {
  return screen.getByTestId('selection-announcer');
}

/** A doc with three notes in a row, 300 apart (top-left at x = 0, 300, 600). */
function threeNotes() {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = [noteAt(doc, 0, 0), noteAt(doc, 300, 0), noteAt(doc, 600, 0)];
  return { doc, ids };
}

/** Renders the app with world = screen (camera at the origin, 100%). */
function renderAt(doc: Y.Doc) {
  const utils = renderApp(doc);
  setCamera({ x: 0, y: 0, zoom: 1 });
  return utils;
}

describe('selection state and bar (sel.interaction)', () => {
  it('TC-16 when every selected note is deleted by someone else the selection empties and the bar hides', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    expect(selectionBar()).toHaveTextContent('3 selected');
    act(() => {
      deleteObjects(doc, ids);
    });
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
    expect(announcer()).toHaveTextContent('');
  });

  it('one of several selected notes deleted by someone else leaves the rest selected', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    act(() => {
      deleteObjects(doc, [ids[1]]);
    });
    expect(selectedIds()).toEqual([ids[0], ids[2]].sort());
    expect(selectionBar()).toHaveTextContent('2 selected');
  });

  it('TC-17 two selected notes show "2 selected" with Delete selection, announced politely', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    press(noteEl(ids[0]));
    ptr(noteEl(ids[1]), 'down', 310, 10, true);
    ptr(noteEl(ids[1]), 'up', 310, 10, true);
    expect(selectedIds()).toEqual([ids[0], ids[1]].sort());
    const bar = selectionBar()!;
    expect(bar).toHaveTextContent('2 selected');
    expect(screen.getByTestId('board-world-overlay')).toContainElement(bar);
    expect(screen.queryByRole('toolbar', { name: 'Note' })).toBeNull();
    expect(announcer()).toHaveAttribute('aria-live', 'polite');
    expect(announcer()).toHaveTextContent('2 selected');
    expect(noteEl(ids[0])).toHaveAttribute('data-selected', 'true');
    expect(noteEl(ids[1])).toHaveAttribute('data-selected', 'true');
    expect(noteEl(ids[2])).toHaveAttribute('data-selected', 'false');
    act(() => screen.getByRole('button', { name: 'Delete selection' }).click());
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[2]]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('TC-18 exactly one selected note shows the note toolbar instead of the bar', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    press(noteEl(ids[0]));
    expect(screen.getByRole('toolbar', { name: 'Note' })).toBeInTheDocument();
    expect(selectionBar()).toBeNull();
    expect(announcer()).toHaveTextContent('1 selected');
  });

  it('TC-19 a click on empty board space without dragging clears the selection', () => {
    const { doc } = threeNotes();
    const { viewport } = renderAt(doc);
    selectAll();
    expect(selectedIds()).toHaveLength(3);
    press(viewport, 600, 500);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('Shift-click toggles one note in and out, leaving the others', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    press(noteEl(ids[0]));
    ptr(noteEl(ids[2]), 'down', 610, 10, true);
    ptr(noteEl(ids[2]), 'up', 610, 10, true);
    expect(selectedIds()).toEqual([ids[0], ids[2]].sort());
    ptr(noteEl(ids[0]), 'down', 10, 10, true);
    ptr(noteEl(ids[0]), 'up', 10, 10, true);
    expect(selectedIds()).toEqual([ids[2]]);
    ptr(noteEl(ids[2]), 'down', 610, 10, true);
    ptr(noteEl(ids[2]), 'up', 610, 10, true);
    expect(selectedIds()).toEqual([]);
  });

  it('a plain click on one note of a multi-selection selects only that note', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    press(noteEl(ids[1]), 310, 10);
    expect(selectedIds()).toEqual([ids[1]]);
  });

  it('objects of unknown types are not rendered or selected', () => {
    const { doc, ids } = threeNotes();
    doc.transact(() => {
      const m = new Y.Map<unknown>();
      m.set('type', 'hologram');
      m.set('x', 0);
      m.set('y', 0);
      doc.getMap('objects').set('holo', m);
    });
    renderAt(doc);
    selectAll();
    expect(selectedIds()).toEqual([...ids].sort());
  });
});

describe('marquee (sel.marquee_ui)', () => {
  it('TC-20 Shift+drag adds objects fully inside to the existing selection; partly inside is not selected', () => {
    const { doc, ids } = threeNotes();
    const far = noteAt(doc, 0, 500);
    const { viewport } = renderAt(doc);
    press(noteEl(far), 10, 510);
    // From (-20, -20) to (520, 220): note 0 fully inside, note 1 (300..500) inside, note 2 (600..800) outside.
    ptr(viewport, 'down', -20, -20, true);
    ptr(viewport, 'move', 200, 100, true);
    expect(screen.getByTestId('marquee')).toBeInTheDocument();
    expect(viewport).toHaveAttribute('data-state', 'marquee');
    ptr(viewport, 'move', 520, 220, true);
    ptr(viewport, 'up', 520, 220, true);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([far, ids[0], ids[1]].sort());

    // Partly inside: a box cutting note 2 in half selects nothing new.
    ptr(viewport, 'down', 650, -20, true);
    ptr(viewport, 'up', 900, 220, true);
    expect(selectedIds()).toEqual([far, ids[0], ids[1]].sort());
  });

  it('the marquee rect is in world units: at 50% zoom it covers twice the screen distance', () => {
    const { doc, ids } = threeNotes();
    const { viewport } = renderApp(doc);
    setCamera({ x: 0, y: 0, zoom: 0.5 });
    ptr(viewport, 'down', -5, -5, true);
    ptr(viewport, 'up', 260, 110, true); // world (520, 220)
    expect(selectedIds()).toEqual([ids[0], ids[1]].sort());
  });

  it('TC-21 a plain drag on empty space pans the board and never starts a marquee', () => {
    const { doc, ids } = threeNotes();
    const { viewport } = renderAt(doc);
    press(noteEl(ids[0]));
    const before = camera();
    ptr(viewport, 'down', -20, -20);
    ptr(viewport, 'move', 520, 220);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(viewport).toHaveAttribute('data-state', 'panning');
    nextFrame();
    ptr(viewport, 'up', 520, 220);
    expect(camera()).not.toEqual(before);
    expect(selectedIds()).toEqual([ids[0]]);
  });

  it('TC-22 pointercancel mid-marquee discards it and leaves the selection unchanged', () => {
    const { doc, ids } = threeNotes();
    const { viewport } = renderAt(doc);
    press(noteEl(ids[2]), 610, 10);
    ptr(viewport, 'down', -20, -20, true);
    ptr(viewport, 'move', 520, 220, true);
    ptr(viewport, 'cancel', 520, 220, true);
    expect(screen.queryByTestId('marquee')).toBeNull();
    expect(selectedIds()).toEqual([ids[2]]);
  });

  it('Escape mid-marquee discards it and keeps the selection', () => {
    const { doc, ids } = threeNotes();
    const { viewport } = renderAt(doc);
    press(noteEl(ids[2]), 610, 10);
    ptr(viewport, 'down', -20, -20, true);
    ptr(viewport, 'move', 520, 220, true);
    keyWith('Escape');
    expect(screen.queryByTestId('marquee')).toBeNull();
    ptr(viewport, 'up', 520, 220, true);
    expect(selectedIds()).toEqual([ids[2]]);
  });
});

describe('transform gesture (sel.transform)', () => {
  it('TC-23 dragging unselected b while a is selected selects only b and moves only b', () => {
    const { doc, ids } = threeNotes();
    const [a, b] = ids;
    renderAt(doc);
    press(noteEl(a));
    const aBefore = obj(doc, a);
    // DRAG_THRESHOLD_PX − 1 is still a click: nothing written.
    const updates = countUpdates(doc, () => {
      ptr(noteEl(b), 'down', 310, 10);
      ptr(noteEl(b), 'move', 310 + DRAG_THRESHOLD_PX - 1, 10);
      nextFrame();
    });
    expect(updates).toBe(0);
    expect(selectedIds()).toEqual([b]);
    // Exactly DRAG_THRESHOLD_PX starts the gesture.
    ptr(noteEl(b), 'move', 310 + DRAG_THRESHOLD_PX, 10);
    nextFrame();
    expect(obj(doc, b)).toMatchObject({ x: 300 + DRAG_THRESHOLD_PX, y: 0 });
    ptr(noteEl(b), 'move', 410, 60);
    ptr(noteEl(b), 'up', 410, 60);
    expect(obj(doc, b)).toMatchObject({ x: 400, y: 50 });
    expect(obj(doc, a)).toEqual(aBefore);
    expect(selectedIds()).toEqual([b]);
  });

  it('dragging a selected note moves the whole selection by the same distance and lifts it to the front', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = noteAt(doc, 0, 0);
    const b = noteAt(doc, 100, 50); // overlaps a, above it
    const other = noteAt(doc, 1000, 0); // topmost, unselected
    renderAt(doc);
    press(noteEl(a));
    ptr(noteEl(b), 'down', 150, 60, true);
    ptr(noteEl(b), 'up', 150, 60, true);
    ptr(noteEl(a), 'down', 10, 10);
    ptr(noteEl(a), 'move', 110, 10);
    expect(noteEl(a)).toHaveAttribute('data-state', 'dragging');
    expect(noteEl(b)).toHaveAttribute('data-state', 'dragging');
    expect(selectionBar()).toBeNull(); // hidden while moving
    ptr(noteEl(a), 'up', 310, 10);
    expect(obj(doc, a)).toMatchObject({ x: 300, y: 0 });
    expect(obj(doc, b)).toMatchObject({ x: 400, y: 50 });
    expect(snapshot(doc).map((n) => n.id)).toEqual([other, a, b]);
    expect(selectedIds()).toEqual([a, b].sort());
    expect(selectionBar()).toHaveTextContent('2 selected');
  });

  it('TC-24 a testbox edge handle changes width only; Shift keeps the ratio; handles are labelled', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const box1 = createTestbox(doc, { x: 0, y: 0, width: 100, height: 50 });
    const box2 = createTestbox(doc, { x: 200, y: 0, width: 100, height: 50 });
    renderAt(doc);
    selectAll();
    const labels = screen.getAllByRole('button', { name: /^Resize / }).map((h) => h.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(
      ['top-left', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left'].map((p) => `Resize ${p}`).sort(),
    );
    const right = screen.getByRole('button', { name: 'Resize right' });
    expect(right.style.width).toBe(`${HANDLE_SIZE_PX}px`);
    // Box 300×50 → drag the right edge by +300: twice as wide, same height.
    ptr(right, 'down', 300, 25);
    ptr(right, 'move', 600, 25);
    ptr(right, 'up', 600, 25);
    expect(obj(doc, box1)).toMatchObject({ x: 0, y: 0, width: 200, height: 50 });
    expect(obj(doc, box2)).toMatchObject({ x: 400, y: 0, width: 200, height: 50 });
    // Now 600×50. Shift + right edge +600 → 1200 wide, and the height doubles about the centre.
    const right2 = screen.getByRole('button', { name: 'Resize right' });
    ptr(right2, 'down', 600, 25, true);
    ptr(right2, 'move', 1200, 25, true);
    ptr(right2, 'up', 1200, 25, true);
    expect(obj(doc, box1)).toMatchObject({ x: 0, y: -25, width: 400, height: 100 });
    expect(obj(doc, box2)).toMatchObject({ x: 800, y: -25, width: 400, height: 100 });
    // Handles keep their screen size at another zoom.
    setCamera({ x: 0, y: 0, zoom: 2 });
    expect(screen.getByRole('button', { name: 'Resize left' }).style.width).toBe(`${HANDLE_SIZE_PX}px`);
  });

  it('a sticky note always stays square and stops at the minimum size', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    press(noteEl(ids[0]));
    const right = screen.getByRole('button', { name: 'Resize right' });
    ptr(right, 'down', 200, 100);
    ptr(right, 'move', 300, 100);
    ptr(right, 'up', 300, 100);
    expect(obj(doc, ids[0])).toMatchObject({ width: 300, height: 300 });
    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });
    ptr(corner, 'down', 300, 300);
    ptr(corner, 'move', -500, -500);
    ptr(corner, 'up', -500, -500);
    expect(obj(doc, ids[0])).toMatchObject({ x: 0, y: -50, width: 50, height: 50 });
  });

  it('TC-26 onGestureStart and onGestureEnd are each called once per drag; cancel keeps the last applied state', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const a = createTestbox(doc, { x: 0, y: 0, width: 100, height: 100 });
    const b = createTestbox(doc, { x: 200, y: 0, width: 100, height: 100 });
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    function Harness() {
      const { objects } = useBoardDoc(undefined, doc);
      const selection = useSelection(objects);
      const [cam] = useState({ x: 0, y: 0, zoom: 1 });
      const g = useTransformGesture({ doc, camera: cam, selection, snapshot: objects, canEdit: true, onGestureStart, onGestureEnd });
      return (
        <>
          {objects.map((o) => (
            <div key={o.id} data-testid={o.id} onPointerDown={(e) => g.onObjectPointerDown(e, o.id)} />
          ))}
          <button type="button" onClick={() => selection.setMany([a, b], false)}>
            all
          </button>
        </>
      );
    }
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<Harness />);
    act(() => screen.getByText('all').click());
    const el = screen.getByTestId(a);
    // A click without dragging is not a gesture.
    ptr(el, 'down', 0, 0);
    ptr(el, 'up', 0, 0);
    expect(onGestureStart).not.toHaveBeenCalled();
    act(() => screen.getByText('all').click());
    ptr(el, 'down', 0, 0);
    ptr(el, 'move', 10, 0);
    ptr(el, 'move', 20, 0);
    nextFrame();
    ptr(el, 'move', 30, 0);
    ptr(el, 'up', 40, 0);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(obj(doc, a)).toMatchObject({ x: 40 });
    expect(obj(doc, b)).toMatchObject({ x: 240 });
    // Cancel mid-drag: the last applied frame stays.
    ptr(el, 'down', 0, 0);
    ptr(el, 'move', 50, 0);
    nextFrame();
    ptr(el, 'move', 90, 0); // not applied yet
    ptr(el, 'cancel', 90, 0);
    nextFrame();
    expect(obj(doc, a)).toMatchObject({ x: 90 });
    expect(obj(doc, b)).toMatchObject({ x: 290 });
    expect(onGestureStart).toHaveBeenCalledTimes(2);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
  });

  it('an object deleted by someone else mid-drag is skipped; the rest keep moving', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    ptr(noteEl(ids[0]), 'down', 10, 10);
    ptr(noteEl(ids[0]), 'move', 60, 10);
    nextFrame();
    act(() => {
      deleteObjects(doc, [ids[1]]);
    });
    ptr(noteEl(ids[0]), 'move', 110, 10);
    nextFrame();
    ptr(noteEl(ids[0]), 'up', 110, 10);
    expect(obj(doc, ids[0])).toMatchObject({ x: 100 });
    expect(obj(doc, ids[2])).toMatchObject({ x: 700 });
    expect(obj(doc, ids[1])).toBeUndefined();
    expect(selectedIds()).toEqual([ids[0], ids[2]].sort());
  });
});

describe('selection keyboard commands (sel.keyboard)', () => {
  it('TC-27 Ctrl+A and Cmd+A select every object and prevent the page text selection', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    expect(selectAll()).toBe(true);
    expect(selectedIds()).toEqual([...ids].sort());
    act(() => {
      keyWith('Escape');
    });
    expect(selectedIds()).toEqual([]);
    expect(keyWith('a', { metaKey: true })).toBe(true);
    expect(selectedIds()).toEqual([...ids].sort());
    expect(announcer()).toHaveTextContent('3 selected');
  });

  it('TC-28 Ctrl+A on an empty board selects nothing, without errors', () => {
    const { viewport } = renderApp();
    expect(() => expect(selectAll()).toBe(true)).not.toThrow();
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
    expect(viewport).toBeInTheDocument();
  });

  it('TC-29 ArrowRight nudges by NUDGE_STEP_WORLD, Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD, without scrolling', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    const cam = camera();
    expect(keyWith('ArrowRight')).toBe(true);
    expect(obj(doc, ids[0])).toMatchObject({ x: NUDGE_STEP_WORLD, y: 0 });
    expect(obj(doc, ids[2])).toMatchObject({ x: 600 + NUDGE_STEP_WORLD, y: 0 });
    expect(keyWith('ArrowUp', { shiftKey: true })).toBe(true);
    expect(obj(doc, ids[1])).toMatchObject({ x: 300 + NUDGE_STEP_WORLD, y: -NUDGE_LARGE_STEP_WORLD });
    expect(keyWith('ArrowLeft')).toBe(true);
    expect(keyWith('ArrowDown')).toBe(true);
    expect(obj(doc, ids[0])).toMatchObject({ x: 0, y: -NUDGE_LARGE_STEP_WORLD + NUDGE_STEP_WORLD });
    expect(camera()).toBe(cam);
    // With nothing selected arrows are left alone.
    keyWith('Escape');
    expect(keyWith('ArrowRight')).toBe(false);
  });

  it('TC-30 Backspace while typing in a note edits text and keeps every object', () => {
    const { doc, ids } = threeNotes();
    getStickyText(doc, ids[0])!.insert(0, 'abc');
    renderAt(doc);
    selectAll();
    act(() => {
      fireEvent.doubleClick(noteEl(ids[0]));
    });
    const textarea = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement;
    expect(keyWith('Backspace', {}, textarea)).toBe(false);
    expect(keyWith('Delete', {}, textarea)).toBe(false);
    expect(keyWith('a', { ctrlKey: true }, textarea)).toBe(false);
    // The browser's own Backspace edit arrives as input.
    act(() => {
      textarea.value = 'ab';
      fireEvent.input(textarea);
    });
    expect(getStickyText(doc, ids[0])!.toString()).toBe('ab');
    expect(snapshot(doc)).toHaveLength(3);
  });

  it.each(['Delete', 'Backspace'])('TC-31 %s removes every selected object and empties the selection', (k) => {
    const { doc, ids } = threeNotes();
    const { viewport } = renderAt(doc);
    ptr(viewport, 'down', -20, -20, true);
    ptr(viewport, 'up', 520, 220, true);
    expect(selectedIds()).toEqual([ids[0], ids[1]].sort());
    expect(keyWith(k)).toBe(true);
    expect(snapshot(doc).map((n) => n.id)).toEqual([ids[2]]);
    expect(selectedIds()).toEqual([]);
    expect(selectionBar()).toBeNull();
  });

  it('Enter edits a single selected note but not a multi-selection', () => {
    const { doc, ids } = threeNotes();
    renderAt(doc);
    selectAll();
    expect(keyWith('Enter')).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    press(noteEl(ids[1]), 310, 10);
    expect(keyWith('Enter', {}, noteEl(ids[1]))).toBe(true);
    expect(noteEl(ids[1])).toHaveAttribute('data-state', 'editing');
  });
});

describe('load failed (sel.transform, sel.keyboard)', () => {
  afterEach(() => {
    vi.doUnmock('../../src/client/sync/connectBoard');
    vi.resetModules();
  });

  it('TC-25 while the board failed to load, selection works but no move, resize, nudge or delete writes', async () => {
    const provider = new FakeProvider();
    vi.resetModules(); // App is already loaded (statically, through other imports); load it again with the mock
    vi.doMock('../../src/client/sync/connectBoard', async (importOriginal) => {
      const real = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
      return {
        ...real,
        connectBoard: (_doc: Y.Doc, _id: string, onState: (s: ConnectionState) => void) => ({
          destroy: real.trackConnectionState(provider, onState),
        }),
      };
    });
    const { App } = await import('../../src/client/App');
    const { doc, ids } = threeNotes();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    render(<App boardId="AbCdEfGhIjKlMnOpQr_-09" doc={doc} />);
    setCamera({ x: 0, y: 0, zoom: 1 });
    provider.connect();
    provider.closedByServer(CLOSE_BOARD_LOAD_FAILED);
    expect(screen.getByRole('status', { name: 'Connection status' })).toHaveTextContent("couldn't be loaded");
    const viewport = screen.getByTestId('board-viewport');
    const before = JSON.stringify(objectSnapshot(doc));
    const updates = countUpdates(doc, () => {
      selectAll();
      expect(selectedIds()).toHaveLength(3);
      expect(screen.queryAllByRole('button', { name: /^Resize / })).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Delete selection' })).toBeDisabled();
      pointer(noteEl(ids[0]), 'down', 10, 10);
      pointer(noteEl(ids[0]), 'move', 200, 200);
      nextFrame();
      pointer(noteEl(ids[0]), 'up', 200, 200);
      keyWith('ArrowRight');
      keyWith('Delete');
      keyWith('Backspace');
      ptr(viewport, 'down', -20, -20, true);
      ptr(viewport, 'up', 900, 300, true);
    });
    expect(updates).toBe(0);
    expect(JSON.stringify(objectSnapshot(doc))).toBe(before);
    expect(selectedIds()).toHaveLength(3);
  });
});
