/**
 * Story 8 — undo step boundaries at the component level (jsdom, PRD
 * undo.boundaries).
 *
 *   TC-14  a multi-frame group drag is exactly one undo step: one undo
 *          restores every selected object's start state.
 *   TC-15  a gesture end boundary isolates the next action: drag, then a
 *          colour change shortly after → two separate steps.
 *   TC-16  typing after a move: Ctrl+Z inside the editor undoes the typing
 *          only — the earlier move is untouched (negative case).
 *   TC-17  pointercancel mid-drag keeps the last applied state and is one
 *          undo step back to the start.
 *
 * The board runs on a real `Y.Doc` (no network) through the shared
 * `TestBoard` harness, which now exposes its per-client `UndoController`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { installComponentMocks } from './helpers/mocks';
import { TestBoard, type TestBoardProps } from './helpers/TestBoard';
import type { UndoController } from '../../src/client/board/undo';
import {
  createSticky,
  snapshot,
  objectBounds,
  getStickyText,
} from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';

installComponentMocks();

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

function renderBoard(props: Partial<TestBoardProps> = {}) {
  let doc: Y.Doc | null = null;
  let undo: UndoController | null = null;
  const utils = render(
    <TestBoard
      camera={CAMERA}
      viewportSize={VIEWPORT}
      onDocReady={(d) => (doc = d)}
      onUndoReady={(u) => (undo = u)}
      {...props}
    />,
  );
  return {
    ...utils,
    getDoc: () => doc as Y.Doc,
    getUndo: () => undo as UndoController,
  };
}

function flush() {
  act(() => {
    vi.advanceTimersByTime(16);
  });
}

function pointer(el: Element, type: string, x: number, y: number, extra: PointerEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        pointerId: 1,
        ...extra,
      }),
    );
  });
}

function keyOn(el: Element, init: KeyboardEventInit) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

/** Origin for seeded content: NOT `LOCAL_ORIGIN`, so seeding is invisible to
 * the per-client undo history (the history contains only the actions the
 * test performs). */
const SEED_ORIGIN: unique symbol = Symbol('seed');

function createNote(doc: Y.Doc, at: Point = { x: 300, y: 200 }): string {
  let id = '';
  act(() => {
    const seed = new Y.Doc();
    id = createSticky(seed, at) as string;
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed), SEED_ORIGIN);
    seed.destroy();
  });
  return id;
}

function selectNote(id: string, at: Point, shift = false) {
  const note = screen.getByTestId(`sticky-note-${id}`);
  pointer(note, 'pointerdown', at.x, at.y, shift ? { shiftKey: true } : {});
  pointer(note, 'pointerup', at.x, at.y, shift ? { shiftKey: true } : {});
}

function bounds(id: string, doc: Y.Doc) {
  return objectBounds(snapshot(doc).find((o) => o.id === id)!);
}

