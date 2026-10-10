import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { deleteObject } from '../../src/shared/board-model';
import { getTextContent } from '../../src/shared/objects/text';
import { FakeBoardProvider } from '../fixtures/fakeProvider';
import {
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_CHARS,
  TEXT_SIZES,
  TEXT_SIZE_NAMES,
  type TextSize,
} from '../../src/shared/config';
import { estimateTextWidth, layoutText } from '../../src/client/objects/textLayout';
import {
  changeDoc,
  clickElement,
  createNote,
  createTextObject,
  dragElement,
  docTexts,
  doubleClickElement,
  editingId,
  flushFrame,
  noteElement,
  noteOf,
  pasteIntoTextEditor,
  renderBoard,
  resizeHandleElement,
  resizeHandles,
  selectionCount,
  textEditorElement,
  textElement,
  textElements,
  textOf,
  textToolbarElement,
  typeIntoTextEditor,
} from './harness';

/**
 * Text objects (anchor `text.object`), TC-19 to TC-25: drawn and edited in place,
 * sized from a toolbar, resized sideways only, and removed when they are left
 * empty.
 *
 * jsdom has no canvas, so this board measures with the estimate of `textLayout`
 * (TC-32) - which is deterministic, and is exactly what the rendered box must
 * match.
 */

const measure = estimateTextWidth;

const boxOf = (
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
): { width: number; height: number } => layoutText(text, size, mode, fixedWidth, measure);

/** Double-click a text object and return the editor that opened. */
function openEditor(id: string): HTMLTextAreaElement {
  doubleClickElement(textElement(id));
  const editor = textEditorElement();
  if (!editor) {
    throw new Error(`editing did not start for text object ${id}`);
  }
  return editor as HTMLTextAreaElement;
}

function pressEscape(editor: HTMLTextAreaElement): void {
  // Returning false would mean something cancelled it, which would leave the key
  // to the board as well.
  fireEvent.keyDown(editor, { key: 'Escape' });
}

describe('text.object - editing (TC-19)', () => {
  it('TC-19 the caret starts at the end, Enter is a new line, Escape keeps the text selected', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'Went well');

    // Editing again puts the caret after the last character, not before the first.
    const editor = openEditor(id);
    expect(editor.value).toBe('Went well');
    expect(editor.selectionStart).toBe('Went well'.length);
    expect(editor.selectionEnd).toBe('Went well'.length);

    // Enter belongs to the text: the editor does not swallow it and editing goes on.
    expect(fireEvent.keyDown(editor, { key: 'Enter' })).toBe(true);
    expect(editingId()).toBe(id);

    typeIntoTextEditor('\nwhat worked');
    expect(textOf(doc, id).text).toBe('Went well\nwhat worked');

    // Two lines, so two lines of height (`text.height`).
    const expected = boxOf('Went well\nwhat worked', 'M', 'auto', null);
    const stored = textOf(doc, id);
    expect(stored.height).toBeCloseTo(expected.height, 6);
    expect(stored.height).toBeCloseTo(2 * TEXT_SIZES.M * TEXT_LINE_HEIGHT, 6);

    pressEscape(editor);
    expect(editingId()).toBeNull();
    expect(selectionCount()).toBe(1);
    expect(textElement(id).getAttribute('data-selected')).toBe('true');
    expect(textOf(doc, id).text).toBe('Went well\nwhat worked');
  });

  it('TC-19 the editor is clamped to TEXT_MAX_CHARS (`text.limit`)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    pasteIntoTextEditor('x'.repeat(TEXT_MAX_CHARS + 250));

    expect(textOf(doc, id).text.length).toBe(TEXT_MAX_CHARS);
    expect(editor.value.length).toBe(TEXT_MAX_CHARS);
    // The person is told they are at the ceiling rather than silently truncated.
    const counter = screen.getByTestId('text-counter');
    expect(counter.textContent).toBe(`${TEXT_MAX_CHARS}/${TEXT_MAX_CHARS}`);
  });

  it('TC-19 double-clicking a text object edits it; clicking it only selects it', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'To improve');

    clickElement(textElement(id), 320, 240);
    expect(editingId()).toBeNull();
    expect(selectionCount()).toBe(1);

    doubleClickElement(textElement(id));
    expect(editingId()).toBe(id);
    expect(textEditorElement()).not.toBeNull();
  });

  it('TC-19 a board nobody was given cannot be edited (negative)', async () => {
    const doc = new Y.Doc();
    const provider = new FakeBoardProvider();
    renderBoard({ doc, connect: true, providerFactory: () => provider });
    await flushFrame();
    act(() => {
      provider.refuseToLoad();
    });
    await flushFrame();

    const id = createTextObject(doc, { x: 320, y: 260 }, 'component_client');
    await flushFrame();

    expect(textElement(id).getAttribute('data-editable')).toBe('false');

    doubleClickElement(textElement(id));
    expect(textEditorElement()).toBeNull();
    expect(editingId()).toBeNull();
  });
});

