/**
 * Story 7 component tests: selection bar, marquee, transform gesture and
 * keyboard commands (TC-16 to TC-31), with a real Y.Doc and the test-only
 * testbox type (imported for its registration side effect).
 *
 * Camera fixture: origin centred, 100% zoom, 1280x800 viewport (setup.ts),
 * so world (0,0) sits at screen (640,400) and 1 world unit = 1 px.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import * as Y from 'yjs';
import type { JSX } from 'react';
import {
  createSticky,
  deleteObjects,
  snapshot,
  snapshotAll,
} from '../../src/shared/board-model';
import { renderStickyBoard } from './harness';
import { mockProviders } from './setup';
import { StickyNote } from '../../src/client/objects/StickyNote';
import { useBoardDoc } from '../../src/client/board/useBoardDoc';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { createTestbox, TESTBOX_HEIGHT, TESTBOX_WIDTH } from '../fixtures/testbox';
import type { ObjectSnapshot } from '../../src/shared/board-model';

afterEach(() => {
  vi.useRealTimers();
});

/** Flush one animation frame (the rAF polyfill is a 16ms timeout). */
function flushFrame(): void {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

type Utils = ReturnType<typeof renderStickyBoard>;

function createNote(utils: { doc: Y.Doc }, at: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id = createSticky(utils.doc, at);
  });
  return id;
}

function createBox(utils: { doc: Y.Doc }, at: { x: number; y: number }): string {
  let id = '';
  act(() => {
    id = createTestbox(utils.doc, at);
  });
  return id;
}

/** The DOM element of the object with this id (by data-object-id). */
function objectEl(utils: Utils, id: string): HTMLElement {
  const el = utils.container.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (el === null) {
    throw new Error(`no element for object ${id}`);
  }
  return el;
}

/**
 * Press + release on an object's element: selects it. With `shiftKey` it
 * toggles membership instead (add/remove), which is how multi-selections are
 * built in the UI. (jsdom dispatches to the element directly, so the
 * coordinates only matter for the gesture delta.)
 */
function clickOn(utils: Utils, id: string, x: number, y: number, shiftKey = false): void {
  const el = objectEl(utils, id);
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, shiftKey });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1, shiftKey });
}

function findDoc(utils: { doc: Y.Doc }, id: string): ObjectSnapshot {
  const obj = snapshotAll(utils.doc).find((o) => o.id === id);
  if (obj === undefined) {
    throw new Error(`object ${id} not in document`);
  }
  return obj;
}

/** Dispatches a keydown on window and reports whether preventDefault ran. */
function sendKey(init: KeyboardEventInit): { prevented: boolean } {
  let prevented = false;
  const e = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
  const original = e.preventDefault.bind(e);
  e.preventDefault = (): void => {
    prevented = true;
    original();
  };
  act(() => {
    window.dispatchEvent(e);
  });
  return { prevented };
}

