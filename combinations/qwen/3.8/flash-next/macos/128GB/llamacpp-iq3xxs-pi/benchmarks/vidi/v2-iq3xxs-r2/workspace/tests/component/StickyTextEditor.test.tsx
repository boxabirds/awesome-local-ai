import { act } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { PROSE_1000, PROSE_1200, SHORT_NOTE } from '../fixtures/texts';
import {
  boardDoc,
  boardNotes,
  click,
  counterElement,
  createNote,
  editorElement,
  flushFrames,
  getStickyTextFor,
  noteElement,
  pressKey,
  renderBoard,
  selectNote,
  selectedNoteIds,
  startEditingNote,
  noteToolbarElement,
  typeText,
} from './fixtures/board';

/** Press somewhere that is not the note, so the note loses the edit. */
async function clickOutside(): Promise<void> {
  await click({ x: 200, y: 700 });
}

/**
 * Type into a note from the other side of the board: a transaction that this client did
 * not make, which is how a change from another person arrives.
 */
function remoteType(id: string, at: number, text: string): void {
  const doc = boardDoc();
  const object = doc.getMap('objects').get(id) as Y.Map<unknown> | undefined;
  const ytext = object?.get('text');
  if (!(ytext instanceof Y.Text)) throw new Error(`note ${id} has no text to type into`);
  act(() => {
    doc.transact(() => ytext.insert(at, text));
  });
}

describe('starting and ending a text edit (TC-23, TC-24, TC-38)', () => {
  it('TC-23: Enter opens the editor with the text and the caret at its end', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);

    pressKey('Enter');
    await flushFrames();

    const editor = editorElement();
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(editor?.value).toBe('');
    expect(editor?.selectionStart).toBe(0);
    expect(noteElement(id).dataset.editing).toBe('true');
    // The note toolbar is hidden while its text is being edited.
    expect(noteToolbarElement()).toBeNull();

    typeText('Hello');
    expect(editorElement()?.value).toBe('Hello');

    // Escape keeps the note selected; Enter opens the editor again on the same note.
    pressKey('Escape', editorElement() as HTMLElement);
    await flushFrames();
    expect(editorElement()).toBeNull();
    expect(selectedNoteIds()).toEqual([id]);

    pressKey('Enter');
    await flushFrames();
    const reopened = editorElement();
    expect(reopened?.value).toBe('Hello');
    expect(reopened?.selectionStart).toBe('Hello'.length);
    expect(reopened?.selectionEnd).toBe('Hello'.length);
  });

  it('TC-24: Escape keeps the note selected and preserves what was typed', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    pressKey('Enter');
    await flushFrames();

    typeText('Keep me');
    pressKey('Escape', editorElement() as HTMLElement);
    await flushFrames();

    expect(editorElement()).toBeNull();
    expect(selectedNoteIds()).toEqual([id]);
    expect(getStickyTextFor(id)).toBe('Keep me');
  });

  it('TC-38: clicking outside the note ends the edit, keeps the text and clears the selection', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    typeText('abc');
    await clickOutside();

    expect(editorElement()).toBeNull();
    expect(getStickyTextFor(id)).toBe('abc');
    expect(selectedNoteIds()).toEqual([]);
    expect(noteElement(id).dataset.editing).toBe('false');
  });

  it('keeps the note being edited when the click lands inside it', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);
    typeText('abc');

    // A click in the textarea moves the caret; it does not end the edit.
    pressKey('Escape', editorElement() as HTMLElement);
    await flushFrames();
    await startEditingNote(id);
    expect(editorElement()).not.toBeNull();
    expect(getStickyTextFor(id)).toBe('abc');
  });
});

describe('deleting text instead of the note (TC-26)', () => {
  it('TC-26: Backspace while editing removes a character, not the note', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    typeText('ab');
    const editor = editorElement() as HTMLTextAreaElement;
    pressKey('Backspace', editor);
    await flushFrames();

    // The key reached the textarea, not the "delete the selected note" handler.
    expect(boardNotes()).toHaveLength(1);
    expect(editorElement()).not.toBeNull();

    // What the browser removes after that key is what the model keeps.
    editor.value = 'a';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await flushFrames();

    expect(getStickyTextFor(id)).toBe('a');
    expect(boardNotes()).toHaveLength(1);
    expect(selectedNoteIds()).toEqual([id]);
  });
});

