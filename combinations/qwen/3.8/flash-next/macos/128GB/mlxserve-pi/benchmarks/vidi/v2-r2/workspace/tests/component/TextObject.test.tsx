// text.object (ui-component): one object's words, box, selection and end.
//
// The rules this file keeps are the ones a person feels: the caret goes in at the
// end of what is already there, Enter writes a line rather than closing the field,
// Escape closes it and leaves the object selected, a text left empty takes its
// object with it, and the box it draws is the box the model stored - including
// which handles it may be resized by, which for words is the two that set a width.

import { describe, expect, it, vi } from 'vitest';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_MAX_CHARS } from '../../src/shared/config';
import { snapshot } from '../../src/shared/board-model';
import { SHORT_PHRASE } from '../fixtures/texts';
import {
  allObjects,
  clickOn,
  countBoxWrites,
  dragHandle,
  doubleClickOn,
  flushFrames,
  handlesShown,
  modelTextOf,
  newNote,
  newText,
  newTextWithText,
  noteAt,
  notePosition,
  pointerOn,
  pressKey,
  pressKeyOn,
  remoteDelete,
  renderBoard,
  selectedTexts,
  selectionBarElement,
  storedBox,
  stubTextHeight,
  textAt,
  textBodyLines,
  textCount,
  textEditorElement,
  textFontPxOf,
  textSizeButton,
  textToolbarDelete,
  textToolbarElement,
  textSizeOf,
  typeIntoText,
  unstubTextHeight,
  useBoardTestLifecycle,
  viewportEl,
} from './helpers';

/** Open the editor of the text at `index`, the way a double-click does. */
function openTextEditor(index = 0): string {
  doubleClickOn(textAt(index));
  return String(textAt(index).dataset.textId);
}

