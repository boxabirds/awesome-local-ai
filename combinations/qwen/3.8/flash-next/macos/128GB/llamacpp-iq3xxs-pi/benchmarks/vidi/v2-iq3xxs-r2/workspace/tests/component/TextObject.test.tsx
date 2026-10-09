/**
 * Story 9, task 9: the text object (TC-19 to TC-25).
 *
 * A text object is an object: it is selected, moved, resized and deleted like everything else,
 * and the tests here say so by going through the same helpers the sticky note tests use. What
 * is theirs alone is the editor (caret, newlines, the empty one that removes itself), the fact
 * that its box is measured from its content, and that its height is never dragged.
 */
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { TEXT_LINE_HEIGHT, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';
import {
  boardNotes,
  createNote,
  flushFrames,
  pressKey,
  renderBoard,
  stickyToolbarButton,
  waitForNotes,
} from './fixtures/board';
import {
  clickObject,
  deleteSelectionButton,
  dragHandle,
  handleElements,
  objectRect,
  pressBoardKey,
  remoteDelete,
  selectionBarElement,
  selectionCountText,
  shiftClickObject,
  waitForSelected,
} from './fixtures/selection';
import {
  SIZE_BUTTON_KEYS,
  createTextWithTool,
  finishEditing,
  pressedSizeButtons,
  seedText,
  sizeButton,
  textElement,
  textEditorElement,
  textIdsInDoc,
  textInDoc,
  textToolbarSizeButtons,
  typeIntoTextEditor,
  waitForObjects,
} from './fixtures/text';

/** Long enough to wrap at the comfortable width, so narrowing the box adds lines. */
const LONG_SENTENCE = 'the quick brown fox jumps over the lazy dog '.repeat(10);

describe('editing a text object (TC-19)', () => {
  it('TC-19: the caret starts after the existing text, Enter makes a line, Escape leaves the text selected', async () => {
    await renderBoard();
    const id = await seedText({ x: -440, y: 200 }, 'Status');

    // Double-click the object: the same way a note opens its editor.
    act(() => {
      textElement(id).dispatchEvent(
        new MouseEvent('dblclick', { bubbles: true, cancelable: true }),
      );
    });
    await flushFrames();

    const editor = textEditorElement();
    expect(document.activeElement).toBe(editor);
    // The caret is at the end of the text, not in front of it: typing appends.
    expect(editor.value).toBe('Status');
    expect(editor.selectionStart).toBe(6);
    expect(editor.selectionEnd).toBe(6);

    // Enter is a line of the text, not "finished with the editor": the board keeps out of it,
    // and the object is still being edited.
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      editor.dispatchEvent(enter);
    });
    await flushFrames();
    expect(enter.defaultPrevented).toBe(false);
    expect(textElement(id).dataset.editing).toBe('true');

    // What the browser then puts in the textarea, the shared text takes too.
    typeIntoTextEditor('\ndone');
    await flushFrames();
    expect(textInDoc(id).text).toBe('Status\ndone');
    // Two lines, so the stored box is taller than the one it was measured for.
    const oneLine = Math.round(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
    expect(textInDoc(id).height).toBeGreaterThan(oneLine + 1);
    expect(Number(textElement(id).dataset.noteHeight)).toBe(textInDoc(id).height);
    expect(textElement(id).dataset.noteHeight).not.toBe(String(oneLine));

    // Escape: the editor is gone and the object is still the selected thing.
    await finishEditing();
    expect(textElement(id).dataset.editing).toBe('false');
    await waitForSelected([id]);
    expect(textInDoc(id).text).toBe('Status\ndone');
    // And it is a selected text, so the size buttons are there to be found.
    expect(sizeButton('M').getAttribute('aria-pressed')).toBe('true');
  });

  it('the editor is a textarea with a name of its own', async () => {
    await renderBoard();
    await createTextWithTool();
    const editor = textEditorElement();
    expect(editor.tagName).toBe('TEXTAREA');
    expect(editor.getAttribute('aria-label')).toBe('Text');
    // It is the same editor a sticky note types into, so the same limit applies, and the same
    // place enforces it: the shared text, not the widget (`TEXT_MAX_CHARS`).
    expect(TEXT_MAX_CHARS).toBe(5_000);
  });
});

