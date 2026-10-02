import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_OVER_LIMIT } from '../fixtures/texts';

/**
 * Component tests for sticky text editing: what is typed reaches the document
 * as it is typed, the limit is applied, Escape and a click away end editing, and
 * a typing key never deletes the note.
 */

const board = () => screen.getByTestId('board-viewport');
const note = () => screen.getByTestId('sticky-note');
const editor = () => screen.queryByTestId('sticky-textarea');
const counter = () => screen.queryByTestId('sticky-counter');
const area = () => screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

function flushFrame() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

function renderBoard() {
  render(<App doc={doc} />);
  flushFrame();
}

/** Select the note and open it for typing, the way a user does. */
function startEditing() {
  fireEvent.pointerDown(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 1 });
  fireEvent.pointerUp(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 1 });
  fireEvent.doubleClick(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 1 });
  flushFrame();
}

/** One keystroke: the browser has already put the character in the textarea. */
function type(value: string) {
  const el = area();
  fireEvent.input(el, { target: { value } });
  flushFrame();
}

let doc: Y.Doc;
let id: string;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'],
  });
  doc = new Y.Doc();
  id = createSticky(doc, { x: 300, y: 200 });
});

afterEach(() => {
  vi.useRealTimers();
  doc.destroy();
});

describe('sticky.text — editing', () => {
  it('TC-23 Enter on a selected note opens it with the text and the caret at the end', () => {
    act(() => {
      getStickyText(doc, id)?.insert(0, 'kick off');
    });
    renderBoard();
    fireEvent.pointerDown(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 1 });
    fireEvent.pointerUp(note(), { clientX: 340, clientY: 240, button: 0, pointerId: 1 });

    fireEvent.keyDown(window, { key: 'Enter', bubbles: true, cancelable: true });
    flushFrame();

    expect(area()).toBe(document.activeElement);
    expect(area().value).toBe('kick off');
    expect(area().selectionStart).toBe('kick off'.length);
    expect(area().selectionEnd).toBe('kick off'.length);
    expect(note().dataset.selected).toBe('true');
  });

  it('TC-24 Escape ends editing, keeps the note selected and keeps the text', () => {
    act(() => {
      getStickyText(doc, id)?.insert(0, 'keep me');
    });
    renderBoard();
    startEditing();

    fireEvent.keyDown(area(), { key: 'Escape', bubbles: true, cancelable: true });
    flushFrame();

    expect(editor()).toBeNull();
    expect(note().dataset.selected).toBe('true');
    expect(snapshot(doc)[0].text).toBe('keep me');
  });

  it('every keystroke is written to the document as it is typed', () => {
    renderBoard();
    startEditing();

    type('a');
    expect(snapshot(doc)[0].text).toBe('a');
    type('ab');
    expect(snapshot(doc)[0].text).toBe('ab');
    type('abc');
    expect(getStickyText(doc, id)?.toString()).toBe('abc');
  });

  it('TC-26 Backspace while typing edits the text and leaves the note alone', () => {
    act(() => {
      getStickyText(doc, id)?.insert(0, 'ab');
    });
    renderBoard();
    startEditing();

    // What a user does: the key reaches the textarea, which drops a character.
    fireEvent.keyDown(area(), { key: 'Backspace', bubbles: true, cancelable: true });
    type('a');

    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(1);
    expect(snapshot(doc)[0].text).toBe('a');
    expect(editor()).not.toBeNull();
  });

  it('Enter inside the note adds a new line instead of ending editing', () => {
    renderBoard();
    startEditing();
    type('one');

    fireEvent.keyDown(area(), { key: 'Enter', bubbles: true, cancelable: true });
    type('one\ntwo');

    expect(snapshot(doc)[0].text).toBe('one\ntwo');
    expect(editor()).not.toBeNull();
  });

  it('TC-38 a click on the board after typing keeps the text and closes the editor', () => {
    renderBoard();
    startEditing();
    type('a');
    type('ab');
    type('abc');

    fireEvent.pointerDown(board(), { clientX: 900, clientY: 600, button: 0, pointerId: 2 });
    flushFrame();

    expect(editor()).toBeNull();
    expect(getStickyText(doc, id)?.toString()).toBe('abc');
    expect(note().dataset.selected).toBe('false');
  });

  it('a note keeps the text typed in a previous editing session', () => {
    renderBoard();
    startEditing();
    type('kept');
    fireEvent.blur(area());
    flushFrame();

    startEditing();
    expect(area().value).toBe('kept');
    expect(area().selectionStart).toBe(4);
  });

  it('an empty note opens with nothing in it and no counter', () => {
    renderBoard();
    startEditing();
    expect(area().value).toBe('');
    expect(counter()).toBeNull();
  });

  it('a pasted text longer than the limit keeps only what fits and says so', () => {
    renderBoard();
    startEditing();

    const pasted = PROSE_OVER_LIMIT;
    type(pasted);

    const kept = getStickyText(doc, id)?.toString() ?? '';
    expect(kept).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(area().value).toBe(kept);
    expect(counter()).not.toBeNull();
    expect(counter()?.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
    // The caret sits at the end of the kept text, so typing continues there.
    expect(area().selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('typing past the limit adds nothing and the text stops growing', () => {
    renderBoard();
    startEditing();
    const full = 'x'.repeat(STICKY_TEXT_MAX_CHARS);
    type(full);
    expect(getStickyText(doc, id)?.toString()).toBe(full);

    type(`${full}y`);

    expect(getStickyText(doc, id)?.toString()).toBe(full);
    expect(area().value).toBe(full);
  });

  it('the counter appears as the text gets long and stays until it is short again', () => {
    renderBoard();
    startEditing();
    type('x'.repeat(949));
    expect(counter()).toBeNull();

    type('x'.repeat(950));
    expect(counter()?.textContent).toBe('950/1000');

    type('x'.repeat(949));
    expect(counter()).toBeNull();
  });

  it('typing with an input method editor writes the text once', () => {
    renderBoard();
    startEditing();
    const el = area();

    // Chromium sends an input event for every keystroke of the composition, then
    // compositionend with the finished word in the textarea.
    fireEvent.compositionStart(el);
    fireEvent.input(el, { target: { value: 'か' } });
    expect(getStickyText(doc, id)?.toString()).toBe('');
    fireEvent.input(el, { target: { value: 'かんじ' } });
    expect(getStickyText(doc, id)?.toString()).toBe('');

    fireEvent.compositionEnd(el, { data: 'かんじ' });
    flushFrame();
    expect(getStickyText(doc, id)?.toString()).toBe('かんじ');

    // And editing continues normally afterwards.
    type('かんじです');
    expect(getStickyText(doc, id)?.toString()).toBe('かんじです');
  });

  it('a note whose text is cleared from the document shows the empty note while still editing', () => {
    renderBoard();
    startEditing();
    type('draft');

    act(() => {
      getStickyText(doc, id)?.delete(0, 5);
    });
    flushFrame();

    expect(snapshot(doc)[0].text).toBe('');
    expect(editor()).not.toBeNull(); // still editing an empty note
    // Story 3: cleared from the document means cleared on the screen too.
    expect(area().value).toBe('');
  });
});

/**
 * Story 3: an edit that arrives from the room goes into the note while it is open
 * for typing here. Waiting for the edit to end would be a board that shows the
 * last state of a note rather than what people are doing.
 */
describe('sticky.text — typing that arrives from the room', () => {
  /** Somebody else's keystrokes, arriving with the room as their origin. */
  function arrivingFromRoom(change: () => void): void {
    act(() => {
      doc.transact(change, 'from-the-room');
    });
    flushFrame();
  }

  const caret = (): [number, number] => {
    const el = area();
    return [el.selectionStart, el.selectionEnd];
  };

  /** A keystroke at the caret, which is where a person's next character goes. */
  function typeMore(text: string): void {
    const el = area();
    const next = el.value.slice(0, el.selectionEnd) + text + el.value.slice(el.selectionStart);
    fireEvent.input(el, { target: { value: next } });
    flushFrame();
  }

  it('shows words that arrive in front of the ones typed here', () => {
    renderBoard();
    startEditing();
    type('I am ');

    arrivingFromRoom(() => getStickyText(doc, id)?.insert(0, 'they said '));

    expect(area().value).toBe('they said I am ');
    // The caret stays behind the text typed here, not at the start of the note.
    expect(caret()).toEqual([15, 15]);
  });

  it('shows words that arrive behind the ones typed here and leaves the caret with them', () => {
    renderBoard();
    startEditing();
    type('alex ');

    arrivingFromRoom(() => getStickyText(doc, id)?.insert(5, 'was here '));

    expect(area().value).toBe('alex was here ');
    // The caret stays at the end of the text typed here rather than jumping over
    // the words that arrived behind it.
    expect(caret()).toEqual([5, 5]);
  });

  it('shows a deletion somebody else made while keeping the place in the text', () => {
    renderBoard();
    startEditing();
    type('a bad idea');

    arrivingFromRoom(() => getStickyText(doc, id)?.delete(2, 4));

    expect(area().value).toBe('a idea');
    expect(caret()).toEqual([6, 6]);
  });

  it('never drops what is typed here because something arrived', () => {
    renderBoard();
    startEditing();
    type('here is ');

    // The other person's words arrive, and then this person's next keystroke.
    arrivingFromRoom(() => getStickyText(doc, id)?.insert(0, 'theirs, '));
    typeMore('mine');

    expect(area().value).toBe('theirs, here is mine');
    expect(getStickyText(doc, id)?.toString()).toBe(area().value);
  });

  it('does not move the caret when the change is somewhere the caret is not', () => {
    renderBoard();
    startEditing();
    type('keep me here');

    arrivingFromRoom(() => getStickyText(doc, id)?.insert(0, 'front '));

    expect(area().value).toBe('front keep me here');
    expect(caret()).toEqual([18, 18]);
  });

  it('an edit of the note that came from this very textarea is not pulled back over itself', () => {
    renderBoard();
    startEditing();
    type('typing');

    // What is shown is what the document holds, and the caret is where the typing is.
    expect(area().value).toBe('typing');
    expect(caret()).toEqual([6, 6]);
  });
});
