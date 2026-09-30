import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { RETRO_ITEM, prose } from '../fixtures/texts';
import { flushFrame, noteToolbar, pointer, renderApp, stickyNotes } from './helpers';

const CENTRE = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

function setup(text = '') {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 0, y: 0 });
  if (id === false) throw new Error('create rejected');
  getStickyText(doc, id)?.insert(0, text);
  const utils = renderApp(doc);
  const note = () => stickyNotes()[0];
  const ytext = () => getStickyText(doc, id)?.toString();
  return { ...utils, doc, id, note, ytext };
}

function selectNote(el: HTMLElement) {
  pointer(el, 'down', CENTRE.x, CENTRE.y);
  pointer(el, 'up', CENTRE.x, CENTRE.y);
  flushFrame();
}

function editor(): HTMLTextAreaElement {
  return screen.getByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement;
}

/** Simulates the browser changing the textarea value and firing `input`. */
function typeValue(el: HTMLTextAreaElement, value: string) {
  fireEvent.input(el, { target: { value } });
}

describe('sticky.text editor', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    const { note } = setup(RETRO_ITEM);
    selectNote(note());
    const notPrevented = fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(notPrevented).toBe(false);
    const textarea = editor();
    expect(note().dataset.editing).toBe('true');
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe(RETRO_ITEM);
    expect(textarea.selectionStart).toBe(RETRO_ITEM.length);
    expect(textarea.selectionEnd).toBe(RETRO_ITEM.length);
    // The note toolbar hides while editing.
    expect(noteToolbar()).toBeNull();
  });

  it('Enter on a focused note starts editing it', () => {
    const { note } = setup('Tab to me');
    fireEvent.keyDown(note(), { key: 'Enter' });
    expect(document.activeElement).toBe(editor());
  });

  it('TC-24 Escape ends editing, keeps the text and leaves the note selected', () => {
    const { note, ytext } = setup('Faster');
    fireEvent.doubleClick(note());
    typeValue(editor(), 'Faster onboarding');
    const notPrevented = fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext()).toBe('Faster onboarding');
    expect(note().dataset.selected).toBe('true');
    expect(note().dataset.editing).toBe('false');
    expect(noteToolbar()).not.toBeNull();
    expect(note().textContent).toContain('Faster onboarding');
  });

  it('TC-26 Backspace while editing edits text and never deletes the note', () => {
    const { note, doc, ytext } = setup('ab');
    fireEvent.doubleClick(note());
    const textarea = editor();
    const notPrevented = fireEvent.keyDown(textarea, { key: 'Backspace' });
    expect(notPrevented).toBe(true);
    typeValue(textarea, 'a');
    fireEvent.keyDown(textarea, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(ytext()).toBe('a');
  });

  it('Enter inside the note is left to the textarea (new line)', () => {
    const { note, ytext } = setup('Line one');
    fireEvent.doubleClick(note());
    expect(fireEvent.keyDown(editor(), { key: 'Enter' })).toBe(true);
    typeValue(editor(), 'Line one\nLine two');
    expect(ytext()).toBe('Line one\nLine two');
  });

  it('TC-38 typing then clicking outside ends editing with the text kept and nothing selected', () => {
    const { note, viewport, ytext } = setup();
    fireEvent.doubleClick(note());
    typeValue(editor(), 'a');
    typeValue(editor(), 'ab');
    typeValue(editor(), 'abc');
    pointer(viewport(), 'down', 20, 20);
    pointer(viewport(), 'up', 20, 20);
    flushFrame();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(ytext()).toBe('abc');
    expect(note().dataset.selected).toBe('false');
    expect(noteToolbar()).toBeNull();
  });

  it('a 1,200 character paste keeps the first 1,000 and shows 1000/1000', () => {
    const { note, ytext } = setup();
    fireEvent.doubleClick(note());
    const pasted = prose(1200);
    typeValue(editor(), pasted);
    expect(editor().value).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(ytext()).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(editor().selectionStart).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByText(`${STICKY_TEXT_MAX_CHARS}/${STICKY_TEXT_MAX_CHARS}`)).toBeTruthy();
  });

  it('the counter appears only within 50 characters of the limit', () => {
    const { note } = setup(prose(949));
    fireEvent.doubleClick(note());
    expect(screen.queryByText(/\/1000$/)).toBeNull();
    typeValue(editor(), prose(950));
    expect(screen.getByText('950/1000')).toBeTruthy();
  });

  it('an empty note shows no placeholder when not editing', () => {
    const { note } = setup('');
    expect(note().textContent).toBe('');
  });
});
