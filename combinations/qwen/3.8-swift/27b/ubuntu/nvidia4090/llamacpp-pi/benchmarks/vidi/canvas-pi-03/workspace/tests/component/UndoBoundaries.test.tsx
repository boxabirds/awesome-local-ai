/**
 * Story 8 component tests — undo.boundaries (TC-14 to TC-17): a 30-frame drag
 * is exactly one undo step restoring the start position, move-then-colour are
 * two separate steps (boundary at gesture end), Ctrl+Z inside the sticky
 * editor undoes only the typing, and a cancelled drag is one step restoring
 * the start.
 *
 * jsdom viewport is 1024×768 with the reset camera: world (0,0) renders at
 * screen (512, 384) and zoom is 1, so screen px == world units offset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';
import type { UndoController } from 'src/client/board/undo';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

function getUndo(): UndoController {
  const w = window as unknown as { __vidi6: { undo: UndoController } };
  return w.__vidi6.undo;
}

async function flushRaf() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

/** Direct doc mutations wrapped in act() so the re-render flushes. */
function makeNote(x: number, y: number, color: 'yellow' | 'orange', text: string): string {
  const doc = getDoc();
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y }, color, text)!;
  });
  return id;
}

/** A 30-frame drag of a note (one world unit per frame). */
async function dragNoteFrames(
  note: HTMLElement,
  user: ReturnType<typeof userEvent.setup>,
  frames = 30,
): Promise<void> {
  await user.click(note);
  fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 512, clientY: 384 });
  for (let i = 1; i <= frames; i++) {
    fireEvent.pointerMove(note, { pointerId: 1, clientX: 512 + i, clientY: 384 });
    await flushRaf();
  }
  fireEvent.pointerUp(note, { pointerId: 1, clientX: 512 + frames, clientY: 384 });
  await flushRaf();
}

describe('undo.boundaries (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-14: 30-frame drag → one step restoring the start position', async () => {
    const doc = getDoc();
    const undo = getUndo();
    const id = makeNote(0, 0, 'yellow', 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const start = snapshot(doc).find((o) => o.id === id)!;
    expect(undo.stackLength()).toBe(1); // the create

    const user = userEvent.setup();
    await dragNoteFrames(note, user, 30);

    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 30);
    // Exactly one new step: create + move.
    expect(undo.stackLength()).toBe(2);

    expect(undo.undo()).toBe(true);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x);
    expect(s.y).toBe(start.y);
    expect(undo.stackLength()).toBe(1);

    // Redo re-applies the whole drag as one step.
    expect(undo.redo()).toBe(true);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 30);
  });

  it('TC-15: move then colour within 200 ms → two separate steps', async () => {
    const doc = getDoc();
    const undo = getUndo();
    const id = makeNote(0, 0, 'yellow', 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const start = snapshot(doc).find((o) => o.id === id)!;

    const user = userEvent.setup();
    // Move the note, then — well under 200 ms later — change its colour. The
    // gesture-end boundary separates the two steps.
    await dragNoteFrames(note, user, 5);
    // The note is still selected (the drag kept the selection).
    await user.click(screen.getByTestId('swatch-green'));

    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 5);
    expect(s.color).toBe('green');
    // create + move + colour = three steps.
    expect(undo.stackLength()).toBe(3);

    // Undo the colour first (the most recent step)…
    expect(undo.undo()).toBe(true);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.color).toBe('yellow');
    expect(s.x).toBe(start.x + 5); // …the move stays.

    // …then the move.
    expect(undo.undo()).toBe(true);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x);
    expect(s.y).toBe(start.y);
  });

  it('TC-16: typing in the editor, Ctrl+Z inside → typing undone, earlier move untouched', async () => {
    const doc = getDoc();
    const id = makeNote(0, 0, 'yellow', 'a');
    const [note] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    const beforeMove = snapshot(doc).find((o) => o.id === id)!;
    await dragNoteFrames(note, user, 5);
    const afterMove = snapshot(doc).find((o) => o.id === id)!;
    expect(afterMove.x).toBe(beforeMove.x + 5);

    // Enter edit mode (Enter on the single selection), type, then Ctrl+Z
    // INSIDE the textarea: the editor handles it and undoes only the typing.
    fireEvent.keyDown(window, { key: 'Enter' });
    await flushRaf();
    const textarea = screen.getByTestId('sticky-note-textarea') as HTMLTextAreaElement;
    await user.type(textarea, 'abc');
    expect(textarea.value).toBe('abc');

    // Ctrl+Z on the textarea: preventDefault (no native textarea undo), the
    // controller undoes the typing step.
    expect(fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true })).toBe(false);
    expect(textarea.value).toBe('');
    // The earlier move is NOT undone.
    const s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(beforeMove.x + 5);
    expect(s.y).toBe(afterMove.y);
  });

  it('TC-17: pointercancel mid-drag → one step restoring the start', async () => {
    const doc = getDoc();
    const undo = getUndo();
    const id = makeNote(0, 0, 'yellow', 'a');
    const [note] = screen.getAllByTestId('sticky-note');
    const start = snapshot(doc).find((o) => o.id === id)!;

    const user = userEvent.setup();
    await user.click(note);
    fireEvent.pointerDown(note, { pointerId: 1, button: 0, clientX: 512, clientY: 384 });
    for (let i = 1; i <= 10; i++) {
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 512 + i, clientY: 384 });
      await flushRaf();
    }
    // The gesture is cancelled (e.g. the pointer left the window): the last
    // applied frame stays (story 7) and the gesture-end boundary closes the
    // capture window.
    fireEvent.pointerCancel(note, { pointerId: 1, clientX: 512 + 10, clientY: 384 });
    await flushRaf();

    let s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x + 10);
    // The cancelled drag still counts as exactly one undo step…
    expect(undo.stackLength()).toBe(2);
    // …and undoing it restores the start position.
    expect(undo.undo()).toBe(true);
    s = snapshot(doc).find((o) => o.id === id)!;
    expect(s.x).toBe(start.x);
    expect(s.y).toBe(start.y);
    expect(undo.stackLength()).toBe(1);
  });
});