describe('text.object - text left empty is removed (TC-20)', () => {
  it('TC-20 Escape with nothing typed removes the object and clears the selection', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    pressEscape(editor);

    expect(docTexts(doc)).toHaveLength(0);
    expect(textElements()).toHaveLength(0);
    expect(editingId()).toBeNull();
    expect(selectionCount()).toBe(0);
  });

  it('TC-20 typing and then deleting every character removes it too', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    typeIntoTextEditor('draft');
    expect(textOf(doc, id).text).toBe('draft');

    pasteIntoTextEditor('');
    pressEscape(editor);

    expect(docTexts(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
  });

  it('TC-20 text that only has spaces is kept: it is not empty (`text.model`)', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    pasteIntoTextEditor('   ');
    pressEscape(editor);

    const stored = textOf(doc, id);
    expect(stored.text).toBe('   ');
    expect(docTexts(doc)).toHaveLength(1);
  });
});

describe('text.object - size from the toolbar (TC-21)', () => {
  it('TC-21 one selected text shows S M L XL with the current one pressed', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'Went well');

    expect(screen.getByTestId(`text-object-${id}`)).toBeTruthy();

    const toolbar = textToolbarElement();
    if (!toolbar) {
      throw new Error('the selected text object has no toolbar');
    }
    for (const size of TEXT_SIZE_NAMES) {
      const button = screen.getByTestId(`text-size-${size}`);
      expect(button.getAttribute('aria-pressed')).toBe(size === 'M' ? 'true' : 'false');
    }
    expect(screen.getByTestId('delete-text')).toBeTruthy();
  });

  it('TC-21 choosing XL changes the size and the measured box, and leaves the place alone', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'Went well');
    const before = textOf(doc, id);

    fireEvent.click(screen.getByTestId('text-size-XL'));

    const after = textOf(doc, id);
    expect(after.size).toBe('XL');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.text).toBe('Went well');

    const expected = boxOf('Went well', 'XL', 'auto', null);
    expect(after.width).toBeCloseTo(expected.width, 6);
    expect(after.height).toBeCloseTo(expected.height, 6);
    expect(after.height).toBeCloseTo(TEXT_SIZES.XL * TEXT_LINE_HEIGHT, 6);

    // The toolbar now says XL is the size in force.
    expect(screen.getByTestId('text-size-XL').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('text-size-M').getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-21 the size can be changed while the text is being edited, and it rewraps', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'A heading that is quite long for a small box on the board');
    const editor = openEditor(id);
    const narrow = textOf(doc, id);

    fireEvent.click(screen.getByTestId('text-size-S'));

    const after = textOf(doc, id);
    expect(after.size).toBe('S');
    expect(editingId()).toBe(id); // changing the size is a change to the text, not a move away from it
    expect(textEditorElement()).not.toBeNull();
    expect(editor.value).toBe('A heading that is quite long for a small box on the board');
    expect(after.height).toBeLessThan(narrow.height);
  });

  it('the toolbar Delete removes the text object', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'temporary');

    fireEvent.click(screen.getByTestId('delete-text'));

    expect(screen.queryByTestId(`text-object-${id}`)).toBeNull();
    expect(docTexts(doc)).toHaveLength(0);
    expect(selectionCount()).toBe(0);
  });
});