describe('sel.interaction: selection bar and multi-selection (TC-16 to TC-19)', () => {
  it('TC-16: all selected ids deleted remotely → selection empty, bar hidden', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: -300, y: 0 });
    const b = createNote(utils, { x: 0, y: 0 });
    const c = createNote(utils, { x: 300, y: 0 });
    clickOn(utils, a, 340, 400);
    clickOn(utils, b, 640, 400, true);
    expect(utils.getByTestId('selection-bar').textContent).toContain('2 selected');

    // A colleague deletes both selected notes (the third stays).
    act(() => {
      deleteObjects(utils.doc, [a, b]);
    });

    expect(utils.queryByTestId('selection-bar')).toBeNull();
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
    expect(snapshot(utils.doc)).toHaveLength(1);
    expect(objectEl(utils, c).getAttribute('data-selected')).toBe('false');
  });

  it('TC-17: two selected → "2 selected" bar with delete button and aria-live count', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: -300, y: 0 });
    const b = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, a, 340, 400);
    clickOn(utils, b, 640, 400, true);

    const bar = utils.getByTestId('selection-bar');
    expect(bar.textContent).toContain('2 selected');
    expect(bar.getAttribute('aria-live')).toBe('polite');
    const del = utils.getByTestId('selection-delete-button');
    expect(del.getAttribute('aria-label')).toBe('Delete selection');
  });

  it('TC-18: one sticky selected → NoteToolbar instead of the bar', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, a, 640, 400);

    expect(utils.getByTestId('note-toolbar')).toBeTruthy();
    expect(utils.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-19: empty-space click without drag clears the selection', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, a, 640, 400);
    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('true');

    const viewport = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 2 });
    fireEvent.pointerUp(viewport, { clientX: 100, clientY: 100, pointerId: 2 });

    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('false');
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('sel.marquee_ui: Shift+drag marquee (TC-20 to TC-22)', () => {
  it('TC-20: Shift+drag with {a} selected adds fully-inside ids (additive); partial stays out', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    // testbox 120x80 (centres in world units):
    const a = createBox(utils, { x: -300, y: 0 }); // x -360..-240 (pre-selected, outside the rect)
    const b = createBox(utils, { x: 0, y: 0 }); //     x -60..60  (fully inside)
    const c = createBox(utils, { x: 140, y: 0 }); //    x 80..200  (partly inside)
    const d = createBox(utils, { x: 400, y: 0 }); //    x 340..460 (outside)
    clickOn(utils, a, 340, 400);

    const viewport = utils.getByTestId('board-viewport');
    // Marquee world rect: (-180,-70) to (180,70).
    fireEvent.pointerDown(viewport, { clientX: 460, clientY: 330, pointerId: 3, shiftKey: true });
    fireEvent.pointerMove(viewport, { clientX: 820, clientY: 470, pointerId: 3 });
    expect(utils.getByTestId('marquee-rect')).toBeTruthy();
    fireEvent.pointerUp(viewport, { clientX: 820, clientY: 470, pointerId: 3 });

    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('true'); // pre-selected, additive
    expect(objectEl(utils, b).getAttribute('data-selected')).toBe('true'); // fully inside
    expect(objectEl(utils, c).getAttribute('data-selected')).toBe('false'); // only partly inside
    expect(objectEl(utils, d).getAttribute('data-selected')).toBe('false'); // outside
    expect(utils.queryByTestId('marquee-rect')).toBeNull();
    expect(utils.getByTestId('selection-bar').textContent).toContain('2 selected');
  });

  it('TC-21: plain drag on empty space pans; no marquee (negative)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createBox(utils, { x: 0, y: 0 });

    const viewport = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 200, clientY: 200, pointerId: 4 });
    fireEvent.pointerMove(viewport, { clientX: 300, clientY: 250, pointerId: 4 });
    flushFrame();
    fireEvent.pointerUp(viewport, { clientX: 300, clientY: 250, pointerId: 4 });

    // Panned by the drag delta; the marquee never appeared and nothing
    // got selected.
    expect(utils.readCamera()).toEqual({ x: -740, y: -450, zoom: 1 });
    expect(utils.queryByTestId('marquee-rect')).toBeNull();
    expect(utils.queryByTestId('selection-bar')).toBeNull();
    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('false');
  });

  it('TC-22: pointercancel mid-marquee → selection unchanged (gesture cancelled)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createBox(utils, { x: -300, y: 0 });
    const b = createBox(utils, { x: 0, y: 0 });
    clickOn(utils, a, 340, 400);

    const viewport = utils.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 460, clientY: 330, pointerId: 5, shiftKey: true });
    fireEvent.pointerMove(viewport, { clientX: 820, clientY: 470, pointerId: 5 });
    expect(utils.getByTestId('marquee-rect')).toBeTruthy();
    fireEvent.pointerCancel(viewport, { pointerId: 5 });

    // The rect is discarded and the selection is exactly what it was.
    expect(utils.queryByTestId('marquee-rect')).toBeNull();
    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('true');
    expect(objectEl(utils, b).getAttribute('data-selected')).toBe('false');
  });
});