describe('a text with nothing in it (TC-20)', () => {
  it('TC-20: Escape before anything is typed removes the object and clears the selection', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    await waitForSelected([id]);
    expect(textInDoc(id).text).toBe('');

    await finishEditing();

    // Gone from the document and the screen: no empty object, no stray shared text.
    expect(textIdsInDoc()).toEqual([]);
    await waitForObjects(0);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
    // Nothing is selected, so the selection bar is not showing either: no sizes, no delete.
    expect(selectionBarElement()).toBeNull();
    expect(document.querySelector('[data-testid="text-sizes"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Delete selection"]')).toBeNull();
  });

  it('a text of one space is a text with something in it, and stays', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    typeIntoTextEditor(' ');
    await finishEditing();
    expect(textIdsInDoc()).toEqual([id]);
    expect(textInDoc(id).text).toBe(' ');
  });

  it('a text rubbed out to nothing is removed with it (PRD: empty text)', async () => {
    await renderBoard();
    const id = await seedText({ x: -440, y: 200 }, 'Keep me');

    act(() => {
      textElement(id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await flushFrames();
    const editor = textEditorElement();
    act(() => {
      editor.value = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushFrames();
    // Still there while the caret is in it, empty as it is: the rule is about ending.
    expect(textIdsInDoc()).toEqual([id]);

    await finishEditing();

    expect(textIdsInDoc()).toEqual([]);
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
  });
});

describe('the size buttons (TC-21)', () => {
  it('TC-21: S/M/L/XL with M pressed; picking XL makes it XL and moves nothing', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    typeIntoTextEditor('Went well');
    await finishEditing();
    await waitForSelected([id]);

    const buttons = textToolbarSizeButtons();
    expect(buttons.map((button) => button.dataset.size)).toEqual([...SIZE_BUTTON_KEYS]);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Small text',
      'Medium text',
      'Large text',
      'Extra large text',
    ]);
    expect(pressedSizeButtons()).toEqual(['M']);
    const before = textInDoc(id);

    act(() => {
      sizeButton('XL').click();
    });
    await flushFrames();

    const after = textInDoc(id);
    expect(after.size).toBe('XL');
    expect(pressedSizeButtons()).toEqual(['XL']);
    // The text stays exactly where it was, and gets taller and wider at the same time.
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBeGreaterThanOrEqual(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(TEXT_SIZES.XL).toBeGreaterThan(TEXT_SIZES.M);
    // The board drew the bigger size, and the toolbar is still offering it.
    expect(textElement(id).dataset.textSize).toBe('XL');
    expect(textElement(id).style.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    // Still the one selected object.
    await waitForSelected([id]);
  });

  it('the size buttons sit in the selection bar, with the same delete as any selection', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    typeIntoTextEditor('Heading');
    await finishEditing();
    await waitForSelected([id]);

    const bar = selectionBarElement() as HTMLElement;
    expect(bar.getAttribute('aria-label')).toBe('Selection');
    // No count for one object: the sizes are the useful thing to show.
    expect(selectionCountText()).toBeNull();
    expect(deleteSelectionButton().getAttribute('aria-label')).toBe('Delete selection');

    act(() => {
      deleteSelectionButton().click();
    });
    await flushFrames();
    expect(textIdsInDoc()).toEqual([]);
    expect(selectionBarElement()).toBeNull();
  });
});

describe('the handles of a text object (TC-22, TC-23)', () => {
  it('TC-22: one text selected gets an east and a west handle and nothing else', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    typeIntoTextEditor('Widen me');
    await finishEditing();
    await waitForSelected([id]);

    const handles = handleElements().map((element) => element.dataset.handle);
    expect(handles).toEqual(['e', 'w']);
  });

  it('the east handle pins the width the drag reached, and the height follows the text', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    // Long enough that its lines wrap at the comfortable width, so narrowing it adds lines.
    typeIntoTextEditor(LONG_SENTENCE);
    await finishEditing();
    await waitForSelected([id]);
    const before = textInDoc(id);
    expect(before.widthMode).toBe('auto');
    expect(before.width).toBeLessThanOrEqual(600); // the comfortable line length, in world units

    await dragHandle('e', { x: -120, y: 0 });

    const after = textInDoc(id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    expect(after.x).toBe(before.x); // the width a text wraps at belongs to its top-left
    // Narrower box, more lines: the height is the text's business.
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.size).toBe(before.size);
    expect(after.text).toBe(before.text);
  });

  it('TC-23: a text and a note together get every handle, and resizing moves both', async () => {
    await renderBoard();
    const text = await seedText({ x: -440, y: 200 }, 'Note to self');
    const note = createNote({ x: -100, y: 200 });
    await waitForNotes(1);

    await clickObject(text);
    await shiftClickObject(note);
    await waitForSelected([note, text]);

    const handles = handleElements().map((element) => element.dataset.handle);
    expect(handles).toHaveLength(8);

    const textBefore = textInDoc(text);
    const noteBefore = objectRect(note);
    // The far corner from the text: the box grows up and left, and everything in it moves away
    // from the anchor by the same factor.
    await dragHandle('nw', { x: -100, y: -60 });

    const textAfter = textInDoc(text);
    const noteAfter = objectRect(note);
    // Both objects moved up and left, and grew: the same box resize a note gets.
    expect(textAfter.x).toBeLessThan(textBefore.x);
    expect(textAfter.y).toBeLessThan(textBefore.y);
    expect(textAfter.width).toBeGreaterThan(textBefore.width);
    expect(noteAfter.x).toBeLessThan(noteBefore.x);
    expect(noteAfter.y).toBeLessThan(noteBefore.y);
    // The font size never changed — only the box did.
    expect(textAfter.size).toBe(textBefore.size);
    expect(textAfter.text).toBe(textBefore.text);
  });
});