describe('the character limit and counter while typing (TC-14, TC-15, TC-17)', () => {
  it('shows the counter only once 50 or fewer characters remain', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    expect(counterElement()).toBeNull();

    typeText(SHORT_NOTE); // far from the limit
    expect(counterElement()).toBeNull();

    typeText('x'.repeat(STICKY_TEXT_MAX_CHARS - 50 - SHORT_NOTE.length));
    const counter = counterElement();
    expect(counter?.textContent).toBe('950/1000');

    typeText('x');
    expect(counterElement()?.textContent).toBe('951/1000');
  });

  it('keeps the first 1,000 characters of a longer paste and shows 1000/1000', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    typeText(PROSE_1200);
    await flushFrames();

    const editor = editorElement() as HTMLTextAreaElement;
    expect(editor.value).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(editor.value).toBe(PROSE_1200.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(getStickyTextFor(id)).toBe(PROSE_1000);
    expect(counterElement()?.textContent).toBe('1000/1000');
    // Nothing beyond the limit is written, so typing more adds nothing.
    typeText('extra');
    expect(getStickyTextFor(id)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    // jsdom lays nothing out, so the overflow fade (which needs real font metrics, and
    // is asserted in the browser for TC-33) is not reachable here.
  });

  it('writes text through the model so the display updates as it is typed', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    typeText('Faster onboarding');
    await flushFrames();

    expect(getStickyTextFor(id)).toBe('Faster onboarding');
    // The always-rendered text layer holds the same text (it is what gets measured).
    const displayed = document.querySelector<HTMLElement>('[data-testid="sticky-text"]');
    expect(displayed?.textContent).toBe('Faster onboarding');
    // jsdom has no font metrics, so the fit stays at the maximum size.
    expect(displayed?.style.fontSize).toBe('24px');
    expect(editorElement()?.style.fontSize).toBe('24px');
  });
});

describe('two people typing in one note (live.concurrent_text, TC-23)', () => {
  it('a word the other person typed while we were typing survives', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);
    typeText('green');

    remoteType(id, 0, 'red ');
    await flushFrames();
    // The other person's word appears in the textarea this person is typing into...
    expect(editorElement()?.value).toBe('red green');
    // ...and the caret, which was at the end of the note, has stepped over it.
    expect(editorElement()?.selectionStart).toBe('red green'.length);

    // Typing on now cannot un-type what came from the other side: the write is measured
    // against what this textarea held a moment ago, not against the document.
    typeText('!');
    expect(getStickyTextFor(id)).toBe('red green!');
    expect(editorElement()?.value).toBe('red green!');
  });

  it('nothing is lost when both of them keep typing', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);

    for (const [ours, theirs] of [
      ['a', 'z'],
      ['b', 'y'],
      ['c', 'x'],
    ] as const) {
      typeText(ours);
      remoteType(id, 0, theirs);
      await flushFrames();
    }

    const text = getStickyTextFor(id);
    // Six characters were typed across the two of them, and six are there — none lost,
    // none doubled; only their order is the merge's business.
    expect([...text].sort().join('')).toBe('abcxyz');
    expect(editorElement()?.value).toBe(text);
  });

  it('the caret steps over a change in front of it and stays put behind one', async () => {
    await renderBoard();
    const id = createNote({ x: 0, y: 0 });
    await selectNote(id);
    await startEditingNote(id);
    typeText('green');
    const editor = editorElement();
    if (!editor) throw new Error('no editor');
    editor.setSelectionRange(2, 2); // gr|een

    remoteType(id, 5, '!'); // the other person worked behind the caret
    await flushFrames();
    expect(editor.value).toBe('green!');
    expect(editor.selectionStart).toBe(2);

    remoteType(id, 0, 'red '); // and now in front of it
    await flushFrames();
    expect(editor.value).toBe('red green!');
    expect(editor.selectionStart).toBe(6);
  });
});
