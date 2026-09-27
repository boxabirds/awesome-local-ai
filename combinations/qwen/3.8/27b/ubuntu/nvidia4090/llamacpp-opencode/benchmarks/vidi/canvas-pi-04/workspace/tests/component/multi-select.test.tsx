// Story 7, component tests (TC-16 .. TC-31).
//
// Selection (prune / bar / clear), marquee (add, pan-negative, cancel),
// transform (move, resize, load-failed-negative, gesture start/end) and
// keyboard (select-all, empty-board boundary, nudge, edit-guard, delete).
//
// The App is rendered against a mocked connector that seeds a fixed set of
// notes/boxes into a real Y.Doc and reports a chosen connection state. All
// pointer/keyboard events are dispatched on the right surface: object/handle
// presses on the element (the gesture listens on window for move/up), marquee
// presses on the viewport element, and key commands on window.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import * as Y from 'yjs';
import { makeEvent } from './helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  createStickyAt,
  deleteObjects,
  getStickyText,
  initDoc,
  objectSnapshot,
} from '../../src/shared/board-model';
import { resetBoardForTests, setBoardCamera, useCamera } from '../../src/client/canvas/useCamera';
import type { Size } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { type StickyColor } from '../../src/shared/config';
import { seedTestBox, TESTBOX_DEFAULT_SIZE } from '../fixtures/testbox';

// Module-scope seed config, read by the hoisted connectBoard mock.
const SEED = vi.hoisted(() => ({
  notes: [] as Array<{ x: number; y: number; color: StickyColor }>,
  boxes: [] as Array<{ x: number; y: number; width: number; height: number }>,
  text: '' as string,
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  const boardModel = await import('../../src/shared/board-model');
  const fixture = await import('../fixtures/testbox');
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(SEED.state);
      SEED.doc = doc;
      // Seed after the useBoardDoc subscription is live (microtask), so the
      // add is observed as a real store change (mirrors load-failure.test).
      queueMicrotask(() => {
        if (boardModel.objectSnapshot(doc).length !== 0) return;
        for (const n of SEED.notes) boardModel.createStickyAt(doc, n.x, n.y, n.color);
        for (const b of SEED.boxes) seedTestBox(doc, b.x, b.y, b.width, b.height);
        if (SEED.text !== '') {
          const first = boardModel.objectSnapshot(doc)[0];
          if (first !== undefined && first.type === 'sticky') {
            const ytext = boardModel.getStickyText(doc, first.id);
            if (ytext !== undefined) ytext.insert(0, SEED.text);
          }
        }
      });
      return { destroy: (): void => undefined };
    },
  };
});

// --- camera + interaction helpers -----------------------------------------

// Deterministic camera: world (0,0) at screen (512,384), zoom 1. Matches the
// jsdom default (1024x768) reset view; set explicitly so screen<->world math
// in the marquee tests is exact.
const CAM = { x: -512, y: -384, zoom: 1 };

function setCam(): void {
  act(() => {
    setBoardCamera(CAM);
  });
}

function noteEls(): HTMLElement[] {
  return screen.queryAllByRole('group', { name: 'Sticky note' });
}

function noteState(): Array<{
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  selected: boolean;
}> {
  return noteEls().map((el) => ({
    id: el.getAttribute('data-note-id') ?? '',
    x: Number(el.style.left.replace('px', '')),
    y: Number(el.style.top.replace('px', '')),
    w: Number(el.style.width.replace('px', '')),
    h: Number(el.style.height.replace('px', '')),
    selected: el.hasAttribute('data-selected'),
  }));
}

function boxState(): Array<{ x: number; y: number; w: number; h: number }> {
  return screen.queryAllByTestId('testbox').map((el) => ({
    x: Number(el.style.left.replace('px', '')),
    y: Number(el.style.top.replace('px', '')),
    w: Number(el.style.width.replace('px', '')),
    h: Number(el.style.height.replace('px', '')),
  }));
}

function selectedNoteIds(): string[] {
  return noteState()
    .filter((n) => n.selected)
    .map((n) => n.id);
}

// jsdom's native events do not carry shiftKey/pointerId/clientX through
// fireEvent's constructor path, so the tests dispatch events built by
// makeEvent (which Object.assigns the properties) directly.
function dis(target: EventTarget, type: string, props: Record<string, unknown>): void {
  act(() => {
    target.dispatchEvent(makeEvent(type, props));
  });
}