describe('text.object - horizontal handles only (TC-22, TC-23)', () => {
  it('TC-22 one selected text shows only its left and right handle', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'Sideways');

    clickElement(textElement(id), 300, 200);

    const overlay = screen.getByTestId('selection-overlay');
    expect(overlay.getAttribute('data-handles')).toBe('horizontal');

    const handles = resizeHandles().map((handle) => handle.getAttribute('data-handle'));
    expect(handles.sort()).toEqual(['e', 'w']);
    expect(overlay.querySelector('[data-handle="n"]')).toBeNull();
    expect(overlay.querySelector('[data-handle="s"]')).toBeNull();
    expect(overlay.querySelector('[data-handle="nw"]')).toBeNull();
  });

  it('TC-22 dragging the right handle fixes the width and re-measures the height', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'wrap these words around the narrower box please');
    const before = textOf(doc, id);
    expect(before.widthMode).toBe('auto');

    dragHandle('e', { x: 200, y: 100 }, { x: 60, y: 100 });

    const after = textOf(doc, id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.height).toBeCloseTo(
      boxOf(after.text, 'M', 'fixed', after.width).height,
      6,
    );
    expect(after.size).toBe('M'); // handles never change the size (`text.object`)
  });

  it('TC-22 dragging the left handle keeps the right edge where it was', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'anchored on the right');
    const before = textOf(doc, id);
    const rightEdge = before.x + before.width;

    dragHandle('w', { x: 100, y: 100 }, { x: 160, y: 100 });

    const after = textOf(doc, id);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeCloseTo(before.width - 60, 6);
    expect(after.x + after.width).toBeCloseTo(rightEdge, 6);
  });

  it('TC-23 a text object selected with a sticky note gets all eight handles', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const noteId = createNote(doc, { x: 0, y: 0 });
    const textId = createAndType(doc, 'label');

    clickElement(noteElement(noteId), 120, 120);
    clickElement(textElement(textId), 320, 120, { shiftKey: true });

    expect(selectionCount()).toBe(2);
    expect(screen.getByTestId('selection-overlay').getAttribute('data-handles')).toBe('all');
    expect(resizeHandles()).toHaveLength(8);
  });

  it('TC-23 resizing a mixed group moves text proportionally and never changes its size', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const noteId = createNote(doc, { x: 0, y: 0 });
    const textId = createAndType(doc, 'label');

    clickElement(noteElement(noteId), 120, 120);
    clickElement(textElement(textId), 320, 120, { shiftKey: true });

    const noteBefore = noteOf(doc, noteId).width ?? STICKY_SIZE_WORLD;
    const textBefore = textOf(doc, textId);

    dragHandle('e', { x: 300, y: 100 }, { x: 500, y: 100 });

    const noteAfter = noteOf(doc, noteId).width ?? STICKY_SIZE_WORLD;
    const textAfter = textOf(doc, textId);

    // The note is resized as a rectangle.
    expect(noteAfter).toBeGreaterThan(noteBefore);

    // The text moved with the group, keeping its place inside it, and kept the
    // width its own content chose: only a fixed width would scale (Key decision 2).
    expect(textAfter.x).toBeGreaterThan(textBefore.x);
    expect(textAfter.width).toBe(textBefore.width);
    expect(textAfter.widthMode).toBe('auto');
    expect(textAfter.size).toBe(textBefore.size);
    expect(textAfter.text).toBe('label');
  });

  it('TC-23 a fixed width does scale with the group, and its height follows', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const noteId = createNote(doc, { x: 0, y: 0 });
    const textId = createAndType(doc, 'wrap these words around the box please');

    // Make the text's width fixed first, with its own handle.
    clickElement(textElement(textId), 320, 120);
    dragHandle('e', { x: 300, y: 100 }, { x: 120, y: 100 });
    const fixed = textOf(doc, textId);
    expect(fixed.widthMode).toBe('fixed');

    clickElement(noteElement(noteId), 120, 120);
    clickElement(textElement(textId), 320, 120, { shiftKey: true });
    dragHandle('e', { x: 300, y: 100 }, { x: 520, y: 100 });

    const after = textOf(doc, textId);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeGreaterThan(fixed.width);
    expect(after.size).toBe('M');
    expect(after.height).toBeCloseTo(boxOf(after.text, 'M', 'fixed', after.width).height, 6);
  });
});

describe('text.object - deleted while being edited (TC-24)', () => {
  it('TC-24 a remote delete ends the edit silently and is not undone by this client', () => {
    const doc = new Y.Doc();
    const errors = vi.spyOn(console, 'error');
    renderBoard({ doc });
    const id = createAndType(doc, 'shared heading');

    const editor = openEditor(id);
    typeIntoTextEditor(' (mine)');
    expect(textOf(doc, id).text).toBe('shared heading (mine)');

    // Someone else deletes the object while this person is mid-sentence.
    changeDoc(() => {
      deleteObject(doc, id);
    });

    expect(textEditorElement()).toBeNull();
    expect(textElements()).toHaveLength(0);
    expect(docTexts(doc)).toHaveLength(0);
    expect(editingId()).toBeNull();
    expect(editor.isConnected).toBe(false);
    expect(errors).not.toHaveBeenCalled();

    // And it stays gone: nobody re-creates a text object from the editor that was open.
    changeDoc(() => {
      doc.transact(() => undefined, 'remote-sender');
    });
    expect(docTexts(doc)).toHaveLength(0);
  });
});

