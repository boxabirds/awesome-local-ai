// Story 8, `undo.boundaries` at the level of the running board: where one undo
// step stops and the next begins is decided by the app, not by the person using
// it. A drag of thirty frames is one step (TC-14); an action taken straight after
// a drag is a separate step even though no time passed (TC-15); typing inside a
// note is its own step, so undoing it leaves the move that preceded it standing
// (TC-16); and a gesture that is cancelled half-way is still exactly one step
// (TC-17).
//
// Every assertion here is made through the app's own Undo button, and every write
// is made through the app's own gestures, so what is under test is the wiring of
// the boundaries — not the undo manager, which the unit tests cover.
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from 'yjs';
import {
  createNote,
  flushFrame,
  noteCount,
  noteData,
  noteEl,
  pressOn,
  moveTo,
  releaseOn,
  cancelPressOn,
  renderBoard,
  textareaEl,
  typeInto,
} from './helpers';
import { DRAG_THRESHOLD_PX, DEFAULT_STICKY_COLOR } from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';

let doc: Doc;

// The camera starts centred on the board at zoom 1 in the jsdom viewport (see
// helpers): world (0, 0) — the centre of a note created there — lands on screen
// (640, 400), and the note spans 200 px around it.
const NOTE_SCREEN = { x: 600, y: 350 };

beforeEach(() => {
  vi.useFakeTimers();
  doc = renderBoard();
});

afterEach(() => {
  vi.useRealTimers();
});

function undoButton(): HTMLButtonElement {
  return screen.getByLabelText('Undo') as HTMLButtonElement;
}

function redoButton(): HTMLButtonElement {
  return screen.getByLabelText('Redo') as HTMLButtonElement;
}

/** Press the board's Undo button. */
function clickUndo(): void {
  fireEvent.click(undoButton());
  flushFrame();
}

/** Press the board's Redo button. */
function clickRedo(): void {
  fireEvent.click(redoButton());
  flushFrame();
}

/**
 * Drag a note with `frames` pointer moves — the number of moves a person's drag
 * really produces — and let go. Each move is one frame of the gesture.
 */
function dragNote(id: string, dx: number, dy: number, frames: number): void {
  const el = noteEl(id);
  pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
  for (let i = 1; i <= frames; i++) {
    moveTo(el, NOTE_SCREEN.x + (dx * i) / frames, NOTE_SCREEN.y + (dy * i) / frames);
    flushFrame();
  }
  releaseOn(el, NOTE_SCREEN.x + dx, NOTE_SCREEN.y + dy);
  flushFrame();
}

/** Move a note a little way, then let the pointer go inside the note (a click). */
function clickNote(id: string): void {
  const el = noteEl(id);
  pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
  releaseOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
  flushFrame();
}

function at(id: string): StickySnapshot {
  const data = noteData(doc, id);
  if (data === undefined) throw new Error(`note ${id} is gone from the model`);
  return data;
}

function text(id: string): string {
  const data = noteData(doc, id);
  if (data === undefined) throw new Error(`note ${id} is gone from the model`);
  return data.text;
}

// --- TC-14 --------------------------------------------------------------------

describe('TC-14: a long drag is one undo step', () => {
  it('returns a 30-frame drag to where it started in one press of Undo', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    dragNote(id, 240, 160, 30);
    const moved = at(id);
    expect(moved.x).not.toBe(start.x); // the drag really wrote thirty frames
    expect(moved.y).not.toBe(start.y);

    clickUndo();

    const back = at(id);
    expect(back.x).toBe(start.x); // the whole drag, in one step
    expect(back.y).toBe(start.y);
    expect(redoButton().disabled).toBe(false); // there is something to redo
  });

  it('does not leave the thirty frames of the drag as thirty steps', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    dragNote(id, 240, 160, 30);
    clickUndo();
    expect(at(id).x).toBe(start.x);

    // The step underneath the drag is the note’s own creation, not one frame of
    // the drag: pressing Undo again takes the note away.
    clickUndo();
    expect(noteCount()).toBe(0);
    expect(undoButton().disabled).toBe(true);
  });

  it('brings the note to the front as part of the same step as the drag', () => {
    const lower = createNote(doc, 0, 0);
    const upper = createNote(doc, 400, 0);
    const startOfLower = at(lower);

    dragNote(lower, 60, 0, 5);
    expect(at(lower).z).toBeGreaterThan(at(upper).z); // the drag raised it

    clickUndo();

    // The raise is part of the drag: it came back with the position.
    expect(at(lower).x).toBe(startOfLower.x);
    expect(at(lower).z).toBeLessThan(at(upper).z);
  });
});