describe('sel.transform: group move and resize handles (TC-23 to TC-26)', () => {
  it('TC-23: dragging unselected b while {a} selected selects {b} and moves only b; 2px is a click, 3px drags', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const a = createNote(utils, { x: -300, y: 0 }); // x -400..-200
    const b = createNote(utils, { x: 0, y: 0 }); //   x -100..100

    // Select a first.
    clickOn(utils, a, 340, 400);

    // Press unselected b and move only 2px (DRAG_THRESHOLD_PX - 1): it is a
    // click. b becomes the selection, but nothing is written.
    const bEl = objectEl(utils, b);
    fireEvent.pointerDown(bEl, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(bEl, { clientX: 642, clientY: 400, pointerId: 1 });
    flushFrame();
    expect(findDoc(utils, b).x).toBe(-100);
    fireEvent.pointerUp(bEl, { clientX: 642, clientY: 400, pointerId: 1 });

    expect(objectEl(utils, a).getAttribute('data-selected')).toBe('false'); // a deselected
    expect(objectEl(utils, b).getAttribute('data-selected')).toBe('true'); // b selected
    expect(findDoc(utils, b).x).toBe(-100); // still a click: no write

    // Now drag exactly DRAG_THRESHOLD_PX (3px): the gesture starts and only
    // b moves.
    fireEvent.pointerDown(bEl, { clientX: 640, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(bEl, { clientX: 643, clientY: 400, pointerId: 2 });
    flushFrame();
    fireEvent.pointerUp(bEl, { clientX: 643, clientY: 400, pointerId: 2 });

    expect(findDoc(utils, b).x).toBe(-100 + 3);
    expect(findDoc(utils, a).x).toBe(-400); // a untouched
  });

  it('TC-24: testbox edge handle changes width only; Shift keeps the ratio; handles labelled', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createBox(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);

    // The eight handles are offered with their "Resize <position>" labels.
    expect(utils.getAllByTestId('resize-handle')).toHaveLength(8);
    expect(utils.getByLabelText('Resize right')).toBeTruthy();
    expect(utils.getByLabelText('Resize bottom-right')).toBeTruthy();

    // Drag the east handle 40px right: width 120 → 160, height and top-left
    // unchanged (a single edge handle, no aspect lock for testbox).
    const handle = utils.getByLabelText('Resize right');
    fireEvent.pointerDown(handle, { clientX: 700, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 740, clientY: 400, pointerId: 1 });
    flushFrame();
    fireEvent.pointerUp(handle, { clientX: 740, clientY: 400, pointerId: 1 });

    let box = findDoc(utils, id);
    expect(box.width).toBe(TESTBOX_WIDTH + 40);
    expect(box.height).toBe(TESTBOX_HEIGHT);
    expect(box.x).toBe(-TESTBOX_WIDTH / 2);
    expect(box.y).toBe(-TESTBOX_HEIGHT / 2);

    // Shift + corner drag locks the aspect ratio: 2:1 stays 2:1. Start box
    // is now 160x80; |dx|=60 >= |dy|=40, so the width axis leads the scale
    // (220/160 = 1.375) and both axes scale by it.
    const se = utils.getByLabelText('Resize bottom-right');
    fireEvent.pointerDown(se, { clientX: 740, clientY: 440, pointerId: 2, shiftKey: true });
    fireEvent.pointerMove(se, { clientX: 800, clientY: 480, pointerId: 2 });
    flushFrame();
    fireEvent.pointerUp(se, { clientX: 800, clientY: 480, pointerId: 2 });

    box = findDoc(utils, id);
    expect(box.width ?? 0).toBe(220);
    expect(box.height ?? 0).toBe(110);
    expect((box.width ?? 0) / (box.height ?? 0)).toBe(2);
  });

  it('TC-25: canEdit false (load_failed) → gestures make no writes (negative)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });

    // The board could not be loaded: editing is locked out.
    act(() => {
      mockProviders[mockProviders.length - 1].emitConnectionClose(CLOSE_BOARD_LOAD_FAILED);
    });

    // Selection still works…
    clickOn(utils, id, 640, 400);
    expect(objectEl(utils, id).getAttribute('data-selected')).toBe('true');

    // …but the move gesture is ignored.
    const note = objectEl(utils, id);
    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(note, { clientX: 660, clientY: 400, pointerId: 1 });
    flushFrame();
    fireEvent.pointerUp(note, { clientX: 660, clientY: 400, pointerId: 1 });

    expect(findDoc(utils, id).x).toBe(-100); // untouched
  });

  it('TC-26: onGestureStart/onGestureEnd fire exactly once per drag; pointercancel keeps the last applied positions', () => {
    vi.useFakeTimers();

    let starts = 0;
    let ends = 0;
    const doc = new Y.Doc();

    function Rig(): JSX.Element {
      const { objects } = useBoardDoc('t6-rig', doc);
      const selection = useSelection(objects);
      const gesture = useTransformGesture({
        doc,
        camera: { x: -640, y: -400, zoom: 1 },
        selection,
        snapshot: objects,
        canEdit: true,
        onGestureStart: () => {
          starts += 1;
        },
        onGestureEnd: () => {
          ends += 1;
        },
      });
      return (
        <div style={{ position: 'fixed', inset: 0 }}>
          {objects.map((obj) => (
            <StickyNote
              key={obj.id}
              doc={doc}
              obj={obj}
              selected={selection.ids.has(obj.id)}
              editingId={selection.editingId}
              onPointerDown={gesture.onObjectPointerDown}
              onEdit={() => undefined}
              onEndEdit={() => undefined}
            />
          ))}
        </div>
      );
    }

    const utils = render(<Rig />);
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 });
    });

    const note = utils.getByTestId('sticky-note');
    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 1 });
    expect(starts).toBe(0); // pressed, not yet a drag
    fireEvent.pointerMove(note, { clientX: 643, clientY: 400, pointerId: 1 }); // activates
    flushFrame();
    expect(starts).toBe(1);
    fireEvent.pointerMove(note, { clientX: 660, clientY: 400, pointerId: 1 });
    flushFrame(); // applied: x = -100 + 20 = -80
    expect(starts).toBe(1); // still the same gesture
    fireEvent.pointerCancel(note, { pointerId: 1 });

    expect(ends).toBe(1); // exactly once, however the gesture ends
    // The last applied position stays; the cancelled gesture drops nothing.
    let obj = snapshot(doc).find((o) => o.id === id)!;
    expect(obj.x).toBe(-80);
    expect(note.getAttribute('data-selected')).toBe('true');

    // A second gesture counts again.
    fireEvent.pointerDown(note, { clientX: 640, clientY: 400, pointerId: 2 });
    fireEvent.pointerMove(note, { clientX: 643, clientY: 400, pointerId: 2 });
    flushFrame();
    fireEvent.pointerUp(note, { clientX: 643, clientY: 400, pointerId: 2 });
    expect(starts).toBe(2);
    expect(ends).toBe(2);
    obj = snapshot(doc).find((o) => o.id === id)!;
    expect(obj.x).toBe(-80 + 3);
  });
});