describe('a text object deleted elsewhere while it is being edited (TC-24)', () => {
  it('TC-24: the editor closes, nothing is recreated, and the selection is cleared', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    typeIntoTextEditor('Half an idea');

    await remoteDelete(id);
    await flushFrames();

    // The editor and the object both went, and no error was thrown on the way out.
    expect(document.querySelector('[data-testid="text-editor"]')).toBeNull();
    expect(document.querySelector(`[data-note-id="${id}"]`)).toBeNull();
    expect(textIdsInDoc()).toEqual([]);
    expect(selectionBarElement()).toBeNull();

    // And the board does not bring it back: no stray keypress, no shared text left behind.
    pressKey('Escape');
    await flushFrames();
    expect(textIdsInDoc()).toEqual([]);
    await waitForObjects(0);
  });
});

describe('undo and a text object (TC-25)', () => {
  it('TC-25: one Ctrl+Z takes the typing and the box it needed back together', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    const created = textInDoc(id);
    expect(created.text).toBe('');
    const createdBox = { width: created.width, height: created.height };

    typeIntoTextEditor('a heading worth typing');
    await flushFrames();
    const typed = textInDoc(id);
    expect(typed.text).toBe('a heading worth typing');
    expect(typed.width).toBeGreaterThan(createdBox.width);

    await finishEditing();

    await pressBoardKey('z', { ctrl: true });
    await flushFrames();

    const after = textInDoc(id);
    expect(after.text).toBe('');
    // Not "text reverted, box still wide": one step, both of them.
    expect(after.width).toBeCloseTo(createdBox.width, 6);
    expect(after.height).toBeCloseTo(createdBox.height, 6);
    expect(textIdsInDoc()).toEqual([id]);
  });

  it('redo brings the text and its box back', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    const createdBox = { width: textInDoc(id).width, height: textInDoc(id).height };
    typeIntoTextEditor('redo me');
    await finishEditing();
    const typedBox = { width: textInDoc(id).width, height: textInDoc(id).height };

    await pressBoardKey('z', { ctrl: true });
    await flushFrames();
    await pressBoardKey('z', { ctrl: true, shift: true });
    await flushFrames();

    expect(textInDoc(id).text).toBe('redo me');
    expect(textInDoc(id).width).toBeCloseTo(typedBox.width, 6);
    expect(textInDoc(id).height).toBeCloseTo(typedBox.height, 6);
    expect(textInDoc(id).width).toBeGreaterThan(createdBox.width);
  });
});

describe('a text object among the other objects', () => {
  it('a text object is in the document as an object, and knows who made it', async () => {
    await renderBoard();
    const id = await createTextWithTool();
    const text = textInDoc(id);
    expect(text.type).toBe('text');
    expect(text.known).toBe(true);
    expect(text.z).toBe(1);
    expect(text.createdBy).toMatch(/^[0-9a-f-]{36}$/); // this tab's local identity (story 6 waits)
  });

  it('select-all takes a text and a note together, and Delete deletes both', async () => {
    await renderBoard();
    const text = await seedText({ x: -440, y: 200 }, 'both');
    const note = createNote({ x: 0, y: 0 });
    await waitForNotes(1);

    expect(await pressBoardKey('a', { ctrl: true })).toBe(true);
    await waitForSelected([note, text]);
    expect(selectionCountText()).toBe('2 selected');

    await pressBoardKey('Delete');
    await flushFrames();
    expect(textIdsInDoc()).toEqual([]);
    expect(boardNotes()).toEqual([]);
  });

  it('double-clicking the board on top of a text object opens it, not a note', async () => {
    await renderBoard();
    const id = await seedText({ x: -440, y: 200 }, 'double');
    act(() => {
      textElement(id).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await flushFrames();
    expect(textElement(id).dataset.editing).toBe('true');
    await waitForNotes(0);
    expect(stickyToolbarButton().disabled).toBe(false);
  });

  it('double-clicking the board with the Text tool up creates no note', async () => {
    await renderBoard();
    await pressKey('t');
    await flushFrames();
    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="viewport"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: 700, clientY: 640 }));
    });
    await flushFrames();
    await waitForNotes(0);
    expect(textIdsInDoc()).toEqual([]);
  });
});