// --- TC-15 --------------------------------------------------------------------

describe('TC-15: an action taken straight after a drag is its own step', () => {
  it('keeps the move when the colour chosen immediately after it is undone', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    dragNote(id, 200, 100, 10);
    const moved = at(id);
    expect(moved.x).not.toBe(start.x);

    // The very next action, no time having passed — well inside the window that
    // would otherwise merge it with the drag.
    fireEvent.click(screen.getByLabelText('Green colour'));
    flushFrame();
    expect(at(id).color).not.toBe(DEFAULT_STICKY_COLOR);

    clickUndo();
    expect(at(id).color).toBe(DEFAULT_STICKY_COLOR); // the colour went
    expect(at(id).x).toBe(moved.x); // the move stands

    clickUndo();
    expect(at(id).x).toBe(start.x); // and the move was the step underneath it
  });

  it('undoes the move with the press after the colour', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    dragNote(id, 200, 100, 10);
    fireEvent.click(screen.getByLabelText('Blue colour'));
    flushFrame();

    clickUndo();
    clickUndo();
    clickUndo(); // colour, move, creation

    expect(noteCount()).toBe(0); // three steps, one per action, and no more
  });

  it('keeps a delete made straight after a drag of another note separate', () => {
    const mine = createNote(doc, 0, 0);
    const other = createNote(doc, 400, 0);

    dragNote(mine, 150, 0, 8);
    const moved = at(mine);
    clickNote(other); // select it
    fireEvent.click(screen.getByLabelText('Delete note'));
    flushFrame();
    expect(noteCount()).toBe(1);

    clickUndo(); // the delete, not the drag
    expect(noteCount()).toBe(2);
    expect(at(mine).x).toBe(moved.x);

    clickUndo();
    expect(at(mine).x).not.toBe(moved.x);
  });

  it('makes every colour chosen in a row a step of its own', () => {
    const id = createNote(doc, 0, 0);
    clickNote(id); // the note's own toolbar, with its swatches, is up

    // Three swatches clicked one after another, with no time in between at all:
    // a person changing their mind twice is still three changes, because each one
    // was a thing they did.
    fireEvent.click(screen.getByLabelText('Blue colour'));
    flushFrame();
    fireEvent.click(screen.getByLabelText('Green colour'));
    flushFrame();
    fireEvent.click(screen.getByLabelText('Pink colour'));
    flushFrame();
    expect(at(id).color).toBe('pink');

    clickUndo();
    expect(at(id).color).toBe('green');
    clickUndo();
    expect(at(id).color).toBe('blue');
    clickUndo();
    expect(at(id).color).toBe(DEFAULT_STICKY_COLOR);
  });
});

// --- TC-16 --------------------------------------------------------------------