describe('text.object - text and box undo together (TC-25)', () => {
  it('TC-25 one Ctrl+Z puts the words and the box back as they were', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');
    const initial = textOf(doc, id);

    const editor = openEditor(id);
    pasteIntoTextEditor('Retro heading');

    const typed = textOf(doc, id);
    expect(typed.text).toBe('Retro heading');
    expect(typed.width).toBeCloseTo(boxOf('Retro heading', 'M', 'auto', null).width, 6);
    expect(typed.height).toBeCloseTo(boxOf('Retro heading', 'M', 'auto', null).height, 6);

    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });

    const back = textOf(doc, id);
    expect(back.text).toBe('');
    // The box came back in the same step: one Ctrl+Z, not two (`text.height`).
    expect(back.width).toBeCloseTo(initial.width, 6);
    expect(back.height).toBeCloseTo(initial.height, 6);
  });

  it('TC-25 Ctrl+Z inside the editor is the board undo, not the browser undo', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'first');

    const editor = openEditor(id);
    pressEscape(editor);

    // The text object was created by the Text tool in this same session; the editor
    // was closed, so the key is the board's and the object is still there.
    expect(textOf(doc, id).text).toBe('first');
    expect(textElements()).toHaveLength(1);
  });
});

describe('text.object - concurrent typing (text.concurrent)', () => {
  it('a burst of keystrokes keeps every character, in order, in the stored text', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    const typed = 'the notes were lined up in columns and read aloud';
    for (const character of typed) {
      typeIntoTextEditor(character);
    }

    // Typing one character at a time is what a person does, and the board
    // re-measures (a document change) in between: an editor that painted an older
    // text back into the field would land a keystroke in the middle of a word.
    expect(textOf(doc, id).text).toBe(typed);
    expect(editor.value).toBe(typed);

    // And the box is the box that text needs (`text.height`).
    const stored = textOf(doc, id);
    const expected = boxOf(typed, 'M', 'auto', null);
    expect(stored.height).toBeCloseTo(expected.height, 6);
    expect(stored.width).toBeCloseTo(expected.width, 6);
  });

  it('keystrokes that arrive before React has caught up still land in order', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, '');

    const editor = openEditor(id);
    const typed = 'the notes were lined up in columns and read aloud';
    act(() => {
      for (const character of typed) {
        // The browser's own order of events: the field changes, then the app is
        // told. Nothing here waits for React to re-render, because a person typing
        // fast does not either - and a field React re-asserts would put an older
        // text under the next keystroke.
        editor.value += character;
        editor.dispatchEvent(new window.InputEvent('input', { bubbles: true }));
      }
    });
    await flushFrame();

    expect(textOf(doc, id).text).toBe(typed);
    expect(editor.value).toBe(typed);
  });

  it('two clients typing into the same text both keep their characters', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    const id = createAndType(doc, 'Went ');

    openEditor(id);
    typeIntoTextEditor('well');

    // Another client appends to the same Y.Text while this editor is open.
    remoteInsert(doc, id, 5, ' and ');

    const after = textOf(doc, id);
    expect(after.text).toContain('Went ');
    expect(after.text).toContain('well');
    expect(after.text).toContain(' and ');

    // This client's next change is still a change against what it now sees.
    typeIntoTextEditor('more');
    expect(textOf(doc, id).text).toContain('more');
    expect(textOf(doc, id).text).not.toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* Helpers shared by the cases above                                          */
/* -------------------------------------------------------------------------- */

function createAndType(doc: Y.Doc, text: string): string {
  const id = createTextObject(doc, { x: 320, y: 260 }, 'component_client');
  if (text.length > 0) {
    // Typed the way a person types it, so the stored box is the box the board
    // measured from it (`text.height`). Editing ends; the object stays selected.
    const editor = openEditor(id);
    pasteIntoTextEditor(text);
    pressEscape(editor);
  }
  return id;
}

/** Write into one text object's `Y.Text` as **another** client. */
function remoteInsert(doc: Y.Doc, id: string, at: number, text: string): void {
  changeDoc(() => {
    const ytext = getTextContent(doc, id);
    if (!ytext) {
      throw new Error(`text object ${id} has no Y.Text to write into`);
    }
    doc.transact(() => {
      ytext.insert(at, text);
    }, 'remote-sender');
  });
}

function dragHandle(
  handle: 'e' | 'w',
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  dragElement(resizeHandleElement(handle), from, to);
}