describe('a text object', () => {
  useBoardTestLifecycle();

  // TC-19
  it('TC-19 opens with the caret at the end, gives Enter to the text, and Escape leaves it selected', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);

    clickOn(textAt(0));
    pressKey('Enter');

    const editor = textEditorElement();
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(editor?.selectionStart).toBe(SHORT_PHRASE.length);
    expect(editor?.selectionEnd).toBe(SHORT_PHRASE.length);
    expect(editor?.value).toBe(SHORT_PHRASE);
    // what a screen reader hears, size included because the size is the text
    expect(editor?.getAttribute('aria-label')).toBe('Text, M');
    // a text is not a note: there is no fitting font to report and no character
    // counter crowding words that have room to grow
    expect(document.querySelector('[data-testid="sticky-counter"]')).toBeNull();

    // Enter belongs to the text. The board does not claim the key, so the line the
    // person typing means goes in rather than the field closing.
    const enter = pressKeyOn(textEditorElement(), 'Enter');
    expect(enter.defaultPrevented).toBe(false);
    expect(textEditorElement()).not.toBeNull();

    typeIntoText(`${SHORT_PHRASE}\nand it lands`);
    expect(modelTextOf(doc, id)).toBe(`${SHORT_PHRASE}\nand it lands`);

    pressKeyOn(textEditorElement(), 'Escape');
    expect(textEditorElement()).toBeNull();
    // the words stay, the object stays, and it is still the one selected
    expect(modelTextOf(doc, id)).toBe(`${SHORT_PHRASE}\nand it lands`);
    expect(selectedTexts().map((el) => el.dataset.textId)).toEqual([id]);
  });

  // TC-20
  it('TC-20 leaving a text with nothing in it takes the object with it', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 60, y: 40 });

    clickOn(textAt(0));
    pressKey('Enter');
    expect(textEditorElement()).not.toBeNull();

    pressKeyOn(textEditorElement(), 'Escape');

    expect(textCount()).toBe(0);
    expect(allObjects(doc)).toHaveLength(0);
    expect(storedBox(doc, id)).toBeNull();
    // and the selection let go of an id the board no longer has
    expect(selectedTexts()).toHaveLength(0);
    expect(handlesShown()).toHaveLength(0);
    expect(selectionBarElement()).toBeNull();
  });

  it('TC-20 a text that was created and never typed in is gone once editing ends', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 60, y: 40 });

    clickOn(textAt(0));
    pressKey('Enter');
    expect(textEditorElement()).not.toBeNull();

    // the way a caret leaves when the person clicks somewhere else entirely
    clickOn(viewportEl());
    flushFrames();

    expect(textEditorElement()).toBeNull();
    expect(textCount()).toBe(0);
    expect(storedBox(doc, id)).toBeNull();
    expect(allObjects(doc)).toHaveLength(0);
    // an empty text is not left behind to be selected again by accident
    expect(selectedTexts()).toHaveLength(0);
  });

  // TC-21
  it('TC-21 the text toolbar offers the four sizes with the current one pressed', () => {
    const { doc } = renderBoard();
    newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);

    clickOn(textAt(0));

    expect(textToolbarElement()).not.toBeNull();
    expect(['S', 'M', 'L', 'XL'].map((size) => textSizeButton(size)?.textContent)).toEqual([
      'S',
      'M',
      'L',
      'XL',
    ]);
    expect(textSizeButton('M')?.getAttribute('aria-pressed')).toBe('true');
    expect(textSizeButton('S')?.getAttribute('aria-pressed')).toBe('false');
    expect(textToolbarDelete()).not.toBeNull();
    // the group's toolbar is not up as well: two toolbars would fight over the
    // same corner of the screen, and one text is not a group
    expect(selectionBarElement()).toBeNull();

    clickOn(textSizeButton('XL'));

    const box = storedBox(doc, String(textAt(0).dataset.textId))!;
    expect(box.size).toBe('XL');
    expect(textSizeOf(0)).toBe('XL');
    expect(textFontPxOf(0)).toBe(TEXT_SIZES.XL);
    // the object did not move: a size is not a place
    expect({ x: box.x, y: box.y }).toEqual({ x: 0, y: 0 });
    expect(textSizeButton('XL')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('TC-21 the bin on the text toolbar deletes this text and nothing else', () => {
    const { doc } = renderBoard();
    const note = newNote(doc, { x: 400, y: 400 });
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    clickOn(textAt(0));

    clickOn(textToolbarDelete());

    expect(textCount()).toBe(0);
    expect(storedBox(doc, id)).toBeNull();
    expect(snapshot(doc).map((n) => n.id)).toEqual([note]);
    expect(handlesShown()).toHaveLength(0);
  });

  // TC-22
  it('TC-22 one text selected shows the two handles that set a width', () => {
    const { doc } = renderBoard();
    newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);

    clickOn(textAt(0));

    expect(handlesShown().sort()).toEqual(['e', 'w']);
    // the height of words belongs to the words: there is no height for a top or
    // bottom handle to give them
    expect(handlesShown()).not.toContain('n');
    expect(handlesShown()).not.toContain('s');
    expect(handlesShown()).not.toContain('nw');
  });

  // TC-23
  it('TC-23 a text next to a note is resized from all eight, and keeps its font size', () => {
    stubTextHeight(60);
    const { doc } = renderBoard();
    newNote(doc, { x: 0, y: 0 });
    const id = newTextWithText(doc, { x: 600, y: 600 }, SHORT_PHRASE);

    pressKey('a', { ctrlKey: true });

    expect(handlesShown().sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
    const before = storedBox(doc, id)!;
    const fontBefore = textFontPxOf(0);

    dragHandle('se', 240, 240);

    const after = storedBox(doc, id)!;
    // the group grew from its top-left, so the text moved away from it
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    // a resize never resizes the type: at any zoom, for any type, the size preset
    // is the font size and only the size button changes it
    expect(textFontPxOf(0)).toBe(fontBefore);
    expect(textSizeOf(0)).toBe('M');
    expect(storedBox(doc, id)!.size).toBe('M');
    // the note really did resize too, so this was a group resize and not a move
    expect(parseFloat(noteAt(0).style.width)).toBeGreaterThan(200);
    unstubTextHeight();
  });

  it('TC-23 dragging a text moves the text and nothing else', () => {
    const { doc } = renderBoard();
    newNote(doc, { x: 600, y: 600 });
    const whereTheNoteWas = notePosition(0);
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    const before = storedBox(doc, id)!;

    // press and travel far enough to be a move, then let go
    const el = textAt(0);
    pointerOn(el, 'pointerdown', { clientX: 20, clientY: 20 });
    pointerOn(el, 'pointermove', { clientX: 120, clientY: 90 });
    flushFrames();
    pointerOn(el, 'pointerup', { clientX: 120, clientY: 90 });
    flushFrames();

    const after = storedBox(doc, id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x + 100, y: before.y + 70 });
    // a move writes a place, not a size: the note is where it was, and the text
    // is still the size it was
    expect(notePosition(0)).toEqual(whereTheNoteWas);
    expect(textSizeOf(0)).toBe('M');
    expect(storedBox(doc, id)!.size).toBe('M');
  });

  // TC-24
  it('TC-24 a text deleted elsewhere while the caret is in it closes the editor and stays deleted', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    openTextEditor();
    expect(textEditorElement()).not.toBeNull();

    const errors = vi.spyOn(console, 'error');
    remoteDelete(doc, id);
    flushFrames();

    expect(textCount()).toBe(0);
    expect(textEditorElement()).toBeNull();
    expect(storedBox(doc, id)).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    // nothing is written back: an editor leaving is not a reason to make an object
    expect(allObjects(doc)).toHaveLength(0);
    expect(handlesShown()).toHaveLength(0);
    errors.mockRestore();
  });

  it('TC-24 a text deleted elsewhere mid-keystroke keeps the words that arrived', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 0, y: 0 });
    openTextEditor();

    typeIntoText('typed here');
    expect(modelTextOf(doc, id)).toBe('typed here');

    remoteDelete(doc, id);
    flushFrames();

    expect(textCount()).toBe(0);
    expect(allObjects(doc)).toHaveLength(0);
  });

  // TC-25
  it('TC-25 one undo reverses the typing and the box together', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 0, y: 0 });
    const created = storedBox(doc, id)!;
    openTextEditor();

    typeIntoText(SHORT_PHRASE);
    const typed = storedBox(doc, id)!;
    expect(typed.width).not.toBe(created.width);

    pressKeyOn(window, 'z', { ctrlKey: true });

    // one step, both halves: no empty object with a grown box, no words with the
    // box they had not grown into
    expect(modelTextOf(doc, id)).toBe('');
    expect(storedBox(doc, id)).toEqual(created);

    // and it comes back the same single step
    pressKeyOn(window, 'z', { ctrlKey: true, shiftKey: true });
    expect(modelTextOf(doc, id)).toBe(SHORT_PHRASE);
    expect(storedBox(doc, id)).toEqual(typed);
  });

  it('TC-25 the box grows with the words as they are typed', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 0, y: 0 });

    openTextEditor();
    const writes = countBoxWrites(doc, id, () => {
      typeIntoText(SHORT_PHRASE);
    });

    expect(writes).toBe(1);
    const box = storedBox(doc, id)!;
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBe(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(textWidthModeOfTheObject()).toBe('auto');
  });

  it('renders the lines the document holds, an empty one included', () => {
    const { doc } = renderBoard();
    const id = newTextWithText(doc, { x: 0, y: 0 }, 'a\n\nb');
    flushFrames();

    expect(textBodyLines(0)).toEqual(['a', '', 'b']);
    // the object is as tall as the lines are, which is what the model stored
    expect(storedBox(doc, id)).not.toBeNull();
    expect(textAt(0).getAttribute('role')).toBe('group');
  });

  it('opens its own editor on a double-click instead of making another object', () => {
    const { doc } = renderBoard();
    newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);

    doubleClickOn(textAt(0));

    expect(textCount()).toBe(1);
    expect(textEditorElement()).not.toBeNull();
    expect(document.activeElement).toBe(textEditorElement());
  });

  it('gives the character limit to the text, not to the object', () => {
    const { doc } = renderBoard();
    const id = newText(doc, { x: 0, y: 0 });
    openTextEditor();

    const long = 'x'.repeat(TEXT_MAX_CHARS + 200);
    typeIntoText(long);

    expect(modelTextOf(doc, id).length).toBe(TEXT_MAX_CHARS);
    expect(textEditorElement()?.value.length).toBe(TEXT_MAX_CHARS);
  });

  it('keeps the caret in the field when the object is only selected again', () => {
    const { doc } = renderBoard();
    newTextWithText(doc, { x: 0, y: 0 }, SHORT_PHRASE);
    openTextEditor();

    // a click on the text itself is not a reason to lose the caret
    pointerOn(textAt(0), 'pointerdown', { clientX: 10, clientY: 10 });
    pointerOn(textAt(0), 'pointerup', { clientX: 10, clientY: 10 });
    flushFrames();

    expect(textEditorElement()).not.toBeNull();
    expect(modelTextOf(doc, String(textAt(0).dataset.textId))).toBe(SHORT_PHRASE);
  });
});

function textWidthModeOfTheObject(): string {
  return String(textAt(0).dataset.widthMode);
}