describe('sel.keyboard: select all, nudge, delete (TC-27 to TC-31)', () => {
  it('TC-27: Ctrl/Cmd+A selects everything with preventDefault', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    createNote(utils, { x: -300, y: 0 });
    createNote(utils, { x: 0, y: 0 });
    createNote(utils, { x: 300, y: 0 });

    const { prevented } = sendKey({ key: 'a', ctrlKey: true });
    expect(prevented).toBe(true);

    const notes = utils.getAllByTestId('sticky-note');
    for (const n of notes) {
      expect(n.getAttribute('data-selected')).toBe('true');
    }
    expect(utils.getByTestId('selection-bar').textContent).toContain('3 selected');
  });

  it('TC-28: Ctrl/Cmd+A on an empty board → empty selection, no error (boundary)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();

    expect(() => sendKey({ key: 'a', ctrlKey: true })).not.toThrow();
    expect(utils.queryByTestId('selection-bar')).toBeNull();
    expect(utils.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-29: arrows nudge by NUDGE_STEP_WORLD, Shift by NUDGE_LARGE_STEP_WORLD, preventDefault', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);

    let r = sendKey({ key: 'ArrowRight' });
    expect(r.prevented).toBe(true);
    let note = findDoc(utils, id);
    expect(note.x).toBe(-100 + NUDGE_STEP_WORLD);
    expect(note.y).toBe(-100);

    r = sendKey({ key: 'ArrowUp', shiftKey: true });
    expect(r.prevented).toBe(true);
    note = findDoc(utils, id);
    expect(note.x).toBe(-100 + NUDGE_STEP_WORLD);
    expect(note.y).toBe(-100 - NUDGE_LARGE_STEP_WORLD);
  });

  it('TC-30: Backspace while editing → text is edited, objects kept (negative)', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    const id = createNote(utils, { x: 0, y: 0 });
    clickOn(utils, id, 640, 400);
    fireEvent.doubleClick(objectEl(utils, id), { clientX: 640, clientY: 400 });
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();

    sendKey({ key: 'Backspace' });

    // The object survives and the editor stays open.
    expect(snapshot(utils.doc)).toHaveLength(1);
    expect(utils.getByTestId('sticky-textarea')).toBeTruthy();
  });

  it('TC-31: Delete with a selection removes everything and clears the selection', () => {
    vi.useFakeTimers();
    const utils = renderStickyBoard();
    createNote(utils, { x: -300, y: 0 });
    createNote(utils, { x: 0, y: 0 });
    createNote(utils, { x: 300, y: 0 });
    sendKey({ key: 'a', ctrlKey: true });
    expect(utils.getByTestId('selection-bar').textContent).toContain('3 selected');

    sendKey({ key: 'Delete' });

    expect(snapshot(utils.doc)).toHaveLength(0);
    expect(utils.queryByTestId('selection-bar')).toBeNull();
    expect(utils.queryByTestId('sticky-note')).toBeNull();
  });
});
