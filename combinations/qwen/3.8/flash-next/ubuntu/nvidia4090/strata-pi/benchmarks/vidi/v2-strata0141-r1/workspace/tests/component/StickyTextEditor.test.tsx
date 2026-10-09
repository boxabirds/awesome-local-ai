import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_TEXT, MULTI_LINE_TEXT } from '../fixtures/texts';
import {
  clickElement,
  counterElement,
  createNote,
  docNotes,
  doubleClickElement,
  editorElement,
  flushFrame,
  noteElement,
  noteOf,
  noteText,
  pasteIntoEditor,
  pressKey,
  renderBoard,
  typeIntoEditor,
} from './harness';

function openNote(text = '') {
  const doc = new Y.Doc();
  renderBoard({ doc });
  const id = createNote(doc, { x: 300, y: 200 });
  doubleClickElement(noteElement(id), 320, 240);
  if (text !== '') {
    typeIntoEditor(text);
  }
  return { doc, id };
}

describe('sticky.text - editing (TC-23, TC-24, TC-38)', () => {
  it('TC-23 Enter starts editing with the caret at the end of the text', async () => {
    const { doc, id } = openNote('Faster onboarding');
    // Leave editing, then re-enter it with the keyboard.
    pressKey('Escape');
    expect(editorElement()).toBeNull();

    pressKey('Enter');
    const editor = editorElement() as HTMLTextAreaElement | null;
    expect(editor).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(editor!.value).toBe('Faster onboarding');
    expect(editor!.selectionStart).toBe('Faster onboarding'.length);
    expect(editor!.selectionEnd).toBe('Faster onboarding'.length);
    expect(noteText(doc, id)).toBe('Faster onboarding');
  });

  it('TC-23 editing starts immediately when a note is created', () => {
    const doc = new Y.Doc();
    renderBoard({ doc });
    fireEvent.click(screen.getByTestId('create-sticky'));
    docNotes(doc)[0]!;
    expect(editorElement()).not.toBeNull();
    expect(document.activeElement).toBe(editorElement());
    expect(docNotes(doc)).toHaveLength(1);
  });

  it('TC-24 Escape ends editing and keeps the text', () => {
    const { doc, id } = openNote('Ship the demo');

    pressKey('Escape');

    expect(editorElement()).toBeNull();
    expect(noteText(doc, id)).toBe('Ship the demo');
    expect(noteElement(id).getAttribute('data-selected')).toBe('true');
    // The note shows the text it holds.
    const shown = noteElement(id).querySelector('[data-testid^="sticky-text-"]');
    expect(shown?.textContent).toBe('Ship the demo');
  });

  it('TC-24 Escape does not delete the note', () => {
    const { doc, id } = openNote('Keep me');
    pressKey('Escape');
    expect(docNotes(doc)).toHaveLength(1);
    expect(noteOf(doc, id).text).toBe('Keep me');
  });

  it('TC-38 clicking outside while editing keeps the text and deselects', () => {
    const { doc, id } = openNote('abc');

    clickElement(screen.getByTestId('board'), 700, 500); // click outside the note

    expect(editorElement()).toBeNull();
    expect(noteText(doc, id)).toBe('abc');
    expect(noteElement(id).getAttribute('data-selected')).toBe('false');
  });

  it('every typed character reaches Y.Text through the minimal diff', () => {
    const { doc, id } = openNote();
    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    const writes: number[] = [];
    ytext.observeDeep((events) => {
      writes.push(events.length);
    });

    typeIntoEditor('a');
    typeIntoEditor('b');
    typeIntoEditor('c');

    expect(noteText(doc, id)).toBe('abc');
    expect(ytext.toString()).toBe('abc');
    // One change per keystroke, never a full replace.
    expect(writes).toEqual([1, 1, 1]);
  });

  it('multi-line text is preserved exactly', () => {
    const { doc, id } = openNote(MULTI_LINE_TEXT);
    expect(noteText(doc, id)).toBe(MULTI_LINE_TEXT);
    pressKey('Escape');
    expect(noteText(doc, id)).toBe(MULTI_LINE_TEXT);
  });

  it('TC-17 the counter appears only when 50 characters or fewer remain', () => {
    const { doc, id } = openNote();
    expect(counterElement()).toBeNull();

    pasteIntoEditor('x'.repeat(949));
    expect(counterElement()).toBeNull();
    expect(noteText(doc, id).length).toBe(949);

    pasteIntoEditor('x'.repeat(950));
    const counter = counterElement();
    expect(counter).not.toBeNull();
    expect(counter!.textContent).toBe('950/1000');

    pasteIntoEditor('x'.repeat(999) + 'y');
    expect(counterElement()?.textContent).toBe('1000/1000');
  });

  it('TC-16 typing past the limit keeps exactly 1,000 characters', () => {
    const { doc, id } = openNote(LONG_TEXT);
    expect(noteText(doc, id)).toHaveLength(STICKY_TEXT_MAX_CHARS);

    typeIntoEditor('!');

    expect(noteText(doc, id)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect((editorElement() as HTMLTextAreaElement | null)?.value).toHaveLength(
      STICKY_TEXT_MAX_CHARS,
    );
  });

  it('TC-14 a 1,200 character paste keeps exactly the first 1,000', () => {
    const { doc, id } = openNote();
    pasteIntoEditor(`${LONG_TEXT}0123456789`.repeat(1).slice(0, 1200));
    expect(noteText(doc, id)).toHaveLength(STICKY_TEXT_MAX_CHARS);
    expect(noteText(doc, id)).toBe(LONG_TEXT);
  });

  it('the editor uses the fitted font size', () => {
    openNote('one word');
    const editor = editorElement() as HTMLTextAreaElement | null;
    expect(editor).not.toBeNull();
    // jsdom has no text layout, so every size "fits": the maximum is chosen.
    expect(editor!.style.fontSize).toBe('24px');
  });

  it('ending editing performs no additional write', async () => {
    const { doc, id } = openNote('written while editing');
    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;

    let changes = 0;
    const observer = () => {
      changes += 1;
    };
    ytext.observe(observer);

    pressKey('Escape');
    await flushFrame();

    expect(changes).toBe(0);
    expect(noteText(doc, id)).toBe('written while editing');
  });

  it('text changed elsewhere is shown in the editor', () => {
    const { doc, id } = openNote('local');
    const ytext = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
    act(() => {
      ytext.insert(0, 'remote: '); // an edit from another client (story 3)
    });
    expect((editorElement() as HTMLTextAreaElement | null)?.value).toBe('remote: local');
  });
});

describe('sticky.text - TC-26 keyboard while editing', () => {
  it('TC-26 Backspace while editing edits the text and never deletes the note', () => {
    const { doc, id } = openNote('ab');

    // The key reaches the textarea, not the board command handler.
    pasteIntoEditor('a'); // what Backspace leaves in the textarea

    expect(docNotes(doc)).toHaveLength(1);
    expect(noteText(doc, id)).toBe('a');
  });

  it('TC-26 Delete while editing does not delete the note', () => {
    const { doc, id } = openNote('ab');

    pressKey('Delete'); // focus is in the textarea
    pressKey('Backspace');

    expect(docNotes(doc)).toHaveLength(1);
    expect(noteText(doc, id)).toBe('ab');
  });

  it('TC-26 Enter inside the textarea is a new line, not a board command', () => {
    const { doc, id } = openNote('first');
    pasteIntoEditor('first\nsecond');

    expect(noteText(doc, id)).toBe('first\nsecond');
    expect(docNotes(doc)).toHaveLength(1);
  });
});
