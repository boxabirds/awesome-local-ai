import { act } from '@testing-library/react';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import { enableFakeFrameTimers } from './test-utils';
import { createNote, renderNotesHarness, seedNoteText } from './notes-harness';

const noteEl = () => screen.getByRole('group', { name: 'Sticky note' }) as HTMLElement;
const editor = () => screen.queryByRole('textbox', { name: 'Sticky note text' }) as HTMLTextAreaElement | null;

const press = (el: HTMLElement): void => {
  fireEvent.pointerDown(el, { button: 0, clientX: 640, clientY: 400, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: 640, clientY: 400, pointerId: 1 });
};

const attr = (el: Element | null, name: string): string | null => (el ? el.getAttribute(name) : null);

describe('sticky.editor (jsdom, real Y.Doc)', () => {
  beforeEach(() => {
    enableFakeFrameTimers();
  });

  it('TC-23 Enter on the selected note starts editing, focused with the caret at the end', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'Hello');
    const note = noteEl();
    press(note);

    fireEvent.keyDown(window, { key: 'Enter' });

    const ta = editor();
    expect(ta).not.toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(ta!.value).toBe('Hello');
    expect(ta!.selectionStart).toBe(5);
    expect(ta!.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps the selection and the text', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'Hello');
    const note = noteEl();
    press(note);
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor()!;

    fireEvent.keyDown(ta, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: 'Sticky note text' })).toBeNull();
    expect(attr(note, 'data-selected')).toBe('true');
    expect(attr(note, 'data-editing')).toBeNull();
    expect(getStickyText(docRef.current!, id)!.toString()).toBe('Hello');
  });

  it('TC-26 a backspace in the textarea shrinks the text but keeps the note (negative: no note deletion)', () => {
    const { docRef } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    seedNoteText(docRef.current!, id, 'ab');
    const note = noteEl();
    press(note);
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor()!;

    // jsdom does not perform native text editing: apply the resulting
    // textarea value (as the browser would after Backspace at the end).
    fireEvent.keyDown(ta, { key: 'Backspace' });
    act(() => {
      ta.value = 'a';
      fireEvent.input(ta, { target: { value: 'a' } });
    });

    expect(snapshot(docRef.current!)).toHaveLength(1); // the note survives
    expect(snapshot(docRef.current!).find((n) => n.id === id)!.text).toBe('a');
    expect(getStickyText(docRef.current!, id)!.toString()).toBe('a');
  });

  it('TC-38 typing then clicking outside saves the text and deselects', () => {
    const { docRef, viewport } = renderNotesHarness();
    const id = createNote(docRef.current!, 0, 0);
    const note = noteEl();
    press(note);
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor()!;

    act(() => {
      ta.value = 'abc';
      fireEvent.input(ta, { target: { value: 'abc' } });
    });
    expect(getStickyText(docRef.current!, id)!.toString()).toBe('abc');

    fireEvent.pointerDown(viewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(viewport, { clientX: 100, clientY: 100, pointerId: 1 });

    expect(editor()).toBeNull();
    expect(attr(note, 'data-selected')).toBe('false');
    expect(getStickyText(docRef.current!, id)!.toString()).toBe('abc');
    expect(snapshot(docRef.current!).find((n) => n.id === id)).toBeTruthy();
  });
});