describe('story 8: undo step boundaries (component)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('TC-14: a 30-frame group drag is one undo step; undo restores all start states', () => {
    const { getDoc, getUndo } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    const b = createNote(doc, { x: 700, y: 200 });
    const c = createNote(doc, { x: 450, y: 500 });
    selectNote(a, { x: 300, y: 200 });
    selectNote(b, { x: 700, y: 200 }, true);
    selectNote(c, { x: 450, y: 500 }, true);

    const before = snapshot(doc);
    const na = screen.getByTestId(`sticky-note-${a}`);

    // A 30-frame drag: pointerdown, 30 rAF-throttled frames, pointerup.
    pointer(na, 'pointerdown', 300, 200);
    for (let i = 1; i <= 30; i++) {
      pointer(na, 'pointermove', 300 + i * 2, 200 + i);
      flush();
    }
    pointer(na, 'pointerup', 360, 230);

    // Every selected object moved by exactly (60, 30).
    for (const n of before) {
      const now = snapshot(doc).find((o) => o.id === n.id)!;
      expect(now.x).toBe(n.x + 60);
      expect(now.y).toBe(n.y + 30);
    }

    // ONE undo step restores the full start state (positions AND stacking).
    expect(getUndo().canUndo()).toBe(true);
    getUndo().undo();
    expect(snapshot(doc)).toEqual(before);
    expect(getUndo().canUndo()).toBe(false);
  });

  it('TC-15: a colour change after a finished drag is a separate undo step', () => {
    const { getDoc, getUndo } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    selectNote(a, { x: 300, y: 200 });

    const before = bounds(a, doc);
    const na = screen.getByTestId(`sticky-note-${a}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointermove', 350, 220);
    flush();
    pointer(na, 'pointerup', 350, 220);
    expect(bounds(a, doc).x).toBe(before.x + 50);

    // 200 ms later (inside the 500 ms capture window — only the gesture-end
    // boundary keeps this a separate step), recolor the note.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    expect(snapshot(doc).find((o) => o.id === a)!.color).toBe('pink');

    // Two steps: undo → colour back; undo again → position back.
    getUndo().undo();
    expect(snapshot(doc).find((o) => o.id === a)!.color).toBe('yellow');
    expect(bounds(a, doc).x).toBe(before.x + 50); // position untouched by this step
    getUndo().undo();
    expect(bounds(a, doc)).toEqual(before);
    expect(getUndo().canUndo()).toBe(false);
  });

  it('TC-16: Ctrl+Z inside the editor undoes typing only, not the earlier move', () => {
    const { getDoc } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    selectNote(a, { x: 300, y: 200 });

    // Move the note (one step).
    const start = bounds(a, doc);
    const na = screen.getByTestId(`sticky-note-${a}`);
    pointer(na, 'pointerdown', 300, 200);
    pointer(na, 'pointermove', 340, 220);
    flush();
    pointer(na, 'pointerup', 340, 220);
    const afterMove = bounds(a, doc);
    expect(afterMove.x).toBe(start.x + 40);

    // Enter text editing and type.
    act(() => {
      na.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const ta = screen.getByTestId('sticky-text-editor').querySelector('textarea')!;
    fireEvent.change(ta, { target: { value: 'hello' } });
    expect(getStickyText(doc, a)?.toString()).toBe('hello');

    // Ctrl+Z inside the editor: the typing burst is undone…
    keyOn(ta, { key: 'z', ctrlKey: true });
    expect(getStickyText(doc, a)?.toString()).toBe('');
    // …and the editor textarea reflects it…
    expect((ta as HTMLTextAreaElement).value).toBe('');
    // …while the move (the previous step) is untouched.
    expect(bounds(a, doc)).toEqual(afterMove);

    // Redo inside the editor brings the text back.
    keyOn(ta, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(getStickyText(doc, a)?.toString()).toBe('hello');
  });

  it('TC-17: pointercancel mid-drag keeps the last state and is one undo step', () => {
    const { getDoc, getUndo } = renderBoard();
    const doc = getDoc();
    const a = createNote(doc, { x: 300, y: 200 });
    selectNote(a, { x: 300, y: 200 });

    const start = bounds(a, doc);
    const na = screen.getByTestId(`sticky-note-${a}`);
    pointer(na, 'pointerdown', 300, 200);
    for (let i = 1; i <= 4; i++) {
      pointer(na, 'pointermove', 300 + i * 5, 200 + i * 2);
      flush();
    }
    pointer(na, 'pointercancel', 320, 208);

    // The last applied frame is kept (no rollback).
    const kept = bounds(a, doc);
    expect(kept.x).toBe(start.x + 20);
    expect(kept.y).toBe(start.y + 8);

    // One undo step back to the start.
    expect(getUndo().canUndo()).toBe(true);
    getUndo().undo();
    const back = bounds(a, doc);
    expect(back.x).toBe(start.x);
    expect(back.y).toBe(start.y);
    expect(getUndo().canUndo()).toBe(false);
  });
});