describe('TC-16: undoing typing inside a note leaves the earlier move standing', () => {
  it('undoes the typing in place, and only the typing', () => {
    const id = createNote(doc, 0, 0);
    dragNote(id, 200, 100, 6);
    const moved = at(id);

    fireEvent.doubleClick(noteEl(id)); // open the editor
    flushFrame();
    typeInto(textareaEl(), 'Typed after the move');
    flushFrame();
    expect(text(id)).toBe('Typed after the move');

    // Ctrl+Z with the caret in the note: the board’s undo, not the browser’s.
    const prevented = fireEvent.keyDown(textareaEl(), { key: 'z', ctrlKey: true });
    flushFrame();

    expect(prevented).toBe(false); // the textarea’s own undo was suppressed
    expect(textareaEl().value).toBe(''); // the typing is gone, in the editor too
    expect(text(id)).toBe('');
    expect(at(id).x).toBe(moved.x); // the move that preceded it is untouched
  });

  it('leaves the earlier action of mine for the next press of Undo', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);
    dragNote(id, 200, 100, 6);

    fireEvent.doubleClick(noteEl(id));
    flushFrame();
    typeInto(textareaEl(), 'abc');
    flushFrame();
    fireEvent.keyDown(textareaEl(), { key: 'z', ctrlKey: true });
    flushFrame();

    fireEvent.keyDown(textareaEl(), { key: 'Escape' }); // finish editing
    flushFrame();

    clickUndo();
    expect(at(id).x).toBe(start.x); // the move, one press later
    expect(text(id)).toBe('');
  });

  it('does not undo anything of mine twice from one press inside the editor', () => {
    const id = createNote(doc, 0, 0);
    dragNote(id, 200, 100, 6);
    const moved = at(id);

    fireEvent.doubleClick(noteEl(id));
    flushFrame();
    typeInto(textareaEl(), 'abc');
    flushFrame();
    // The same key press, once to the textarea and once as the event carries on
    // to the window: one undo, not two.
    fireEvent.keyDown(textareaEl(), { key: 'z', ctrlKey: true });
    flushFrame();

    expect(text(id)).toBe('');
    expect(at(id).x).toBe(moved.x);
  });

  it('opens a fresh step when a second edit of the same note begins', () => {
    const id = createNote(doc, 0, 0);
    fireEvent.doubleClick(noteEl(id));
    flushFrame();
    typeInto(textareaEl(), 'first edit');
    flushFrame();
    fireEvent.keyDown(textareaEl(), { key: 'Escape' });
    flushFrame();

    fireEvent.doubleClick(noteEl(id));
    flushFrame();
    typeInto(textareaEl(), 'first edit then a second one');
    flushFrame();
    fireEvent.keyDown(textareaEl(), { key: 'z', ctrlKey: true });
    flushFrame();

    expect(text(id)).toBe('first edit'); // the second edit alone went
  });
});

// --- TC-17 --------------------------------------------------------------------

describe('TC-17: a cancelled drag is one undo step', () => {
  it('returns a gesture cancelled half-way through to where it started', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    const el = noteEl(id);
    pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
    for (let i = 1; i <= 12; i++) {
      moveTo(el, NOTE_SCREEN.x + i * 20, NOTE_SCREEN.y + i * 10);
      flushFrame();
    }
    cancelPressOn(el);
    flushFrame();

    const cancelled = at(id);
    expect(cancelled.x).not.toBe(start.x); // the frames before the cancel were written

    clickUndo();
    expect(at(id).x).toBe(start.x);
    expect(at(id).y).toBe(start.y);
  });

  it('does not treat the cancel as an extra step', () => {
    const id = createNote(doc, 0, 0);

    const el = noteEl(id);
    pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
    moveTo(el, NOTE_SCREEN.x + DRAG_THRESHOLD_PX + 40, NOTE_SCREEN.y);
    flushFrame();
    cancelPressOn(el);
    flushFrame();

    clickUndo();
    expect(noteCount()).toBe(1); // the note is still there: only its position came back

    clickUndo();
    expect(noteCount()).toBe(0); // and the creation was the only step underneath
  });

  it('brings a cancelled gesture back in one press of Redo', () => {
    const id = createNote(doc, 0, 0);
    const start = at(id);

    const el = noteEl(id);
    pressOn(el, NOTE_SCREEN.x, NOTE_SCREEN.y);
    moveTo(el, NOTE_SCREEN.x + 120, NOTE_SCREEN.y + 60);
    flushFrame();
    cancelPressOn(el);
    flushFrame();
    const cancelled = at(id);

    clickUndo();
    expect(at(id).x).toBe(start.x);

    clickRedo();
    expect(at(id).x).toBe(cancelled.x); // the whole gesture, in one press
    expect(at(id).y).toBe(cancelled.y);
    expect(redoButton().disabled).toBe(true); // and it was one step, not two
  });
});

// --- the error path -----------------------------------------------------------

describe('the error path of a boundary', () => {
  it('a gesture that never moved the note adds no step to undo', () => {
    const id = createNote(doc, 0, 0);
    clickNote(id); // press and let go without passing the drag threshold
    flushFrame();

    clickUndo(); // its creation
    expect(noteCount()).toBe(0);

    // Nothing was invented by the click: Undo has run out.
    expect(undoButton().disabled).toBe(true);
  });
});