/** Click (or shift-click) a note to select it; the move gesture is a no-op. */
function clickNote(el: HTMLElement, shift = false): void {
  dis(el, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: shift,
  });
  dis(window, 'pointerup', { pointerId: 1 });
}

/** Drag an object/handle by a screen delta (zoom 1 => world delta = delta). */
function drag(el: HTMLElement, dx: number, dy: number, shift = false): void {
  dis(el, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    clientX: 0,
    clientY: 0,
    shiftKey: shift,
  });
  dis(window, 'pointermove', { pointerId: 1, clientX: dx, clientY: dy, shiftKey: shift });
  dis(window, 'pointerup', { pointerId: 1 });
}

/** Shift+drag a marquee between two viewport-local (client) points. */
function marquee(x0: number, y0: number, x1: number, y1: number, cancel = false): void {
  const vp = screen.getByTestId('board-viewport');
  dis(vp, 'pointerdown', {
    button: 0,
    pointerType: 'mouse',
    pointerId: 1,
    shiftKey: true,
    clientX: x0,
    clientY: y0,
  });
  dis(vp, 'pointermove', { pointerId: 1, clientX: x1, clientY: y1 });
  if (cancel) dis(vp, 'pointercancel', { pointerId: 1 });
  else dis(vp, 'pointerup', { pointerId: 1 });
}

function pressKey(target: EventTarget, key: string, init: Record<string, unknown> = {}): void {
  dis(target, 'keydown', { key, ...init });
}

/** Render the board for one test (fresh board id) and flush the seed. */
async function openBoard(): Promise<void> {
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  render(<App />);
  await act(async () => undefined);
  setCam();
}

// --- a minimal harness for the gesture callbacks (TC-26) -------------------

function GestureHarness(props: { onGestureStart(): void; onGestureEnd(): void }): JSX.Element {
  const viewport: Size = { width: 1024, height: 768 };
  const { camera } = useCamera(viewport);
  const docRef = useRefLike<Y.Doc | null>(null);
  const doc = docRef.current ?? (docRef.current = makeSeedDoc());
  const snapshot = objectSnapshot(doc);
  const selection = useSelection(snapshot);
  const gesture = useTransformGesture({
    doc,
    camera,
    selection,
    snapshot,
    canEdit: true,
    onGestureStart: props.onGestureStart,
    onGestureEnd: props.onGestureEnd,
  });
  const note = snapshot.find((o) => o.type === 'sticky');
  if (note === undefined) return <div />;
  const spec = getObjectType('sticky');
  if (spec === undefined) return <div />;
  const Comp = spec.Component;
  return (
    <div>
      <Comp
        obj={note}
        doc={doc}
        selected={selection.ids.has(note.id)}
        editing={false}
        canEdit
        onPointerDown={(e: ReactPointerEvent) => gesture.onObjectPointerDown(e, note.id)}
        onStartEdit={() => undefined}
        onEndEdit={() => undefined}
      />
    </div>
  );
}

// A tiny useRef stand-in (avoids importing React hooks for a one-off ref).
function useRefLike<T>(initial: T): { current: T } {
  return useRef(initial);
}

function makeSeedDoc(): Y.Doc {
  const d = new Y.Doc();
  initDoc(d);
  createSticky(d, { x: 200, y: 150 });
  return d;
}

// --- tests -----------------------------------------------------------------

