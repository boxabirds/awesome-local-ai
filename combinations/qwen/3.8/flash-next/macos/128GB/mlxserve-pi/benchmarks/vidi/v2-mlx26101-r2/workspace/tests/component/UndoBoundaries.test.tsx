/**
 * Where one undo step begins and ends, in the interface that draws them
 * (`tests/component/UndoBoundaries.test.tsx`, PRD `undo.boundaries`, TC-14 to TC-17).
 *
 * The unit tests in `tests/unit/undo-boundaries.test.ts` settle the rule the manager
 * applies - a pause of `UNDO_CAPTURE_TIMEOUT_MS` or more, or a boundary, starts a new
 * step - with a clock the test turns by hand. What is left to prove here is that the
 * board *draws its boundaries in the right places*, which is a claim about gestures,
 * toolbars and a textarea rather than about a timeout: a drag writes to the document
 * once an animation frame, dozens of times, and must come back as one movement; a
 * colour chosen two hundred milliseconds after a drag must not be swallowed into it;
 * and Ctrl+Z inside a note must take back the typing rather than the move that
 * happened before it.
 *
 * Which is also why these tests run on the real clock. A drag and a swatch click a
 * fifth of a second apart are, in a real board, exactly the two things a person does
 * one after the other, and the only thing that keeps them apart in the history is the
 * boundary the gesture draws when it ends. Freezing time would test the timeout again
 * - which the unit file has already done, to the millisecond - and miss the wiring
 * that is what this file is about.
 *
 * One thing is faked: the room. `seed` puts a note on the board the way a note that is
 * already there when a tab joins gets there - as an update from somewhere else, with
 * an origin that is not this tab's - so the history under test starts empty, as it
 * does for a person who arrives at a board that already has notes on it. That is what
 * lets a test say "one undo, and the button is grey again": the number of steps is the
 * number of things this tab did, with nothing from the fixture mixed in.
 */

import { act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  createSticky,
  getStickyText,
  initDoc,
  objectBounds,
  type ObjectSnapshot,
  type StickySnapshot,
  type WorldPoint,
} from '../../src/shared/board-model.js';
import { UNDO_CAPTURE_TIMEOUT_MS, type StickyColor } from '../../src/shared/config.js';
import { worldToScreen, type Point } from '../../src/client/canvas/camera.js';
import {
  boardDoc,
  camera,
  docNotes,
  editor,
  editorValue,
  flushFrames,
  keydown,
  noteToolbarElement,
  pressNote,
  renderBoard,
  typeText,
} from './helpers.js';

beforeEach(() => {
  renderBoard();
});

/* ------------------------------------------------------------- local helpers */

/** The origin of something that was on the board before this tab got here. */
const SEED_ORIGIN: unique symbol = Symbol('vidi6-seeded-before-this-tab');

/**
 * Put a note on the board from outside: built on another document and applied as an
 * update, which is how every note that was already there when this person joined
 * arrives. The board's own history never sees it (PRD `undo.own`), so a test starts
 * with the notes it needs and nothing to undo.
 */
function seed(at: WorldPoint, color: StickyColor = 'yellow'): string {
  const doc = boardDoc();
  const elsewhere = new Y.Doc();
  initDoc(elsewhere);
  const id = createSticky(elsewhere, at, color);
  if (typeof id !== 'string') throw new Error('the model refused to make a note');
  act(() => {
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(elsewhere, Y.encodeStateVector(doc)), SEED_ORIGIN);
  });
  flushFrames();
  return id;
}

function note(id: string): ObjectSnapshot {
  const found = docNotes().find((object) => object.id === id);
  if (!found) throw new Error(`no object ${id} in the document`);
  return found;
}

/** A seeded note, read as the sticky note it is (the colour is what needs it). */
function sticky(id: string): StickySnapshot {
  return note(id) as StickySnapshot;
}

function element(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!found) throw new Error(`object ${id} is not rendered`);
  return found;
}

