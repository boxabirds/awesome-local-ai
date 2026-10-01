import { fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_FONT_MIN_PX, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import {
  clickAt,
  editorElement,
  modelNotes,
  noteElement,
  pressKey,
  renderStickyBoard,
  seedNote,
  textOf,
  toolbarElement,
  typeInto,
  viewport,
} from './stickyHarness';
import { LONG_TEXT, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Select a note and start editing it the way a user does: click, then Enter. */
const editNote = (_doc: Y.Doc, id: string): HTMLElement => {
  clickAt(noteElement(id), 300, 200);
  pressKey('Enter');
  const editor = editorElement();
  if (!editor) throw new Error('the editor did not open');
  return editor;
};

describe('sticky.text: start and finish editing', () => {
  it('TC-23 Enter on the selected note opens the editor with the caret at the end', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: SHORT_PHRASE });
    renderStickyBoard(doc);

    const editor = editNote(doc, id) as HTMLTextAreaElement;

    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe(SHORT_PHRASE);
    expect(editor.selectionStart).toBe(SHORT_PHRASE.length);
    expect(editor.selectionEnd).toBe(SHORT_PHRASE.length);
  });

  it('TC-24 Escape stops editing, keeps the text and leaves the note selected', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const editor = editNote(doc, id);
    typeInto(editor, 'Faster onboarding');

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(editorElement()).toBeNull();
    expect(getStickyText(doc, id)?.toString()).toBe('Faster onboarding');
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    expect(textOf(noteElement(id)).textContent).toBe('Faster onboarding');
    // Ending an edit performs no extra write: the toolbar is back and nothing moved.
    expect(toolbarElement()).toBeTruthy();
    const note = modelNotes(doc).find((entry) => entry.id === id);
    expect(note?.x).toBeCloseTo(-100, 6);
  });

  it('TC-38 typing then clicking outside unmounts the editor, keeps the text, clears selection', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const editor = editNote(doc, id);
    typeInto(editor, 'a');
    typeInto(editor, 'ab');
    typeInto(editor, 'abc');

    clickAt(viewport(), 700, 650);

    expect(editorElement()).toBeNull();
    expect(getStickyText(doc, id)?.toString()).toBe('abc');
    expect(noteElement(id).getAttribute('data-selected')).toBe('false');
    expect(textOf(noteElement(id)).textContent).toBe('abc');
  });

  it('Enter inside the note adds a new line instead of ending the edit', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const editor = editNote(doc, id);
    typeInto(editor, 'line one\nline two');

    expect(editorElement()).toBeTruthy();
    expect(getStickyText(doc, id)?.toString()).toBe('line one\nline two');
  });
});

describe('sticky.text: the character limit while editing', () => {
  it('TC-16 pasting beyond the limit keeps exactly 1,000 characters and restores the caret', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const editor = editNote(doc, id) as HTMLTextAreaElement;
    typeInto(editor, LONG_TEXT + 'overflow');

    const stored = getStickyText(doc, id)?.toString();
    expect(stored).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(stored).toBe(LONG_TEXT);
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editor.selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('the character counter appears only within 50 characters of the limit', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 });
    renderStickyBoard(doc);

    const editor = editNote(doc, id) as HTMLTextAreaElement;
    expect(document.querySelector('[data-testid="sticky-note-counter"]')).toBeNull();

    typeInto(editor, 'x'.repeat(949));
    expect(document.querySelector('[data-testid="sticky-note-counter"]')).toBeNull();

    typeInto(editor, 'x'.repeat(950));
    const counter = document.querySelector('[data-testid="sticky-note-counter"]');
    expect(counter?.textContent).toBe(`950/${STICKY_TEXT_MAX_CHARS}`);

    typeInto(editor, 'x'.repeat(STICKY_TEXT_MAX_CHARS));
    expect(document.querySelector('[data-testid="sticky-note-counter"]')?.textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });
});

describe('sticky.delete: keys belong to the text while editing', () => {
  it('TC-26 Backspace while editing edits the text and never deletes the note', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: 'ab' });
    renderStickyBoard(doc);

    const editor = editNote(doc, id);
    fireEvent.keyDown(editor, { key: 'Backspace' });
    typeInto(editor, 'a');

    expect(modelNotes(doc).map((note) => note.id)).toEqual([id]);
    expect(getStickyText(doc, id)?.toString()).toBe('a');
    expect(editorElement()).toBeTruthy();
  });

  it('Delete while editing does not remove the note', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: 'ab' });
    renderStickyBoard(doc);

    const editor = editNote(doc, id);
    fireEvent.keyDown(editor, { key: 'Delete' });
    typeInto(editor, 'b');

    expect(modelNotes(doc).map((note) => note.id)).toEqual([id]);
    expect(getStickyText(doc, id)?.toString()).toBe('b');
  });
});

describe('sticky.text: a note that is full of text', () => {
  it('TC-33 text that does not fit at the smallest size fades instead of truncating', () => {
    // jsdom performs no layout: the metrics are stubbed to report text far taller than the
    // note, which is what a real browser reports for a note full of text.
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(9_999);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(9_999);

    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: LONG_TEXT });
    renderStickyBoard(doc);

    const note = noteElement(id);
    expect(note.getAttribute('data-overflow')).toBe('true');
    expect(within(note).getByTestId('sticky-note-fade')).toBeTruthy();
    // The whole text is still there: the fade is a cue, not a truncation.
    expect(textOf(note).textContent).toBe(LONG_TEXT);
    expect(textOf(note).style.fontSize).toBe(`${STICKY_FONT_MIN_PX}px`);
  });

  it('a note that fits shows no fade and the text as it is', () => {
    const doc = new Y.Doc();
    const id = seedNote(doc, { x: 0, y: 0 }, { text: RETRO_ITEM });
    renderStickyBoard(doc);

    const note = noteElement(id);
    expect(note.getAttribute('data-overflow')).toBe('false');
    expect(within(note).queryByTestId('sticky-note-fade')).toBeNull();
    expect(textOf(note).textContent).toBe(RETRO_ITEM);
  });
});
