import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { act, fireEvent, userEvent } from './tl.js';
import {
  CENTRE,
  board,
  boardDoc,
  clickBoard,
  clickStickyButton,
  createSelectedNote,
  docNotes,
  doubleClick,
  doubleClickBoard,
  editor,
  editorValue,
  editingNoteId,
  escapeFromEditor,
  keydown,
  noteData,
  noteElement,
  noteId,
  noteScreenCentre,
  noteText,
  pressKey,
  pressNote,
  renderApp,
  renderedNoteText,
  selectedNoteId,
  typeMore,
  typeText,
} from './helpers.js';
import { getStickyText } from '../../src/shared/board-model.js';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config.js';
import { PROSE_1000, PROSE_1050, RETRO_ITEM, SHORT_TEXT } from '../fixtures/texts.js';

/**
 * sticky.text (ui-component): what the editor writes into the shared Y.Text,
 * when it writes it, and what the character counter shows.
 *
 * The editor is uncontrolled on purpose: the document, not React state, holds
 * the text. Every assertion therefore goes to the document (`noteText`) and only
 * secondarily to the textarea.
 */

beforeEach(() => {
  renderApp();
});

/** The character counter, if one is rendered. */
const counter = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-testid="sticky-counter"]');

describe('sticky.text: starting to edit', () => {
  it('TC-23 puts the caret at the end of the text when Enter opens a note', () => {
    createSelectedNote('Retro board');

    keydown('Enter');

    const element = editor();
    expect(editingNoteId()).toBe(noteId(0));
    expect(document.activeElement).toBe(element);
    expect(element.value).toBe('Retro board');
    expect(element.selectionStart).toBe('Retro board'.length);
    expect(element.selectionEnd).toBe('Retro board'.length);
    // The note itself does not show the text twice while it is being edited.
    expect(noteElement(0).querySelector('[data-testid="sticky-text"]')).toBeNull();
  });

  it('TC-23b puts the caret at the end when a double-click opens a note', () => {
    createSelectedNote('Retro board');

    doubleClick(noteElement(0), noteScreenCentre(0));

    expect(editorValue()).toBe('Retro board');
    expect(editor().selectionStart).toBe(11);
  });

  it('TC-23c opens an empty note with the caret at position 0', () => {
    clickStickyButton();

    expect(editor().selectionStart).toBe(0);
    expect(editor().selectionEnd).toBe(0);
  });

  it('writes text into the document as it is typed, before editing ends', () => {
    clickStickyButton();

    typeText(SHORT_TEXT);

    // The write already happened: nothing is saved "when editing ends".
    expect(noteText(0)).toBe(SHORT_TEXT);
    expect(getStickyText(boardDoc(), noteId(0))?.toString()).toBe(SHORT_TEXT);
  });

  it('keeps the line breaks of a three-line note', async () => {
    const user = userEvent.setup();
    clickStickyButton();

    await act(async () => {
      await user.type(editor(), RETRO_ITEM.split('\n').join('{enter}'));
    });

    expect(noteText(0)).toBe(RETRO_ITEM);
    expect(noteText(0).split('\n')).toHaveLength(3);
  });
});

describe('sticky.text: ending editing', () => {
  it('TC-24 keeps the text and the selection when Escape ends editing', () => {
    clickStickyButton();
    typeText('Half finished thought');

    escapeFromEditor();

    expect(editingNoteId()).toBeNull();
    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(selectedNoteId()).toBe(noteId(0));
    expect(noteText(0)).toBe('Half finished thought');
    expect(renderedNoteText(0)).toBe('Half finished thought');
  });

  it('TC-38 keeps the text and clears the selection when the user clicks outside', () => {
    clickStickyButton();
    typeText('abc');

    clickBoard();

    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(noteText(0)).toBe('abc');
    expect(getStickyText(boardDoc(), noteId(0))?.toString()).toBe('abc');
    expect(selectedNoteId()).toBeNull();
    expect(editingNoteId()).toBeNull();
  });

  it('TC-38b keeps the text when another note is clicked instead', () => {
    createSelectedNote('First');
    clickStickyButton();
    typeText('Second');
    const second = 1;

    // A click on the other note: editing ends, the other note is selected.
    pressNote(noteScreenCentre(0));

    expect(noteText(second)).toBe('Second');
    expect(editingNoteId()).toBeNull();
    expect(selectedNoteId()).toBe(noteData(0).id);
  });

  it('TC-26 leaves the note alone when Backspace is pressed inside its text', async () => {
    const user = userEvent.setup();
    clickStickyButton();

    // A real browser deletes the character in the text field; the shortcut
    // listener on the window must not turn the same key into a note deletion.
    await act(async () => {
      await user.type(editor(), 'ab{backspace}');
    });

    expect(docNotes()).toHaveLength(1);
    expect(noteText(0)).toBe('a');
    expect(editorValue()).toBe('a');
    expect(editingNoteId()).toBe(noteId(0));
  });

  it('stays open while the pointer is pressed inside the note being edited', () => {
    clickStickyButton();
    typeText('abc');

    // The click that places the caret is inside the note: editing continues.
    fireEvent.pointerDown(editor(), { pointerId: 1, pointerType: 'mouse', button: 0 });
    fireEvent.pointerUp(editor(), { pointerId: 1, pointerType: 'mouse', button: 0 });

    expect(editingNoteId()).toBe(noteId(0));
    expect(editorValue()).toBe('abc');
  });

  it('does not create a note when Enter is pressed inside the text', () => {
    clickStickyButton();
    typeText('abc');

    pressKey('Enter', editor());

    expect(docNotes()).toHaveLength(1);
    // The window shortcut is not the same as the textarea's own Enter, which
    // would have added a line break.
    expect(noteText(0)).toBe('abc');
  });
});

