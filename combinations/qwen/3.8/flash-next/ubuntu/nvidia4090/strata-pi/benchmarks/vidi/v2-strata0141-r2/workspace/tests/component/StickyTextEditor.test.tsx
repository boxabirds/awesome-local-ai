import { describe, expect, it } from 'vitest';
import { STICKY_COUNTER_THRESHOLD_CHARS, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { getStickyText } from '../../src/shared/board-model';
import type { AppHarnessResult } from './appHarness';
import {
  addNote,
  doubleClick,
  key,
  mutate,
  press,
  release,
  renderApp,
  typeText,
} from './appHarness';
import { LONG_NOTE_TEXT, OVER_LIMIT_NOTE_TEXT, RETRO_NOTE_TEXT } from '../fixtures/texts';

/**
 * sticky.text component tests (TC-23, TC-24, TC-26, TC-38) plus the editor-side
 * limit and counter behaviour, all against a real Y.Doc.
 */

async function noteWithText(h: AppHarnessResult, text: string): Promise<string> {
  const id = await addNote(h.doc, 0, 0);
  await mutate(() => {
    getStickyText(h.doc, id)?.insert(0, text);
  });
  return id;
}

async function edit(h: AppHarnessResult, id: string): Promise<HTMLTextAreaElement> {
  const note = h.note(id);
  await doubleClick(note, { x: 300, y: 300 });
  const area = h.textarea(note);
  if (!area) {
    throw new Error('double-click did not open the editor');
  }
  return area;
}

describe('sticky note text editing', () => {
  // TC-23
  it('TC-23: Enter on the selected note opens the editor with the caret at the end', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, RETRO_NOTE_TEXT);
    const note = h.note(id);
    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });

    await key(window, 'Enter');

    const area = h.textarea(note);
    expect(area).not.toBeNull();
    expect(note.getAttribute('data-editing')).toBe('true');
    expect(document.activeElement).toBe(area);
    expect(area?.value).toBe(RETRO_NOTE_TEXT);
    expect(area?.selectionStart).toBe(RETRO_NOTE_TEXT.length);
    expect(area?.selectionEnd).toBe(RETRO_NOTE_TEXT.length);
    // The static text layer is replaced by the editor, so the text is not doubled.
    expect(note.getAttribute('data-editing')).toBe('true');
  });

  // TC-24
  it('TC-24: Escape closes the editor, keeps the selection and preserves the text', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, 'Faster onboarding');
    const area = await edit(h, id);

    await typeText(area, 'Faster onboarding, and less setup');
    await key(area, 'Escape');

    const note = h.note(id);
    expect(h.textarea(note)).toBeNull();
    expect(note.getAttribute('data-editing')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(getStickyText(h.doc, id)?.toString()).toBe('Faster onboarding, and less setup');
    expect(h.noteText(note).textContent).toBe('Faster onboarding, and less setup');
  });

  it('Escape at an empty note keeps it selected with empty text', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const area = await edit(h, id);

    await key(area, 'Escape');

    expect(h.textarea(h.note(id))).toBeNull();
    expect(h.note(id).getAttribute('data-selected')).toBe('true');
    expect(getStickyText(h.doc, id)?.toString()).toBe('');
  });

  // TC-26
  it('TC-26: Backspace while editing edits the text instead of deleting the note', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, 'ab');
    const area = await edit(h, id);

    await key(area, 'Backspace');
    // The board shortcut must not fire while typing.
    expect(h.notes()).toHaveLength(1);
    expect(h.byId(id)).toBeDefined();

    // What the browser does with that key press.
    await typeText(area, 'a');

    expect(h.notes()).toHaveLength(1);
    expect(getStickyText(h.doc, id)?.toString()).toBe('a');
    expect(h.note(id).getAttribute('data-editing')).toBe('true');
  });

  it('Delete while editing does not remove the note', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, 'keep me');
    const area = await edit(h, id);

    await key(area, 'Delete');
    await typeText(area, 'keep');

    expect(h.notes()).toHaveLength(1);
    expect(getStickyText(h.doc, id)?.toString()).toBe('keep');
  });

  it('Enter while editing keeps the editor open (newline, not "leave editing")', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, 'One idea');
    const area = await edit(h, id);

    await key(area, 'Enter');
    await typeText(area, 'One idea\nper line');

    const note = h.note(id);
    expect(note.getAttribute('data-editing')).toBe('true');
    expect(h.textarea(note)).not.toBeNull();
    expect(getStickyText(h.doc, id)?.toString()).toBe('One idea\nper line');
    expect(h.snapshots()).toHaveLength(1);
  });

  // TC-38
  it('TC-38: typing then clicking outside writes the text and clears the selection', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const area = await edit(h, id);

    await typeText(area, 'a');
    await typeText(area, 'ab');
    await typeText(area, 'abc');

    await press(h.viewport(), { x: 700, y: 500 });
    await release(h.viewport(), { x: 700, y: 500 });

    const note = h.note(id);
    expect(h.textarea(note)).toBeNull();
    expect(getStickyText(h.doc, id)?.toString()).toBe('abc');
    expect(note.getAttribute('data-editing')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(note.getAttribute('data-selected')).toBe('false');
    expect(h.noteToolbar(note)).toBeNull();
  });

  it('clicking another note moves the edit and saves the first note', async () => {
    const h = await renderApp();
    const first = await addNote(h.doc, 0, 0);
    const second = await addNote(h.doc, 400, 0);
    const area = await edit(h, first);
    await typeText(area, 'first note');

    const secondNote = h.note(second);
    await press(secondNote, { x: 500, y: 300 });
    await release(secondNote, { x: 500, y: 300 });

    expect(getStickyText(h.doc, first)?.toString()).toBe('first note');
    expect(h.textarea(h.note(first))).toBeNull();
    expect(h.note(first).getAttribute('data-selected')).toBe('false');
    expect(secondNote.getAttribute('data-selected')).toBe('true');
  });

  it('every keystroke is written to the shared text immediately', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const area = await edit(h, id);

    await typeText(area, 'Hello');
    expect(getStickyText(h.doc, id)?.toString()).toBe('Hello');
    await typeText(area, 'Hello world');
    expect(getStickyText(h.doc, id)?.toString()).toBe('Hello world');
  });

  it('a remote edit in the middle of the text survives local typing', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, 'one idea');
    const area = await edit(h, id);

    await mutate(() => {
      getStickyText(h.doc, id)?.insert(4, ' shared');
    });
    // The editor keeps what the author typed and writes a local diff.
    await typeText(area, 'one idea shared idea');

    expect(getStickyText(h.doc, id)?.toString()).toBe('one idea shared idea');
  });

  it('typing beyond the limit never reaches the document', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const area = await edit(h, id);

    // The editor clamps before writing, so the shared text only ever holds
    // allowed characters (composition input is applied on compositionend).
    await typeText(area, OVER_LIMIT_NOTE_TEXT);
    expect(getStickyText(h.doc, id)?.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('pasting more than the limit keeps exactly STICKY_TEXT_MAX_CHARS characters', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const area = await edit(h, id);

    await typeText(area, OVER_LIMIT_NOTE_TEXT);

    const text = getStickyText(h.doc, id)?.toString() ?? '';
    expect(text.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(text).toBe(LONG_NOTE_TEXT);
    expect(area.value.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('one character past the limit is rejected', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, LONG_NOTE_TEXT);
    const area = await edit(h, id);

    await typeText(area, `${LONG_NOTE_TEXT}x`);

    expect(getStickyText(h.doc, id)?.toString().length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(area.value.length).toBe(STICKY_TEXT_MAX_CHARS);
  });

  it('the character counter appears at the threshold and not before', async () => {
    const h = await renderApp();
    const hiddenId = await noteWithText(h, 'x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS - 1));
    const hiddenArea = await edit(h, hiddenId);
    expect(h.view.queryByTestId('sticky-counter')).toBeNull();

    await typeText(hiddenArea, 'x'.repeat(STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS));
    const counter = h.view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(
      `${STICKY_TEXT_MAX_CHARS - STICKY_COUNTER_THRESHOLD_CHARS}/${STICKY_TEXT_MAX_CHARS}`,
    );
  });

  it('the editor shows the counter for a note at the limit', async () => {
    const h = await renderApp();
    const id = await noteWithText(h, LONG_NOTE_TEXT);
    await edit(h, id);
    const counter = h.view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`);
  });

  it('editing a note hides its floating toolbar', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    const note = h.note(id);
    await press(note, { x: 300, y: 300 });
    await release(note, { x: 300, y: 300 });
    expect(h.noteToolbar(note)).not.toBeNull();

    await doubleClick(note, { x: 300, y: 300 });
    expect(h.noteToolbar(note)).toBeNull();
  });

  it('a remote edit appears in the open editor', async () => {
    const h = await renderApp();
    const id = await addNote(h.doc, 0, 0);
    await edit(h, id);

    await mutate(() => {
      getStickyText(h.doc, id)?.insert(0, 'mid-edit');
    });
    await h.flushFrames();

    expect(getStickyText(h.doc, id)?.toString()).toBe('mid-edit');
    expect(h.textarea(h.note(id))?.value).toBe('mid-edit');
  });
});
