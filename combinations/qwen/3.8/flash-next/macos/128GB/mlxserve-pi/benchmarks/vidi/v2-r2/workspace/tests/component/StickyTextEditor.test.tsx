// sticky.text (ui-component): typing into a note. A real Y.Doc is behind the
// editor, so every assertion about "the text was saved" is about the document the
// board renders from, not about what the textarea happens to show.

import { describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  STICKY_COUNTER_THRESHOLD_CHARS,
  STICKY_FONT_MAX_PX,
  STICKY_FONT_MIN_PX,
  STICKY_TEXT_MAX_CHARS,
} from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { PROSE_1000, PROSE_1200, RETRO_ITEM, SHORT_PHRASE } from '../fixtures/texts';
import {
  boardSize,
  clickBoard,
  clickOn,
  counterElement,
  doubleClickBoard,
  doubleClickOn,
  editorElement,
  fadeElement,
  flushFrames,
  isEditing,
  modelText,
  newNote,
  noteAt,
  noteCount,
  noteFontPx,
  noteOverflows,
  notePosition,
  pressKey,
  pressKeyOn,
  readCamera,
  renderBoard,
  screenCentre,
  selectionCount,
  setNoteText,
  stubTextHeight,
  unstubTextHeight,
  useBoardTestLifecycle,
} from './helpers';

/** What the browser shows after the user typed or pasted `value`. */
function typeText(value: string): void {
  const el = editorElement();
  if (el === null) throw new Error('typeText: no note is being edited');
  fireEvent.input(el, { target: { value } });
}

/** Start editing the first note the way a double-click does. */
function openEditor(): string {
  doubleClickOn(noteAt(0));
  return String(noteAt(0).dataset.noteId);
}