describe('sticky.text: the 1,000 character limit', () => {
  it('TC-14a accepts a note of exactly 1,000 characters', () => {
    clickStickyButton();

    typeText(PROSE_1000);

    expect(noteText(0)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editorValue()).toBe(PROSE_1000);
  });

  it('TC-14b drops what is typed past the limit and keeps the caret at its end', () => {
    clickStickyButton();
    typeText(PROSE_1050);

    expect(noteText(0)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(noteText(0)).toBe(PROSE_1000);
    // The caret sits at the end of what was kept, so the next keystroke is
    // refused rather than inserted in the middle of the text.
    expect(editor().selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('TC-14c refuses a keystroke at the limit and keeps the text that is there', () => {
    clickStickyButton();
    typeText(PROSE_1000);

    typeMore('!');

    expect(noteText(0)).toBe(PROSE_1000);
    expect(editorValue()).toBe(PROSE_1000);
  });

  it('TC-14d shortens back below the limit without any trace of the limit', () => {
    clickStickyButton();
    typeText(PROSE_1050.slice(0, 999));

    typeText(PROSE_1000.slice(0, 500));

    expect(noteText(0)).toBe(PROSE_1000.slice(0, 500));
    expect(counter()).toBeNull();
  });

  it('TC-15a never stores half an emoji when the limit cuts the text', () => {
    clickStickyButton();
    // Half-way through, an emoji pair straddles the 1,000th position.
    const withEmoji = `${'a'.repeat(STICKY_TEXT_MAX_CHARS - 1)}\u{1F600}extra`;

    typeText(withEmoji);

    const stored = noteText(0);
    expect(stored.length).toBeLessThanOrEqual(STICKY_TEXT_MAX_CHARS);
    // No lone half of a surrogate pair: the string is valid UTF-16.
    expect(stored).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
    expect(stored).toBe('a'.repeat(STICKY_TEXT_MAX_CHARS - 1));
  });

  it('TC-16 shows the counter within 50 characters of the limit and not before', () => {
    clickStickyButton();

    typeText('x'.repeat(949));
    expect(counter()).toBeNull();

    typeText('x'.repeat(950));
    expect(counter()).not.toBeNull();
    expect(counter()?.textContent).toBe('950/1000');

    typeText('x'.repeat(1000));
    expect(counter()?.textContent).toBe('1000/1000');
    expect(counter()?.dataset.remaining).toBe('0');

    typeText('x'.repeat(960));
    expect(counter()).not.toBeNull();

    typeText('x'.repeat(949));
    expect(counter()).toBeNull();
  });

  it('TC-16b hides the counter when editing ends', () => {
    clickStickyButton();
    typeText('x'.repeat(980));
    expect(counter()).not.toBeNull();

    escapeFromEditor();

    expect(counter()).toBeNull();
    expect(noteText(0)).toHaveLength(980);
  });
});

describe('sticky.text: input methods', () => {
  it('applies an IME composition once, on compositionend', () => {
    clickStickyButton();
    typeText('Retro board ');
    const element = editor();

    // What an input method does: composition starts, the field shows the
    // in-progress text (which is not the user's words yet), then it is confirmed.
    act(() => {
      fireEvent.compositionStart(element);
    });
    element.value = 'Retro board 你';
    act(() => {
      fireEvent.input(element);
    });
    // Nothing half-finished reached the document.
    expect(noteText(0)).toBe('Retro board ');

    element.value = 'Retro board 你好';
    act(() => {
      fireEvent.compositionEnd(element);
    });

    expect(noteText(0)).toBe('Retro board 你好');
    expect(editorValue()).toBe('Retro board 你好');
  });

  it('TC-13b keeps its own text when the caret is moved and a character is inserted', () => {
    clickStickyButton();
    typeText('Retro board');
    const element = editor();

    // The caret goes to the front and a word is inserted there: only that
    // insertion is written, the rest of the text stays.
    element.value = `Faster ${element.value}`;
    element.setSelectionRange(7, 7);
    act(() => {
      fireEvent.input(element);
    });

    expect(noteText(0)).toBe('Faster Retro board');
    expect(element.selectionStart).toBe(7);
  });

  it('double-clicking the note again after editing shows the stored text', () => {
    createSelectedNote('Kept');

    doubleClick(noteElement(0), noteScreenCentre(0));
    expect(editorValue()).toBe('Kept');

    escapeFromEditor();

    expect(renderedNoteText(0)).toBe('Kept');
    // The board is left with exactly one note and nothing focused.
    expect(docNotes()).toHaveLength(1);
    expect(board().contains(document.activeElement)).toBe(false);
  });

  it('TC-23d opens the note for typing right after it is created', () => {
    // The creation gesture ends with the editor open and focused: the user never
    // has to click the note to start typing.
    doubleClickBoard(CENTRE);

    expect(editingNoteId()).toBe(noteId(0));
    expect(document.activeElement).toBe(editor());
    expect(docNotes()).toHaveLength(1);
  });
});

/**
 * Another person typing into the note this person has open (story 3). The peer
 * is a second `Y.Doc`, synced both ways with the board's document exactly as the
 * room syncs two browsers: the peer's update is applied to the board's doc, and
 * the doc's own state vector is passed to `encodeStateAsUpdate` so only what the
 * board does not have arrives.
 */
describe('sticky.text: somebody else typing into the same note', () => {
  /** A document that holds the same board as the app's. */
  function peerDoc(): Y.Doc {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(boardDoc()));
    return peer;
  }

  /** Hand the board's document everything the peer has that it does not. */
  function deliverFrom(peer: Y.Doc): void {
    Y.applyUpdate(boardDoc(), Y.encodeStateAsUpdate(peer, Y.encodeStateVector(boardDoc())));
  }

  /** Type text into the note from the peer's side. */
  function peerTypes(noteIdValue: string, text: string): void {
    const peer = peerDoc();
    const text$1 = getStickyText(peer, noteIdValue);
    if (!text$1) throw new Error(`the peer has no note ${noteIdValue}`);
    text$1.insert(text$1.length, text);
    deliverFrom(peer);
  }

  /** Put one character into the textarea at the caret, as a browser does. */
  function typeAtCaret(character: string): void {
    const element = editor();
    const at = element.selectionStart;
    const next =
      element.value.slice(0, at) + character + element.value.slice(element.selectionEnd);
    element.value = next;
    element.setSelectionRange(at + character.length, at + character.length);
    act(() => {
      fireEvent.input(element, { target: { value: next } });
    });
  }

  it('TC-23e keeps a caret at the end of the text when characters arrive from elsewhere', () => {
    clickStickyButton();
    typeText('green');
    const id = editingNoteId();
    if (!id) throw new Error('the new note is not open for editing');

    // Somebody else adds to the same note while this one is open.
    act(() => {
      peerTypes(id, ' blue');
    });

    expect(editorValue()).toBe('green blue');
    // The caret is at the end of what arrived. Had it stayed at 5, this person's
    // next keystroke would have landed between the characters they had already
    // typed and the word would come out scrambled.
    expect(editor().selectionStart).toBe('green blue'.length);

    // So their own next characters go on the end, in their own order.
    typeAtCaret('r');
    typeAtCaret('e');
    typeAtCaret('d');
    expect(noteText(0)).toBe('green bluered');
    expect(editorValue()).toBe('green bluered');
  });

  it('TC-23f leaves a caret in the middle of the text where it was', () => {
    clickStickyButton();
    typeText('green');
    const id = editingNoteId();
    if (!id) throw new Error('the new note is not open for editing');

    // This person's caret is at the start, editing the first letter.
    editor().setSelectionRange(0, 0);

    act(() => {
      peerTypes(id, ' blue');
    });

    // Their place in the text is untouched by what arrived.
    expect(editorValue()).toBe('green blue');
    expect(editor().selectionStart).toBe(0);

    typeAtCaret('X');
    expect(noteText(0)).toBe('Xgreen blue');
  });
});
