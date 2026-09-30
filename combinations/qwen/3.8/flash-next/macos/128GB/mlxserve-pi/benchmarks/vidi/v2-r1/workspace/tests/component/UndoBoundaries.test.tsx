// Gesture and typing boundaries (`undo.boundaries`, TC-14 to TC-17).
//
// The rule story 8 adds on top of story 7 is that one *action* is one undo step:
// every frame of a drag folds into a single step, and something done after the drag
// — a colour, a keystroke burst — does not merge into it. These run against the real
// `<Board>` with a real controller (created inside the board), so the boundary the
// gesture opens and closes is exercised exactly as the person experiences it: drag,
// then one Ctrl/Cmd+Z. `undo.typing`'s timing itself is covered with a controlled
// clock in `undo-boundaries.test.ts`; here we check the wiring holds on screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup } from '@testing-library/react';
import { setStickyColor } from '../../src/shared/board-model';

vi.mock('y-websocket', async () => {
  const module = await import('./helpers/fake-provider');
  return { WebsocketProvider: module.FakeWebsocketProvider };
});

import { ResizeObserverStub } from './setup';
import {
  advance,
  boxOf,
  centre,
  colorOf,
  doc,
  drag,
  dragCancelled,
  dragSlow,
  editor,
  editorUndo,
  flush,
  makeNote,
  marquee,
  noteElement,
  open,
  openNoteEditor,
  pressUndo,
  settleBeyondCaptureWindow,
  typeInto,
} from './helpers/board-ui';

beforeEach(() => {
  vi.useFakeTimers();
  ResizeObserverStub.size = { width: 1280, height: 800 };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** A colour change committed through the model, exactly as the note toolbar does it. */
const paint = (id: string, color: 'blue'): void => {
  act(() => {
    setStickyColor(doc(), id, color);
  });
  flush();
};

describe('undo boundaries on the board (undo.boundaries)', () => {
  // TC-14: a whole selected group moves as one step, and one undo brings it back.
  it('TC-14 undoes a long multi-frame group drag in a single undo', () => {
    open();
    const a = makeNote(0, 0);
    const b = makeNote(200, 0);
    const c = makeNote(100, 200);
    // Marquee the three together, then drag them by a long multi-frame path.
    marquee({ x: -200, y: -200 }, { x: 400, y: 400 });
    const before = [a, b, c].map((id) => boxOf(id));
    const from = centre(a);
    dragSlow(noteElement(a), from, { x: from.x + 180, y: from.y + 90 }, 30);
    // One undo returns every dragged object to where the drag started.
    pressUndo();
    flush();
    [a, b, c].forEach((id, index) => {
      expect(boxOf(id).x).toBeCloseTo(before[index]!.x, 2);
      expect(boxOf(id).y).toBeCloseTo(before[index]!.y, 2);
    });
  });

  // TC-15: the gesture-end boundary keeps a later colour change its own step.
  it('TC-15 keeps a colour change 200 ms after a drag as a separate undo step', () => {
    open();
    const a = makeNote(0, 0);
    const start = boxOf(a);
    drag(noteElement(a), centre(a), { x: 200, y: 0 });
    const moved = boxOf(a);
    expect(moved.x).not.toBeCloseTo(start.x, 2);
    // A colour, only 200 ms later — inside what would otherwise be one capture
    // window — and it is a fresh step because the gesture closed its window.
    advance(200);
    paint(a, 'blue');
    // One undo takes the colour back and leaves the move where it was.
    pressUndo();
    flush();
    expect(colorOf(a)).toBe('yellow');
    expect(boxOf(a).x).toBeCloseTo(moved.x, 2);
  });

  // TC-16: Ctrl+Z inside the editor undoes the typing, not an earlier move.
  it('TC-16 undoes the typing inside the editor and leaves the earlier move intact', () => {
    open();
    const a = makeNote(0, 0);
    drag(noteElement(a), centre(a), { x: 180, y: 0 });
    const moved = boxOf(a);
    settleBeyondCaptureWindow();
    openNoteEditor(a);
    typeInto('hello');
    expect(editor().value).toBe('hello');
    // Ctrl+Z inside the editor: the typing goes, the move stays.
    editorUndo();
    flush();
    expect(editor().value).toBe('');
    expect(boxOf(a).x).toBeCloseTo(moved.x, 2);
  });

  // TC-17: a drag cut short by a pointercancel is still exactly one step.
  it('TC-17 restores the start position when a drag is cancelled mid-way, in one undo', () => {
    open();
    const a = makeNote(0, 0);
    const start = boxOf(a);
    dragCancelled(noteElement(a), centre(a), { x: 240, y: 0 });
    // The cancelled drag kept what it had applied (a move off the start)…
    expect(boxOf(a).x).not.toBeCloseTo(start.x, 2);
    // …which a single undo takes back to where it began.
    pressUndo();
    flush();
    expect(boxOf(a).x).toBeCloseTo(start.x, 2);
    expect(boxOf(a).y).toBeCloseTo(start.y, 2);
  });
});
