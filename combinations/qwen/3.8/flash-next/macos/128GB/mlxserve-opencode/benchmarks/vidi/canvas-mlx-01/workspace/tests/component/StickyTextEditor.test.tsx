import { describe, expect, it } from 'vitest';
import {
  boardDown,
  boardUp,
  key,
} from './harness.js';
import {
  dblClickNote,
  editorCaret,
  editorFocused,
  editorIn,
  isSelected,
  keyInEditor,
  modelNote,
  noteCount,
  noteEl,
  renderSticky,
  seedNote,
  seedNoteText,
  typeInEditor,
} from './stickyHarness.js';

const CENTRE = { x: 640, y: 400 };

async function noteInEdit(text = ''): Promise<string> {
  const id = await seedNote(0, 0);
  if (text) await seedNoteText(id, text);
  await dblClickNote(id);
  return id;
}

describe('editing text (TC-23, TC-24)', () => {
  it('TC-23 Enter on a selected note opens the editor, focused with the caret at the end', async () => {
    renderSticky();
    const id = await seedNote(0, 0);
    await seedNoteText(id, 'hello');

    // Press-and-release without moving selects the note.
    const { noteDown, noteUp } = await import('./stickyHarness.js');
    await noteDown(id, CENTRE.x, CENTRE.y);
    await noteUp(id, CENTRE.x, CENTRE.y);
    expect(isSelected(id)).toBe(true);

    // Enter starts editing (board-level key handler on window).
    await key({ key: 'Enter' });

    expect(editorIn(id)).not.toBeNull();
    expect(editorFocused()).toBe(true);
    const caret = editorCaret(id);
    expect(caret.start).toBe('hello'.length);
    expect(caret.end).toBe('hello'.length);
  });

  it('TC-24 Escape leaves editing for Selected and preserves the text', async () => {
    renderSticky();
    const id = await noteInEdit('keep me');

    await keyInEditor(id, 'Escape');

    expect(editorIn(id)).toBeNull();
    expect(modelNote(id)!.text).toBe('keep me');
    expect(isSelected(id)).toBe(true);
  });
});

describe('Backspace while editing edits text, never deletes the note (TC-26)', () => {
  it('keeps the note and lets the text change', async () => {
    renderSticky();
    const id = await noteInEdit('ab');

    // Backspace reaches the board handler only through the window listener; because
    // we are editing it must stand down, so the note survives.
    await key({ key: 'Backspace' });
    expect(noteEl(id)).not.toBeNull();
    expect(modelNote(id)!.text).toBe('ab');

    // The textarea then applies the deletion the user made.
    await typeInEditor(id, 'a');
    expect(noteEl(id)).not.toBeNull();
    expect(modelNote(id)!.text).toBe('a');
  });
});

describe('typing then clicking outside commits and does not recreate (TC-38)', () => {
  it('unmounts the editor, writes the exact text once, and leaves it Unselected', async () => {
    renderSticky();
    const id = await noteInEdit('');

    await typeInEditor(id, 'abc');
    expect(modelNote(id)!.text).toBe('abc');

    // An outside pointerdown ends editing; the note is not recreated.
    await boardDown(120, 120);
    await boardUp(120, 120);

    expect(editorIn(id)).toBeNull();
    expect(modelNote(id)!.text).toBe('abc');
    expect(isSelected(id)).toBe(false);
    expect(noteCount()).toBe(1);
  });
});