/** Where an object is and how big it is, as one comparable string. */
function place(id: string): string {
  const bounds = objectBounds(note(id));
  return `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
}

function centre(id: string): Point {
  const bounds = objectBounds(note(id));
  return worldToScreen(camera(), {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
}

function buttonOf(testId: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`the toolbar has no ${testId}`);
  return found;
}

const undoButton = (): HTMLButtonElement => buttonOf('undo-button');
const redoButton = (): HTMLButtonElement => buttonOf('redo-button');

/** Whether the board offers this person each of the two directions. */
const canUndo = (): boolean => !undoButton().disabled;
const canRedo = (): boolean => !redoButton().disabled;

/** The two buttons in the left toolbar, which is how a person uses them. */
const undo = (): void => {
  fireEvent.click(undoButton());
  flushFrames();
};
const redo = (): void => {
  fireEvent.click(redoButton());
  flushFrames();
};

/** The note's text as the document holds it. */
function textOf(id: string): string {
  const ytext = getStickyText(boardDoc(), id);
  return ytext ? ytext.toString() : '';
}

/** Real time, for the pauses that are part of the case being tested. */
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Drag an object by `delta`, moving the pointer `frames` times - once per animation
 * frame, which is what a drag on a screen is - and return the writes the drag made to
 * the document while it was going on.
 */
function drag(id: string, delta: Point, frames = 6): number {
  const target = element(id);
  const from = centre(id);
  const writes = countBoardWrites();
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  flushFrames();
  for (let frame = 1; frame <= frames; frame += 1) {
    const t = frame / frames;
    fireEvent.pointerMove(target, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + delta.x * t,
      clientY: from.y + delta.y * t,
    });
    flushFrames();
  }
  fireEvent.pointerUp(target, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    clientX: from.x + delta.x,
    clientY: from.y + delta.y,
  });
  flushFrames();
  return writes();
}

/** The same drag, given up by a `pointercancel` instead of a release. */
function dragThenCancel(id: string, delta: Point, frames = 6): void {
  const target = element(id);
  const from = centre(id);
  fireEvent.pointerDown(target, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: from.x,
    clientY: from.y,
  });
  flushFrames();
  for (let frame = 1; frame <= frames; frame += 1) {
    const t = frame / frames;
    fireEvent.pointerMove(target, {
      pointerId: 1,
      pointerType: 'mouse',
      buttons: 1,
      clientX: from.x + delta.x * t,
      clientY: from.y + delta.y * t,
    });
    flushFrames();
  }
  // The browser taking the pointer away in the middle of a gesture: another touch, a
  // system gesture, the tab losing it. It is delivered on the note and bubbles, which
  // is how the gesture hook hears it.
  fireEvent.pointerCancel(target, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    clientX: from.x + delta.x,
    clientY: from.y + delta.y,
  });
  flushFrames();
}

/** Count the document's own writes, which is what the capture window merges. */
function countBoardWrites(): () => number {
  const doc = boardDoc();
  let writes = 0;
  const listener = (): void => {
    writes += 1;
  };
  doc.on('update', listener);
  return () => {
    doc.off('update', listener);
    return writes;
  };
}

/** Ctrl+A: the whole board selected, so a drag moves all of it. */
function selectAll(): void {
  keydown('a', { ctrl: true });
}

/**
 * Ctrl+Z (or Cmd+Z, or its redo) inside the open note editor. Returns whether the
 * editor refused the event: `fireEvent` answers `false` when somebody called
 * `preventDefault`, and refusing the browser's own undo is half of what the editor
 * promises - the other half being that the board's history took the keystroke instead.
 */
function editKey(key: 'z' | 'y', modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}): boolean {
  const element = editor();
  const survived = fireEvent.keyDown(element, {
    key,
    ctrlKey: modifiers.ctrl ?? !modifiers.meta,
    metaKey: modifiers.meta ?? false,
    shiftKey: modifiers.shift ?? false,
  });
  flushFrames();
  return !survived;
}

/* ------------------------------ TC-14: a drag of thirty frames is one movement */

describe('a drag is one undo step (TC-14)', () => {
  it('puts a thirty-frame drag of the whole selection back in one go', () => {
    const ids = [seed({ x: -260, y: 0 }), seed({ x: 0, y: 0 }), seed({ x: 260, y: 0 })];
    const started = ids.map((id) => place(id));
    // A board this tab has done nothing to: the history is empty, however full of
    // notes the screen is.
    expect(canUndo()).toBe(false);

    selectAll();
    const writes = drag(ids[2]!, { x: 180, y: 90 }, 30);

    // Thirty frames of pointer moves, dozens of writes to the document, all of them
    // one after another within milliseconds - and one thing this person did.
    expect(writes).toBeGreaterThan(10);
    for (const id of ids) expect(place(id)).not.toBe(started[ids.indexOf(id)]);

    undo();

    // One undo, and every object in the selection is back where it was, to the world
    // unit: they moved together and came back together.
    ids.forEach((id, index) => expect(place(id)).toBe(started[index]));
    // With nothing of this tab's work left behind it: not twenty-nine more frames of
    // the same drag creeping out of the history one by one.
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
  });

  it('redoes the drag as the same movement', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);
    drag(id, { x: 200, y: 0 }, 12);
    const moved = place(id);
    expect(moved).not.toBe(started);

    undo();
    expect(place(id)).toBe(started);
    redo();
    // The whole movement back, not the last frame of it.
    expect(place(id)).toBe(moved);
    expect(canRedo()).toBe(false);
    expect(canUndo()).toBe(true);
  });

  it('keeps two drags of two objects apart', () => {
    const ids = [seed({ x: -200, y: 0 }), seed({ x: 200, y: 0 })];
    const [first, second] = ids;
    const started = [place(first!), place(second!)];

    // One drag straight after the other, well inside the same capture window: the
    // boundary the gesture draws when it ends is the only thing between them.
    drag(first!, { x: 100, y: 0 }, 5);
    drag(second!, { x: 0, y: 100 }, 5);

    undo();
    expect(place(first!)).not.toBe(started[0]);
    expect(place(second!)).toBe(started[1]);
    undo();
    expect(place(first!)).toBe(started[0]);
    expect(canUndo()).toBe(false);
  });
});

/* ------------------- TC-15: a colour straight after a drag is its own step */

describe('two things done one after the other (TC-15)', () => {
  it('keeps a drag and a colour chosen two hundred milliseconds later apart', async () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);

    drag(id, { x: 120, y: 40 }, 8);
    const moved = place(id);

    // A fifth of a second later - inside the capture window, so the timeout on its
    // own would call the two one step - the note toolbar is showing and a colour is
    // chosen from it.
    expect(200).toBeLessThan(UNDO_CAPTURE_TIMEOUT_MS);
    await wait(200);
    const swatch = document.querySelector<HTMLElement>('[data-testid="sticky-color-blue"]');
    if (!swatch) throw new Error(`the note toolbar is not showing (${noteToolbarElement()})`);
    fireEvent.click(swatch);
    flushFrames();
    expect(sticky(id).color).toBe('blue');

    undo();
    // The colour came back and the move stayed, taken in the order they were given.
    // Had the two merged, this undo would have returned a note that was both yellow
    // again and back where it started.
    expect(sticky(id).color).toBe('yellow');
    expect(place(id)).toBe(moved);

    undo();
    expect(place(id)).toBe(started);
    expect(canUndo()).toBe(false);

    // and both steps are there to be put back, in the order they were done.
    redo();
    expect(place(id)).toBe(moved);
    redo();
    expect(sticky(id).color).toBe('blue');
  });

  it('keeps a delete and the move before it apart', () => {
    const ids = [seed({ x: -200, y: 0 }), seed({ x: 200, y: 0 })];
    const [first, second] = ids;
    const started = place(first!);

    drag(first!, { x: 60, y: 0 }, 4);
    const moved = place(first!);
    expect(moved).not.toBe(started);

    // Select the other note and delete it with the board's Delete key.
    const at = centre(second!);
    pressNote(at, element(second!));
    keydown('Delete');
    expect(docNotes().map((object) => object.id)).toEqual([first!]);

    undo();
    // The note is back, and the one that was moved is still moved: the Delete is one
    // step, and it is not the drag.
    expect(docNotes()).toHaveLength(2);
    expect(place(first!)).toBe(moved);
    undo();
    expect(place(first!)).toBe(started);
    expect(canUndo()).toBe(false);
  });

  it('keeps an arrow-key nudge and the drag before it apart', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);

    drag(id, { x: 90, y: 0 }, 4);
    const moved = place(id);

    // The selection is still this note; four arrow presses, one after another, four
    // steps - a history that does not match the keys pressed is no use to anyone.
    for (let press = 0; press < 4; press += 1) keydown('ArrowRight');
    expect(place(id)).not.toBe(moved);

    undo();
    expect(place(id)).not.toBe(moved);
    undo();
    undo();
    undo();
    expect(place(id)).toBe(moved);
    undo();
    expect(place(id)).toBe(started);
    expect(canUndo()).toBe(false);
  });
});

/* ---------------- TC-16: Ctrl+Z inside a note undoes the typing, not the move */

describe('Ctrl+Z inside a note (TC-16)', () => {
  it('takes back the typing and leaves the move that came before it', () => {
    const id = seed({ x: 0, y: 0 });
    const writes = drag(id, { x: 100, y: 0 }, 6);
    const moved = place(id);
    expect(writes).toBeGreaterThan(3);

    // Enter opens the selected note for typing; the word is typed in one burst.
    keydown('Enter');
    expect(editorValue()).toBe('');
    typeText('hello');
    expect(editorValue()).toBe('hello');

    // The browser's own undo of the textarea is refused, and the board's history takes
    // the keystroke instead.
    expect(editKey('z')).toBe(true);
    expect(editorValue()).toBe('');
    expect(textOf(id)).toBe('');
    // The move the drag made is untouched: the step is the typing, and the note keeps
    // the place it was dragged to.
    expect(place(id)).toBe(moved);

    // Redo, from inside the same editor, puts the word back as one word.
    expect(editKey('z', { shift: true })).toBe(true);
    expect(editorValue()).toBe('hello');
    expect(place(id)).toBe(moved);
  });

  it('takes back a burst of typing and no further', async () => {
    const id = seed({ x: 0, y: 0 });
    pressNote(centre(id), element(id));
    keydown('Enter');
    typeText('a first thought');
    // A pause longer than the setting, which is the timeout's own boundary drawn by
    // the keystrokes themselves rather than by the editor: two things this person
    // wrote, and the history has to agree.
    await wait(UNDO_CAPTURE_TIMEOUT_MS + 60);
    typeText('a first thought, and a second one');
    expect(textOf(id)).toBe('a first thought, and a second one');

    expect(editKey('z')).toBe(true);
    // What came back is the whole second thought - not one character of it, which is
    // what a history of keystrokes would have done, and not both of them.
    expect(textOf(id)).toBe('a first thought');

    expect(editKey('z')).toBe(true);
    expect(textOf(id)).toBe('');
  });

  it('leaves a note made before the typing on the board when the typing is undone', () => {
    // The toolbar's own path: its button makes a note and opens it for typing, and the
    // two are separate steps, so Undo inside the note takes the typing away and the
    // next Undo takes the note.
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="create-sticky-button"]')!);
    flushFrames();
    const id = docNotes()[0]!.id;
    typeText('typed into a new note');

    expect(editKey('z')).toBe(true);
    expect(docNotes()).toHaveLength(1);
    expect(textOf(id)).toBe('');

    undo();
    expect(docNotes()).toHaveLength(0);
    expect(canUndo()).toBe(false);
  });

  it('refuses the browser undo but not the browser caret', () => {
    const id = seed({ x: 0, y: 0 }, 'pink');
    const started = place(id);
    pressNote(centre(id), element(id));
    keydown('Enter');
    typeText('some words');

    // An ordinary keystroke is the textarea's own and is not refused: the board must
    // not swallow typing on its way to owning undo.
    expect(fireEvent.keyDown(editor(), { key: 'a' })).toBe(true);
    expect(place(id)).toBe(started);
    expect(textOf(id)).toBe('some words');
  });
});

/* ------------------------ TC-17: a cancelled drag is still one undo step */

describe('a drag the browser takes away (TC-17)', () => {
  it('comes back as one step when the pointer is cancelled mid-drag', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);

    dragThenCancel(id, { x: 140, y: 60 }, 10);

    // The frames that did get through are kept - nothing rolls back on its own - so
    // there is something to undo, and it is one movement.
    const cancelled = place(id);
    expect(cancelled).not.toBe(started);
    expect(canUndo()).toBe(true);

    undo();
    expect(place(id)).toBe(started);
    // One step: the cancelled gesture left no half-frames behind to be undone one by
    // one, and exactly one redo matches it.
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);

    redo();
    expect(place(id)).toBe(cancelled);
  });

  it('leaves nothing to undo when it was cancelled before it started', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);
    const target = element(id);
    const at = centre(id);

    // A press and a cancel, with no move past the drag threshold: the gesture never
    // started, so there was no window to close - and a boundary on an empty history is
    // neither an error nor a step.
    fireEvent.pointerDown(target, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();
    fireEvent.pointerCancel(target, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: at.x,
      clientY: at.y,
    });
    flushFrames();

    expect(place(id)).toBe(started);
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);

    // The next thing this person does is a step of its own, unaffected.
    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="create-sticky-button"]')!);
    flushFrames();
    expect(canUndo()).toBe(true);
    undo();
    expect(docNotes()).toHaveLength(1);
    expect(place(id)).toBe(started);
  });

  it('undoes a resize as the one size change it was', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);

    // Select it, then take the bottom-right handle and pull it out over a dozen
    // frames - which is a dozen writes to width and height.
    const at = centre(id);
    pressNote(at, element(id));
    const handle = document.querySelector<HTMLElement>(
      '[data-testid="resize-handle"][data-handle="se"]',
    );
    if (!handle) throw new Error('the selected note shows no bottom-right handle');
    const bounds = objectBounds(note(id));
    const corner = { x: at.x + bounds.width / 2, y: at.y + bounds.height / 2 };

    const writes = countBoardWrites();
    fireEvent.pointerDown(handle, {
      pointerId: 2,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: corner.x,
      clientY: corner.y,
    });
    flushFrames();
    for (let frame = 1; frame <= 12; frame += 1) {
      fireEvent.pointerMove(handle, {
        pointerId: 2,
        pointerType: 'mouse',
        buttons: 1,
        clientX: corner.x + frame * 4,
        clientY: corner.y + frame * 4,
      });
      flushFrames();
    }
    fireEvent.pointerUp(handle, {
      pointerId: 2,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: corner.x + 48,
      clientY: corner.y + 48,
    });
    flushFrames();

    const grown = place(id);
    expect(grown).not.toBe(started);
    expect(grown.split(',')[2]).not.toBe(started.split(',')[2]);
    expect(writes()).toBeGreaterThan(5);

    undo();
    expect(place(id)).toBe(started);
    expect(canUndo()).toBe(false);
  });

  it('is one step when a cancelled resize is followed by a drag', () => {
    const id = seed({ x: 0, y: 0 });
    const started = place(id);
    const at = centre(id);
    pressNote(at, element(id));
    const handle = document.querySelector<HTMLElement>(
      '[data-testid="resize-handle"][data-handle="se"]',
    );
    if (!handle) throw new Error('the selected note shows no bottom-right handle');
    const bounds = objectBounds(note(id));
    const corner = { x: at.x + bounds.width / 2, y: at.y + bounds.height / 2 };

    fireEvent.pointerDown(handle, {
      pointerId: 2,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: corner.x,
      clientY: corner.y,
    });
    flushFrames();
    fireEvent.pointerMove(handle, {
      pointerId: 2,
      pointerType: 'mouse',
      buttons: 1,
      clientX: corner.x + 30,
      clientY: corner.y + 30,
    });
    flushFrames();
    // The browser takes the pointer away mid-resize.
    fireEvent.pointerCancel(handle, { pointerId: 2, pointerType: 'mouse' });
    flushFrames();
    const resized = place(id);
    expect(resized).not.toBe(started);

    // The gesture ended, cancelled or not: the next drag is its own step, so two
    // undos give back the two things that were done.
    drag(id, { x: 0, y: 80 }, 4);
    const moved = place(id);
    expect(moved.split(',')[2]).toBe(resized.split(',')[2]);

    undo();
    expect(place(id)).toBe(resized);
    undo();
    expect(place(id)).toBe(started);
    expect(canUndo()).toBe(false);
  });
});
