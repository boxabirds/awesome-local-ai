import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { createSticky, getStickyText, initDoc, snapshot } from '../../src/shared/board-model';
import { SHORT_PHRASE } from '../fixtures/texts';

function mount(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  render(<App doc={doc} />);
  return doc;
}

function addNote(doc: Y.Doc, text = ''): string {
  let id = '';
  act(() => {
    id = createSticky(doc, { x: 0, y: 0 });
    if (text !== '') getStickyText(doc, id)!.insert(0, text);
  });
  return id;
}

function noteAt(): HTMLElement {
  return screen.getAllByTestId('sticky-note')[0];
}

function editNote(doc: Y.Doc, id: string): HTMLTextAreaElement {
  fireEvent.doubleClick(noteAt());
  const el = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
  void doc;
  void id;
  return el;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sticky.text (StickyTextEditor)', () => {
  it('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    const doc = mount();
    const id = addNote(doc, SHORT_PHRASE);
    fireEvent.pointerDown(noteAt(), { clientX: 100, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(noteAt(), { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.keyDown(window, { key: 'Enter' });
    const el = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(el).toBeInTheDocument();
    expect(el.value).toBe(SHORT_PHRASE);
    expect(document.activeElement).toBe(el);
    expect(el.selectionStart).toBe(SHORT_PHRASE.length);
    expect(el.selectionEnd).toBe(SHORT_PHRASE.length);
    void id;
  });

  it('TC-24 Escape commits the text and leaves the note selected', () => {
    const doc = mount();
    const id = addNote(doc);
    const el = editNote(doc, id);
    fireEvent.input(el, { target: { value: 'ab' } });
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(snapshot(doc)[0]).toMatchObject({ id });
    expect(getStickyText(doc, id)!.toString()).toBe('ab');
    expect(noteAt()).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('TC-26 Backspace while editing never deletes the note, only the character', () => {
    const doc = mount();
    const id = addNote(doc, 'ab');
    const el = editNote(doc, id);
    fireEvent.keyDown(el, { key: 'Backspace' });
    expect(snapshot(doc)).toHaveLength(1);
    fireEvent.input(el, { target: { value: 'a' } });
    expect(snapshot(doc)).toHaveLength(1);
    expect(getStickyText(doc, id)!.toString()).toBe('a');
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-38 pointerdown outside the editor commits and deselects', () => {
    const doc = mount();
    const id = addNote(doc);
    const el = editNote(doc, id);
    fireEvent.input(el, { target: { value: 'abc' } });
    const viewport = screen.getByTestId('board-viewport');
    fireEvent.pointerDown(viewport, { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(viewport, { clientX: 5, clientY: 5, pointerId: 1 });
    expect(screen.queryByTestId('sticky-textarea')).not.toBeInTheDocument();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(noteAt()).toHaveAttribute('data-selected', 'false');
  });
});