describe('sticky note text editor', () => {
  useBoardTestLifecycle();

  it('TC-23 opens on Enter focused, with the caret at the end of the existing text', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    setNoteText(doc, id, SHORT_PHRASE);
    clickOn(noteAt(0));

    pressKey('Enter');

    const el = editorElement();
    expect(el).not.toBeNull();
    expect(document.activeElement).toBe(el);
    expect(el?.selectionStart).toBe(SHORT_PHRASE.length);
    expect(el?.selectionEnd).toBe(SHORT_PHRASE.length);
    expect(el?.value).toBe(SHORT_PHRASE);
    // what a screen reader announces for the field
    expect(el?.getAttribute('aria-label')).toBe('Sticky note text');
  });

  it('TC-24 leaves editing on Escape with the text kept and the note still selected', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    typeText('  spaced  ');

    pressKeyOn(editorElement(), 'Escape');

    expect(isEditing()).toBe(false);
    expect(modelText(doc, id)).toBe('  spaced  ');
    expect(selectionCount()).toBe(1);
    // the note shows the text it holds, spaces and all
    expect(noteAt(0).dataset.noteId).toBe(id);
    expect(textOfNote(0)).toContain('spaced');
  });

  it('TC-26 Backspace while typing edits the text and never deletes the note', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    setNoteText(doc, id, 'ab');
    openEditor();

    pressKeyOn(editorElement(), 'Backspace');
    // the browser did its own editing, which is what the board has to keep up with
    typeText('a');

    expect(noteCount()).toBe(1);
    expect(modelText(doc, id)).toBe('a');
    expect(isEditing()).toBe(true);
  });

  it('TC-26 Delete while typing edits the text and never deletes the note', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    setNoteText(doc, id, 'ab');
    openEditor();

    pressKeyOn(editorElement(), 'Delete');
    typeText('b');

    expect(noteCount()).toBe(1);
    expect(modelText(doc, id)).toBe('b');
  });

  it('TC-38 ends editing and deselects when the board outside the note is clicked', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    typeText('abc');
    expect(modelText(doc, id)).toBe('abc');

    clickBoard(600, 500);

    expect(isEditing()).toBe(false);
    expect(editorElement()).toBeNull();
    expect(modelText(doc, id)).toBe('abc');
    expect(selectionCount()).toBe(0);
  });

  it('TC-38 keeps the note selected when editing ends with Escape', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    typeText('abc');

    pressKeyOn(editorElement(), 'Escape');

    expect(isEditing()).toBe(false);
    expect(modelText(doc, id)).toBe('abc');
    expect(selectionCount()).toBe(1);
  });

  it('writes the document on every keystroke, so nothing waits for a blur', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();

    typeText('o');
    expect(modelText(doc, id)).toBe('o');
    typeText('on');
    expect(modelText(doc, id)).toBe('on');
    typeText('o');
    expect(modelText(doc, id)).toBe('o');
  });

  it('sends only the difference to the document, not the whole text', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    typeText('Faster onboarding');
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });

    typeText('Faster onboarding ideas');

    expect(updates).toBe(1);
    expect(modelText(doc, id)).toBe('Faster onboarding ideas');
  });

  it('keeps the ends of the line when a word in the middle is replaced', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    setNoteText(doc, id, 'ship the importer today');
    openEditor();

    typeText('ship the import plan today');

    expect(modelText(doc, id)).toBe('ship the import plan today');
  });

  it('adds a line on Enter instead of leaving editing', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();

    typeText(RETRO_ITEM);
    pressKeyOn(editorElement(), 'Enter');

    expect(isEditing()).toBe(true);
    expect(modelText(doc, id)).toBe(RETRO_ITEM);
    expect(modelText(doc, id).split('\n')).toHaveLength(3);
  });

  it('keeps an input method composing out of the document until it is finished', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    const el = editorElement()!;

    fireEvent.compositionStart(el);
    fireEvent.input(el, { target: { value: 'か' } });
    // a half-finished word is not the user's text yet
    expect(modelText(doc, id)).toBe('');

    fireEvent.compositionEnd(el, { target: { value: '仮名' } });

    expect(modelText(doc, id)).toBe('仮名');
  });

  it('keeps characters past the limit out of the note and says so', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();

    typeText(PROSE_1200);

    expect(modelText(doc, id)).toBe(PROSE_1000);
    expect(editorElement()?.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(counterElement()?.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('stops accepting characters once the note is full', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    openEditor();
    typeText(PROSE_1000);

    typeText(`${PROSE_1000}more`);

    expect(modelText(doc, id)).toBe(PROSE_1000);
  });

  it('shows the character counter only when the note is nearly full', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    openEditor();

    const nearly = STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS;
    typeText('a'.repeat(nearly - 1));
    expect(counterElement()).toBeNull();

    typeText('a'.repeat(nearly));
    expect(counterElement()?.textContent).toBe(`${nearly}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('starts at the largest font size for a short idea', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    openEditor();

    expect(noteFontPx(0)).toBe(STICKY_FONT_MAX_PX);
  });

  it('shrinks the font and marks the text as not fitting when nothing fits', () => {
    const { doc } = renderBoard();
    const id = newNote(doc, { x: 0, y: 0 });
    // jsdom does no text layout, so the test states how tall the text is
    stubTextHeight(400);
    try {
      setNoteText(doc, id, PROSE_1000);
      flushFrames();

      expect(noteFontPx(0)).toBe(STICKY_FONT_MIN_PX);
      expect(noteOverflows(0)).toBe(true);
      expect(fadeElement(0)).not.toBeNull();
      // all of it is still in the note, hidden rather than thrown away
      expect(textOfNote(0)).toBe(PROSE_1000);
    } finally {
      unstubTextHeight();
    }
  });

  it('puts the note where an off-centre double-click happened', () => {
    const { doc } = renderBoard();
    const camera = readCamera();

    doubleClickBoard(200, 150);

    const expected = {
      x: 200 / camera.zoom + camera.x - 100,
      y: 150 / camera.zoom + camera.y - 100,
    };
    expect(notePosition(0)).toEqual(expected);
    // and it is in the document that would be saved, not only on screen
    expect(snapshot(doc)[0]).toMatchObject(expected);
  });

  it('centres a new note on the point that was double-clicked and opens it for typing', () => {
    renderBoard();
    const size = boardSize();
    const centre = screenCentre();

    // the middle of the screen, which is a point on the board like any other
    doubleClickBoard(size.width / 2, size.height / 2);

    expect(noteCount()).toBe(1);
    expect(notePosition(0)).toEqual({ x: centre.x - 100, y: centre.y - 100 });
    expect(isEditing()).toBe(true);
  });
});

function textOfNote(index: number): string {
  const el = noteAt(index).querySelector<HTMLElement>('[data-testid="sticky-text"]');
  return el?.textContent ?? '';
}