describe('story 7 component (TC-16..TC-31)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetBoardForTests();
    SEED.notes = [];
    SEED.boxes = [];
    SEED.text = '';
    SEED.state = 'connected';
    SEED.doc = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  // -- selection ------------------------------------------------------------

  it('TC-16: prune — all selected deleted remotely → Empty, bar hidden', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
      { x: 500, y: 100, color: 'pink' },
    ];
    await openBoard();
    const els = noteEls();
    clickNote(els[0]);
    clickNote(els[1], true);
    clickNote(els[2], true);
    expect(selectedNoteIds()).toHaveLength(3);
    expect(screen.getByText('3 selected')).toBeTruthy();

    const ids = noteState().map((n) => n.id);
    act(() => {
      if (SEED.doc !== null) deleteObjects(SEED.doc, ids);
    });

    expect(noteEls()).toHaveLength(0);
    expect(screen.queryByText('3 selected')).toBeNull();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('TC-17: bar — 2 selected shows "2 selected" + Delete and aria-live', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
    ];
    await openBoard();
    const els = noteEls();
    clickNote(els[0]);
    clickNote(els[1], true);

    const count = screen.getByText('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    // The single-sticky toolbar is NOT shown for a multi-selection.
    expect(screen.queryByRole('toolbar', { name: 'Note tools' })).toBeNull();
  });

  it('TC-18: bar — 1 selected shows the NoteToolbar (not the count bar)', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();
    clickNote(noteEls()[0]);

    expect(screen.getByRole('toolbar', { name: 'Note tools' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('TC-19: clear — a press on empty space (no drag) clears the selection', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
    ];
    await openBoard();
    const els = noteEls();
    clickNote(els[0]);
    clickNote(els[1], true);
    expect(selectedNoteIds()).toHaveLength(2);

    const vp = screen.getByTestId('board-viewport');
    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 20, clientY: 20 });
    dis(vp, 'pointerup', { pointerId: 1, clientX: 20, clientY: 20 });

    expect(selectedNoteIds()).toEqual([]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  // -- marquee --------------------------------------------------------------

  it('TC-20: marquee — Shift+drag adds fully-inside ids to the existing selection', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' }, // A [100,300]x[100,300]
      { x: 250, y: 100, color: 'green' }, // B [250,450]x[100,300]
      { x: 600, y: 100, color: 'pink' }, // C [600,800]x[100,300]
    ];
    await openBoard();
    const ids = noteState().map((n) => n.id);
    clickNote(noteEls()[0]); // select A
    expect(selectedNoteIds()).toEqual([ids[0]]);

    // Marquee world rect [90,460]x[95,305]: fully contains A and B, not C.
    marquee(602, 479, 972, 689);

    expect(new Set(selectedNoteIds())).toEqual(new Set([ids[0], ids[1]]));
    expect(selectedNoteIds()).not.toContain(ids[2]);
  });

  it('TC-21: marquee (negative) — a plain drag pans and does not marquee', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
    ];
    await openBoard();
    const vp = screen.getByTestId('board-viewport');
    const layer = screen.getByTestId('world-layer');
    const before = layer.style.transform;

    dis(vp, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 400, clientY: 400 });
    dis(vp, 'pointermove', { pointerId: 1, clientX: 500, clientY: 450 });
    dis(vp, 'pointerup', { pointerId: 1 });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    // No marquee: selection unchanged (empty) and no marquee rect.
    expect(selectedNoteIds()).toEqual([]);
    expect(document.querySelector('.marquee-rect')).toBeNull();
    // A pan happened: the world layer moved.
    expect(layer.style.transform).not.toBe(before);
  });

  it('TC-22: marquee (negative) — pointercancel mid-marquee leaves the selection unchanged', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
    ];
    await openBoard();

    marquee(602, 479, 972, 689, /* cancel */ true);

    expect(selectedNoteIds()).toEqual([]);
    expect(document.querySelector('.marquee-rect')).toBeNull();
  });

  // -- transform ------------------------------------------------------------

  it('TC-23: move — dragging an unselected note selects it and moves only it', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' }, // A
      { x: 400, y: 300, color: 'green' }, // B
    ];
    await openBoard();
    const state = noteState();
    const aId = state[0].id;
    const bId = state[1].id;
    clickNote(noteEls()[0]); // select A
    expect(selectedNoteIds()).toEqual([aId]);

    drag(noteEls()[1], 100, 50); // drag B by (100,50)

    const after = noteState();
    const a = after.find((n) => n.id === aId);
    const b = after.find((n) => n.id === bId);
    expect(selectedNoteIds()).toEqual([bId]); // dragging B re-selects to {b}
    expect(b).toMatchObject({ x: 400 + 100, y: 300 + 50 }); // B moved
    expect(a).toMatchObject({ x: 100, y: 100 }); // A unchanged
  });

  it('TC-24: resize — an east handle changes width only; Shift keeps the ratio', async () => {
    SEED.boxes = [
      { x: 100, y: 100, width: 100, height: 100 },
      { x: 500, y: 100, width: 100, height: 100 },
    ];
    await openBoard();
    const boxes = screen.queryAllByTestId('testbox');
    clickNote(boxes[0]); // select box 1 (selectable like any object)

    drag(screen.getByRole('button', { name: 'Resize e' }), 100, 0);
    expect(boxState()[0]).toMatchObject({ w: 200, h: 100 }); // width only

    clickNote(boxes[1]); // select box 2
    drag(screen.getByRole('button', { name: 'Resize e' }), 100, 0, /* shift */ true);
    expect(boxState()[1]).toMatchObject({ w: 200, h: 200 }); // ratio kept
  });

  it('TC-25: move (negative) — a load_failed board refuses the gesture', async () => {
    SEED.state = 'load_failed';
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 400, y: 300, color: 'green' },
    ];
    await openBoard();
    const before = noteState();
    drag(noteEls()[0], 100, 50);

    const after = noteState();
    expect(after[0]).toMatchObject({ x: 100, y: 100 }); // unchanged
    expect(after[1]).toMatchObject({ x: 400, y: 300 }); // unchanged
    // Selection is read-only but still allowed.
    expect(selectedNoteIds()).toEqual([before[0].id]);
  });

  it('TC-26: move — onGestureStart/onGestureEnd fire once per moved gesture', () => {
    const onStart = vi.fn<() => void>();
    const onEnd = vi.fn<() => void>();
    render(<GestureHarness onGestureStart={onStart} onGestureEnd={onEnd} />);
    setCam();
    const note = screen.getByRole('group', { name: 'Sticky note' });

    // A plain click (no drag): no start, no end.
    drag(note, 0, 0);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();

    // A real drag: exactly one start and one end.
    drag(note, 100, 50);
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  // -- keyboard -------------------------------------------------------------

  it('TC-27: select all — Ctrl/Cmd+A selects every object and preventDefaults', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
      { x: 500, y: 100, color: 'pink' },
    ];
    await openBoard();
    const spy = vi.fn<() => void>();
    const event = makeEvent('keydown', { key: 'a', ctrlKey: true }) as KeyboardEvent;
    event.preventDefault = spy;
    act(() => {
      window.dispatchEvent(event);
    });

    expect(selectedNoteIds()).toHaveLength(3);
    expect(spy).toHaveBeenCalled(); // preventDefault (no page text selection)
  });

  it('TC-28: select all (boundary) — Ctrl/Cmd+A on an empty board is a no-op', async () => {
    SEED.notes = [];
    await openBoard();
    expect(() => dis(window, 'keydown', { key: 'a', ctrlKey: true })).not.toThrow();
    expect(selectedNoteIds()).toEqual([]);
  });

  it('TC-29: nudge — arrows move the selection by the step; Shift = large step', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    await openBoard();
    clickNote(noteEls()[0]);

    const spy = vi.fn<() => void>();
    const right = makeEvent('keydown', { key: 'ArrowRight' }) as KeyboardEvent;
    right.preventDefault = spy;
    act(() => {
      window.dispatchEvent(right);
    });
    expect(noteState()[0]).toMatchObject({ x: 100 + 1, y: 100 });
    expect(spy).toHaveBeenCalled(); // preventDefault (no scroll / pan)

    dis(window, 'keydown', { key: 'ArrowUp', shiftKey: true });
    expect(noteState()[0]).toMatchObject({ x: 100 + 1, y: 100 - 10 });
  });

  it('TC-30: delete (negative) — Backspace while editing edits text, not objects', async () => {
    SEED.notes = [{ x: 100, y: 100, color: 'yellow' }];
    SEED.text = 'hello';
    await openBoard();
    const note = noteEls()[0];
    act(() => {
      fireEvent.doubleClick(note, { detail: 2 });
    });

    const textarea = screen.getByRole('textbox', { name: 'Sticky note text' });
    dis(textarea, 'keydown', { key: 'Backspace' });

    // The object survived: it is still rendered and still editable.
    expect(noteEls()).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Sticky note text' })).toBeTruthy();
  });

  it('TC-31: delete — Delete removes every selected object and clears the selection', async () => {
    SEED.notes = [
      { x: 100, y: 100, color: 'yellow' },
      { x: 300, y: 100, color: 'green' },
      { x: 500, y: 100, color: 'pink' },
    ];
    await openBoard();
    dis(window, 'keydown', { key: 'a', ctrlKey: true }); // select all
    expect(selectedNoteIds()).toHaveLength(3);

    dis(window, 'keydown', { key: 'Delete' });
    expect(noteEls()).toHaveLength(0);
    expect(selectedNoteIds()).toEqual([]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});


