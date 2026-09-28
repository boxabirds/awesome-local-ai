// Story 8, undo.boundaries (unit part) — the capture window: one burst of typing
// is one undo step, and the only thing that splits a burst is a pause of
// UNDO_CAPTURE_TIMEOUT_MS (tasks 7).
//
// The window has to be driven by the app's own clock, so these tests use fake
// timers and step the pause to the millisecond: 499ms is still the same step,
// 500ms is not. That is the boundary a person feels as "I stopped typing", and it
// must not be split by an internal timer nor merged away by the frames of a drag.
//
// Typing goes through `applyTextDiff` with the model's own origin, which is what
// the sticky text editor does on every keystroke: an origin the controller does
// not track would be invisible here, so this is also the check that a text edit
// is undoable at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { createUndo, type UndoController } from '../../src/client/board/undo.ts';
import { loadBoard, notesById } from './helpers/peer.ts';
import { LOCAL_ORIGIN, moveObjects } from '../../src/shared/board-model.ts';
import { applyTextDiff } from '../../src/client/objects/StickyText.ts';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config.ts';

const NOTE = 'note-0';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function rig() {
  const doc = loadBoard([{ x: 0, y: 0 }]);
  return { doc, undo: createUndo(doc) };
}

function textOf(doc: Y.Doc, id: string): Y.Text {
  return doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
}

function positionOf(doc: Y.Doc, id: string): { x: number; y: number } {
  const note = notesById(doc).get(id)!;
  return { x: note.x, y: note.y };
}

/** One keystroke, exactly as the sticky editor commits it. */
function keystroke(text: Y.Text, chars: string): void {
  applyTextDiff(text, text.toString() + chars, LOCAL_ORIGIN);
}

/** Type one character at a time, `gapMs` apart, like a person and their IME. */
function typeChars(text: Y.Text, chars: string, gapMs: number): void {
  for (const char of chars) {
    keystroke(text, char);
    vi.advanceTimersByTime(gapMs);
  }
}

/** How many undo steps the history holds, read by walking it back to empty. */
function stepCount(undo: UndoController): number {
  let steps = 0;
  while (undo.undo()) {
    steps += 1;
    if (steps > 50) throw new Error('more undo steps than expected');
  }
  return steps;
}

describe('the capture window of one undo history (undo.boundaries)', () => {
  // TC-12: five keystrokes 100ms apart inside one edit session are one step, and
  // one undo removes all of them.
  it('TC-12 collapses a burst of typing into a single step', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    undo.boundary(); // the editor opened
    typeChars(text, 'hello', 100);

    expect(text.toString()).toBe('hello');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    // Exactly one step: nothing left to undo after it.
    expect(undo.canUndo()).toBe(false);
  });

  // TC-12 for a drag: the frames of one gesture, which together take longer than
  // the pause, are still one step because the gesture opened and closed a boundary.
  it('TC-12 collapses the frames of one drag into a single step', () => {
    const { doc, undo } = rig();

    undo.boundary(); // pointer down
    for (let i = 1; i <= 5; i++) {
      moveObjects(doc, new Map([[NOTE, { x: i * 20, y: 0 }]]));
      vi.advanceTimersByTime(100); // 5 frames, 500ms of wall clock in total
    }
    undo.boundary(); // pointer up

    expect(positionOf(doc, NOTE).x).toBeCloseTo(100, 6);
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(positionOf(doc, NOTE).x).toBeCloseTo(0, 6);
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13 (boundary, at the timeout): a pause of exactly UNDO_CAPTURE_TIMEOUT_MS
  // ends the burst, so the typing before it and after it undo separately.
  it('TC-13 splits the step after exactly UNDO_CAPTURE_TIMEOUT_MS of pause', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    undo.boundary();
    keystroke(text, 'one');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS);
    keystroke(text, 'two');

    expect(text.toString()).toBe('onetwo');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('one');
    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  // TC-13 (boundary, one millisecond under): the pause has not happened yet, so
  // no internal timer may have cut the burst short (negative).
  it('TC-13 keeps the step when the pause is one millisecond short', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    undo.boundary();
    keystroke(text, 'one');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS - 1);
    keystroke(text, 'two');

    expect(stepCount(undo)).toBe(1);
    expect(text.toString()).toBe('');
    expect(undo.canRedo()).toBe(true);
  });

  // A boundary with nothing in the history is a no-op: the next change is still
  // captured normally, so an app that calls it eagerly cannot lose a step.
  it('accepts a boundary before anything has been captured', () => {
    const { doc, undo } = rig();

    undo.boundary();
    undo.boundary();
    keystroke(textOf(doc, NOTE), 'x');

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(textOf(doc, NOTE).toString()).toBe('');
  });

  // Two edits of the same note, separated by a boundary (the editor closing and
  // opening again), undo one at a time — the second one first.
  it('undoes two edit sessions of one note in reverse order', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    undo.boundary();
    keystroke(text, 'first');
    undo.boundary(); // editor closed
    vi.advanceTimersByTime(60);
    undo.boundary(); // editor opened again
    keystroke(text, ' second');
    undo.boundary();

    expect(text.toString()).toBe('first second');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('first');
    expect(undo.undo()).toBe(true);
    expect(text.toString()).toBe('');
    expect(undo.canUndo()).toBe(false);
  });

  // A long enough pause splits typing even with no boundary in between: the
  // window is not something the caller has to remember to close.
  it('splits on its own when the typing pauses', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    undo.boundary();
    keystroke(text, 'a');
    vi.advanceTimersByTime(UNDO_CAPTURE_TIMEOUT_MS * 3);
    keystroke(text, 'b');

    expect(stepCount(undo)).toBe(2);
  });

  // The window's length is the configured value and not a hard-coded 500: a
  // shorter one splits sooner.
  it('honours a capture window given to it', () => {
    const doc = loadBoard([{ x: 0, y: 0 }]);
    const undo = createUndo(doc, { captureTimeoutMs: 120 });
    const text = textOf(doc, NOTE);

    undo.boundary();
    keystroke(text, 'a');
    vi.advanceTimersByTime(120);
    keystroke(text, 'b');
    vi.advanceTimersByTime(120);
    keystroke(text, 'c');

    expect(stepCount(undo)).toBe(3);
  });

  // A change whose window was still open when the key was pressed - the person got
  // to Undo before any pause ever came - is closed and stepped back all the same.
  // This is what several people undoing at the same moment relies on: nobody waits
  // half a second before reaching for the key, and a step that refused to be stepped
  // back because it was still being written would be the story's whole promise
  // broken.
  it('steps back a change whose window was still open', () => {
    const { doc, undo } = rig();

    moveObjects(doc, new Map([[NOTE, { x: 320, y: 120 }]]));

    expect(undo.canUndo()).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(positionOf(doc, NOTE)).toEqual({ x: 0, y: 0 });
    expect(undo.canUndo()).toBe(false);
  });

  // Two changes made back to back, with no pause and nothing between them but the
  // gesture's own ending, stay two steps: the window merges what belongs together
  // and never what merely happened quickly.
  it('keeps two changes made back to back as two steps', () => {
    const { doc, undo } = rig();
    const text = textOf(doc, NOTE);

    moveObjects(doc, new Map([[NOTE, { x: 320, y: 120 }]]));
    undo.boundary(); // the gesture came to an end
    keystroke(text, 'typed');

    expect(stepCount(undo)).toBe(2);
    expect(positionOf(doc, NOTE)).toEqual({ x: 0, y: 0 });
    expect(text.toString()).toBe('');
  });
});
